from __future__ import annotations

import io
import json
import tempfile
import zipfile
from hashlib import sha256
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .executable import discover_pq
from .input_writer import render_input
from .mm import (
    mm_method_label,
    validate_mm_setup_contents,
    validate_mm_structure,
)
from .models import (
    Bootstrap,
    ExportRequest,
    PlanRenderResult,
    PlannedInput,
    PerturbationResult,
    PQStatus,
    PQValidationResult,
    RenderResult,
    RunPlanRequest,
    RunnerStatus,
    SetupFileReference,
    SimulationSetup,
    StructureAnalysis,
)
from .pq_validation import PQValidationError, validate_pq_input
from .presets import list_presets
from .release import TARGET_PQ_RELEASE
from .runners import apply_pq_capabilities, detect_runners
from .run_plan import plan_requested, render_run_plan
from .run_script import RUN_SCRIPT_NAME, render_run_script
from .setup_files import required_qm_file_roles
from .structures import (
    analyze_structure,
    format_pq_restart,
    parse_structure_bytes,
    perturb_structure,
)

_MAX_STRUCTURE_BYTES = 100 * 1024 * 1024
_MAX_SETUP_FILE_BYTES = 100 * 1024 * 1024
_TRUSTED_HOSTS = ["127.0.0.1", "localhost", "[::1]", "testserver"]


def create_app(*, pq_executable: str | None = None) -> FastAPI:
    app = FastAPI(
        title="PQSetup",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_TRUSTED_HOSTS)
    pq = discover_pq(pq_executable)
    runner_context = pq.executable if pq.found else None
    runners = apply_pq_capabilities(
        (
            detect_runners(runner_context, external_qm=pq.external_qm)
            if pq.external_qm is not None
            else detect_runners(runner_context)
        ),
        pq.capabilities,
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/bootstrap", response_model=Bootstrap)
    def bootstrap() -> Bootstrap:
        return Bootstrap(
            version=__version__,
            target_pq_release=TARGET_PQ_RELEASE,
            pq=pq,
            runners=runners,
            presets=list_presets(),
        )

    @app.post(
        "/api/structure/analyze",
        response_model=StructureAnalysis,
    )
    async def analyze(file: UploadFile = File(...)) -> StructureAnalysis:
        try:
            structure = parse_structure_bytes(
                file.filename or "structure", await _read_structure(file)
            )
            return analyze_structure(structure)
        except (UnicodeDecodeError, ValueError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post(
        "/api/structure/perturb",
        response_model=PerturbationResult,
    )
    async def perturb(
        file: UploadFile = File(...),
        sigma: float | None = Form(default=None),
        sigma_angstrom: float | None = Form(default=None),
        seed: int = Form(default=238917),
    ) -> PerturbationResult:
        width = sigma_angstrom if sigma_angstrom is not None else sigma
        if width is None:
            width = 0.01
        try:
            structure = parse_structure_bytes(
                file.filename or "structure", await _read_structure(file)
            )
            return perturb_structure(structure, width, seed)
        except (UnicodeDecodeError, ValueError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post("/api/input/render", response_model=RenderResult)
    def render(setup: SimulationSetup) -> RenderResult:
        return render_input(setup, external_qm=pq.external_qm)

    @app.post("/api/plan/render", response_model=PlanRenderResult)
    def render_plan(request: RunPlanRequest) -> PlanRenderResult:
        return render_run_plan(
            request,
            pq=pq,
            runners=runners,
        )

    @app.post("/api/project/export")
    def export_project(request: ExportRequest) -> Response:
        if (
            request.structure.cell_generated
            and request.setup.ensemble == "NPT"
            and request.setup.job_type != "mm-md"
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    "NPT needs a physical periodic cell, not a generated vacuum cell."
                ),
            )
        if (
            plan_requested(request.sampling_run_count, request.equilibration)
            or request.setup.job_type == "mm-md"
            or bool(request.setup_files)
            or bool(required_qm_file_roles(request.setup, pq.external_qm))
        ):
            return _export_plan(
                request,
                pq=pq,
                runners=runners,
            )
        rendered = render_input(request.setup, external_qm=pq.external_qm)
        if not rendered.valid:
            raise HTTPException(
                status_code=422,
                detail=[item.model_dump() for item in rendered.diagnostics],
            )
        analysis = analyze_structure(request.structure)
        if not analysis.valid:
            raise HTTPException(
                status_code=422,
                detail=[item.model_dump() for item in analysis.diagnostics],
            )
        if request.structure.cell_generated and request.setup.ensemble == "NPT":
            raise HTTPException(
                status_code=422,
                detail=(
                    "NPT needs a physical periodic cell, not a generated vacuum cell."
                ),
            )
        archive = io.BytesIO()
        project_name = _safe_name(request.project_name)
        input_name = f"{project_name}.in"
        structure_name = Path(request.setup.start_file).name
        exported_structure = request.structure.model_copy(deep=True)
        if request.setup.initialize_velocities:
            for atom in exported_structure.atoms:
                atom.velocity = None
                atom.force = None
        structure_content = format_pq_restart(exported_structure)
        structure_hash = sha256(structure_content.encode("utf-8")).hexdigest()
        input_hash = sha256(rendered.input_text.encode("utf-8")).hexdigest()
        if (
            request.preparation
            and request.preparation.prepared_sha256 != structure_hash
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Prepared coordinates do not match the recorded "
                    "perturbation. Apply the preparation again."
                ),
            )
        validation_results = _validate_export_inputs(
            pq,
            input_names=[input_name],
            files=[
                (input_name, rendered.input_text),
                (structure_name, structure_content),
            ],
        )
        manifest = {
            "schema_version": 1,
            "project_name": project_name,
            "pqsetup_version": __version__,
            "target_pq_release": TARGET_PQ_RELEASE,
            "setup": request.setup.model_dump(mode="json"),
            "files": {
                "input": {
                    "name": input_name,
                    "sha256": input_hash,
                },
                "structure": {
                    "name": structure_name,
                    "sha256": structure_hash,
                },
            },
            "structure": {
                "source_name": request.structure.source_name,
                "source_format": request.structure.source_format,
                "atom_count": len(request.structure.atoms),
                "periodic": request.structure.periodic,
                "wrapped_centered": request.structure.wrapped_centered,
                "cell_generated": request.structure.cell_generated,
                "cell_padding_angstrom": request.structure.cell_padding_angstrom,
                "velocities": (
                    "initialized_by_pq"
                    if request.setup.initialize_velocities
                    else "preserved"
                ),
            },
            "preparation": (
                request.preparation.model_dump(mode="json")
                if request.preparation
                else None
            ),
        }
        _add_validation_manifest(manifest, pq, validation_results)
        with zipfile.ZipFile(
            archive, mode="w", compression=zipfile.ZIP_DEFLATED
        ) as bundle:
            bundle.writestr(input_name, rendered.input_text)
            bundle.writestr(structure_name, structure_content)
            bundle.writestr(
                "pqproject.json",
                json.dumps(manifest, indent=2) + "\n",
            )
        return Response(
            content=archive.getvalue(),
            media_type="application/zip",
            headers={
                "Content-Disposition": (f'attachment; filename="{project_name}.zip"')
            },
        )

    frontend_candidates = (
        Path(__file__).resolve().parents[1] / "frontend" / "dist",
        Path(__file__).resolve().parent / "static",
    )
    frontend = next(
        (candidate for candidate in frontend_candidates if candidate.is_dir()),
        None,
    )
    if frontend:
        app.mount("/", StaticFiles(directory=frontend, html=True), name="ui")
    return app


async def _read_structure(file: UploadFile) -> bytes:
    content = await file.read(_MAX_STRUCTURE_BYTES + 1)
    if len(content) > _MAX_STRUCTURE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Structure files must be 100 MB or smaller.",
        )
    return content


def _safe_name(value: str) -> str:
    name = "".join(
        character
        for character in Path(value).name
        if character.isalnum() or character in {"-", "_"}
    ).strip("-_")
    return name or "pq-run"


def _export_plan(
    request: ExportRequest,
    *,
    pq: PQStatus,
    runners: list[RunnerStatus],
) -> Response:
    _validate_setup_file_contents(request)
    setup_content_diagnostics = validate_mm_setup_contents(
        request.setup,
        request.structure,
        request.setup_files,
    )
    if setup_content_diagnostics:
        raise HTTPException(
            status_code=422,
            detail=[item.model_dump() for item in setup_content_diagnostics],
        )

    plan_request = RunPlanRequest(
        setup=request.setup,
        structure=request.structure,
        equilibration=request.equilibration,
        sampling_run_count=request.sampling_run_count or 1,
        setup_files=[
            SetupFileReference(role=item.role, name=item.name)
            for item in request.setup_files
        ],
    )
    rendered = render_run_plan(plan_request, pq=pq, runners=runners)
    if not rendered.valid:
        raise HTTPException(
            status_code=422,
            detail=[item.model_dump() for item in rendered.diagnostics],
        )

    analysis = analyze_structure(request.structure)
    if not analysis.valid:
        raise HTTPException(
            status_code=422,
            detail=[item.model_dump() for item in analysis.diagnostics],
        )
    mm_structure_diagnostics = validate_mm_structure(
        request.setup,
        request.structure,
    )
    if mm_structure_diagnostics:
        raise HTTPException(
            status_code=422,
            detail=[item.model_dump() for item in mm_structure_diagnostics],
        )
    if (
        request.structure.cell_generated
        and request.setup.ensemble == "NPT"
        and request.setup.job_type != "mm-md"
    ):
        raise HTTPException(
            status_code=422,
            detail="NPT needs a physical periodic cell, not a generated vacuum cell.",
        )

    project_name = _safe_name(request.project_name)
    structure_name = Path(request.setup.start_file).name
    initializes_velocities = bool(
        request.setup.initialize_velocities
        or (request.equilibration and request.equilibration.enabled)
    )
    exported_structure = request.structure.model_copy(deep=True)
    if initializes_velocities:
        for atom in exported_structure.atoms:
            atom.velocity = None
            atom.force = None
    prepared_content = format_pq_restart(exported_structure)
    prepared_hash = sha256(prepared_content.encode("utf-8")).hexdigest()
    if request.preparation and request.preparation.prepared_sha256 != prepared_hash:
        raise HTTPException(
            status_code=422,
            detail=(
                "Prepared coordinates do not match the recorded "
                "perturbation. Apply the preparation again."
            ),
        )
    if request.setup.job_type == "mm-md" and request.structure.cell_generated:
        exported_structure.cell = None
        exported_structure.periodic = (False, False, False)
        exported_structure.wrapped_centered = False
    structure_content = format_pq_restart(exported_structure)
    structure_hash = sha256(structure_content.encode("utf-8")).hexdigest()

    input_files = [
        {
            "name": item.name,
            "sha256": sha256(item.input_text.encode("utf-8")).hexdigest(),
            "stage": item.stage_id,
            "stage_index": item.stage_index,
            "stage_count": item.stage_count,
            "segment_index": item.segment_index,
            "segment_count": item.segment_count,
            "calculator": item.calculator_id,
            "start_file": item.start_file,
            "restart_file": item.restart_file,
        }
        for item in rendered.files
    ]
    execution_order = [item.name for item in rendered.files]
    _validate_setup_file_collisions(
        request,
        {
            *execution_order,
            *(item.restart_file for item in rendered.files),
            structure_name,
            RUN_SCRIPT_NAME,
            "pqproject.json",
            "run-logs",
        },
    )
    setup_file_entries = [
        {
            "role": item.role,
            "name": item.name,
            "sha256": sha256(item.content.encode("utf-8")).hexdigest(),
        }
        for item in request.setup_files
    ]
    run_script = render_run_script(execution_order)
    run_script_hash = sha256(run_script.encode("utf-8")).hexdigest()
    validation_results = _validate_export_inputs(
        pq,
        input_names=[
            planned.name for planned in _representative_inputs(rendered.files)
        ],
        files=[
            *((planned.name, planned.input_text) for planned in rendered.files),
            (structure_name, structure_content),
            *(
                (setup_file.name, setup_file.content)
                for setup_file in request.setup_files
            ),
        ],
    )
    aliases = {"mace": "mace_mp"}
    runner_by_id = {item.id: item for item in runners}
    runner_id = request.setup.runner
    status = runner_by_id.get(aliases.get(runner_id, runner_id)) if runner_id else None
    environment_calculator = (
        None
        if request.setup.job_type == "mm-md"
        else {
            "id": runner_id,
            "detected": bool(status and status.installed),
            "calculator_ready": bool(status and status.ready),
            "available_in_pq": status.available_in_pq if status else None,
            "ready": bool(
                status
                and status.ready
                and status.available_in_pq is not False
            ),
            "version": status.version if status else None,
            "detail": (
                status.detail
                if status
                else "No environment status is available for this calculator."
            ),
        }
    )
    plan_manifest = plan_request.model_dump(mode="json", exclude={"structure"})
    for setup_file in plan_manifest["setup_files"]:
        setup_file.pop("content", None)

    manifest = {
        "schema_version": 3,
        "project_name": project_name,
        "pqsetup_version": __version__,
        "target_pq_release": TARGET_PQ_RELEASE,
        "plan": plan_manifest,
        "files": {
            "inputs": input_files,
            "structure": {
                "name": structure_name,
                "sha256": structure_hash,
            },
            "run_script": {
                "name": RUN_SCRIPT_NAME,
                "sha256": run_script_hash,
                "shell": "bash",
            },
            "setup_files": setup_file_entries,
        },
        "execution_order": execution_order,
        "environment": {
            "pq_detected": pq.found,
            "pq_version": pq.version,
            "calculator": environment_calculator,
        },
        "method": {
            "id": (
                "molecular_mechanics"
                if request.setup.job_type == "mm-md"
                else runner_id
            ),
            "label": (
                mm_method_label(request.setup.mm_force_field)
                if request.setup.job_type == "mm-md"
                else rendered.files[0].calculator_label
            ),
        },
        "diagnostics": [
            item.model_dump(mode="json")
            for item in rendered.diagnostics
            if item.severity != "error"
        ],
        "structure": {
            "source_name": request.structure.source_name,
            "source_format": request.structure.source_format,
            "atom_count": len(request.structure.atoms),
            "periodic": request.structure.periodic,
            "wrapped_centered": request.structure.wrapped_centered,
            "cell_generated": request.structure.cell_generated,
            "cell_padding_angstrom": request.structure.cell_padding_angstrom,
            "velocities": (
                "initialized_by_pq" if initializes_velocities else "preserved"
            ),
        },
        "preparation": (
            request.preparation.model_dump(mode="json") if request.preparation else None
        ),
    }
    _add_validation_manifest(manifest, pq, validation_results)

    archive = io.BytesIO()
    with zipfile.ZipFile(
        archive,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as bundle:
        for planned in rendered.files:
            bundle.writestr(planned.name, planned.input_text)
        bundle.writestr(structure_name, structure_content)
        for setup_file in request.setup_files:
            bundle.writestr(setup_file.name, setup_file.content)
        _write_executable(bundle, RUN_SCRIPT_NAME, run_script)
        bundle.writestr(
            "pqproject.json",
            json.dumps(manifest, indent=2) + "\n",
        )
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_name}.zip"'},
    )


def _representative_inputs(files: list[PlannedInput]) -> list[PlannedInput]:
    equilibration = next(
        (item for item in files if item.stage_id == "equilibration"),
        None,
    )
    first_sampling = next(
        (
            item
            for item in files
            if item.stage_id == "sampling" and item.segment_index == 1
        ),
        None,
    )
    continuation = next(
        (
            item
            for item in files
            if item.stage_id == "sampling"
            and item.segment_index is not None
            and item.segment_index > 1
        ),
        None,
    )
    return [
        item
        for item in (equilibration, first_sampling, continuation)
        if item is not None
    ]


def _validate_export_inputs(
    pq: PQStatus,
    *,
    input_names: list[str],
    files: list[tuple[str, str]],
) -> list[PQValidationResult]:
    if not pq.found or not pq.executable or not pq.supports_validation("portable"):
        return []

    try:
        with tempfile.TemporaryDirectory(prefix="pqsetup-validation-") as directory:
            root = Path(directory)
            for name, content in files:
                (root / name).write_text(content, encoding="utf-8")
            results = [
                validate_pq_input(
                    pq.executable,
                    root / name,
                    scope="portable",
                )
                for name in input_names
            ]
    except (OSError, UnicodeError) as error:
        raise HTTPException(
            status_code=422,
            detail=f"Validation files could not be prepared: {error}",
        ) from error
    except PQValidationError as error:
        raise HTTPException(
            status_code=503,
            detail=f"PQ input validation could not be completed: {error}",
        ) from error

    invalid_diagnostics = [
        diagnostic.model_dump(mode="json")
        for result in results
        if not result.valid
        for diagnostic in result.diagnostics
    ]
    if invalid_diagnostics:
        raise HTTPException(status_code=422, detail=invalid_diagnostics)
    if any(not result.valid for result in results):
        raise HTTPException(
            status_code=422,
            detail="PQ rejected a generated input without a diagnostic.",
        )
    return results


def _add_validation_manifest(
    manifest: dict,
    pq: PQStatus,
    results: list[PQValidationResult],
) -> None:
    if not results:
        manifest["validation"] = {
            "status": "not_run",
            "scope": "portable",
            "detail": (
                pq.detail
                if not pq.found
                else "Installed PQ does not advertise portable validation."
            ),
            "results": [],
        }
        return
    manifest["validation"] = {
        "status": "passed",
        "scope": "portable",
        "pq_version": pq.version,
        "results": [
            result.model_dump(mode="json", by_alias=True) for result in results
        ],
    }


def _validate_setup_file_contents(request: ExportRequest) -> None:
    total_bytes = 0
    for item in request.setup_files:
        if item.name in {".", ".."} or Path(item.name).name != item.name:
            raise HTTPException(
                status_code=422,
                detail=f"Setup file '{item.name}' must be a filename.",
            )
        try:
            name_bytes = len(item.name.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise HTTPException(
                status_code=422,
                detail="A setup filename is invalid.",
            ) from error
        if name_bytes > 255:
            raise HTTPException(
                status_code=422,
                detail=f"Setup file '{item.name}' has a filename that is too long.",
            )
        if not item.content.strip():
            raise HTTPException(
                status_code=422,
                detail=f"Setup file '{item.name}' is empty.",
            )
        if "\x00" in item.content:
            raise HTTPException(
                status_code=422,
                detail=f"Setup file '{item.name}' contains binary data.",
            )
        try:
            total_bytes += len(item.content.encode("utf-8"))
        except UnicodeEncodeError as error:
            raise HTTPException(
                status_code=422,
                detail=f"Setup file '{item.name}' is not valid UTF-8 text.",
            ) from error
        if total_bytes > _MAX_SETUP_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail="Setup files must be 100 MB or smaller in total.",
            )


def _validate_setup_file_collisions(
    request: ExportRequest,
    reserved_names: set[str],
) -> None:
    reserved = {name.casefold() for name in reserved_names}
    for item in request.setup_files:
        if item.name.casefold() in reserved:
            raise HTTPException(
                status_code=422,
                detail=f"Setup file '{item.name}' conflicts with a generated file.",
            )


def _write_executable(
    bundle: zipfile.ZipFile,
    name: str,
    content: str,
) -> None:
    archive_entry = zipfile.ZipInfo(name)
    archive_entry.create_system = 3
    archive_entry.external_attr = 0o100755 << 16
    archive_entry.compress_type = zipfile.ZIP_DEFLATED
    bundle.writestr(archive_entry, content)
