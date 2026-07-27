from __future__ import annotations

import io
import json
import zipfile
from hashlib import sha256
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from . import __version__
from .executable import discover_pq
from .input_writer import render_input
from .models import (
    Bootstrap,
    ExportRequest,
    PlanRenderResult,
    PerturbationResult,
    RenderResult,
    RunPlanRequest,
    SimulationSetup,
    StructureAnalysis,
)
from .presets import list_presets
from .release import TARGET_PQ_RELEASE
from .runners import detect_runners
from .run_plan import plan_requested, render_run_plan
from .structures import (
    analyze_structure,
    format_pq_restart,
    parse_structure_bytes,
    perturb_structure,
)

_MAX_STRUCTURE_BYTES = 100 * 1024 * 1024


def create_app(*, pq_executable: str | None = None) -> FastAPI:
    app = FastAPI(title="PQSetup", version=__version__)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/bootstrap", response_model=Bootstrap)
    def bootstrap() -> Bootstrap:
        return Bootstrap(
            version=__version__,
            target_pq_release=TARGET_PQ_RELEASE,
            pq=discover_pq(pq_executable),
            runners=detect_runners(),
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
        return render_input(setup)

    @app.post("/api/plan/render", response_model=PlanRenderResult)
    def render_plan(request: RunPlanRequest) -> PlanRenderResult:
        return render_run_plan(
            request,
            pq=discover_pq(pq_executable),
            runners=detect_runners(),
        )

    @app.post("/api/project/export")
    def export_project(request: ExportRequest) -> Response:
        if plan_requested(request.calculators, request.equilibration):
            return _export_plan(
                request,
                pq_executable=pq_executable,
            )
        rendered = render_input(request.setup)
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
    pq_executable: str | None,
) -> Response:
    pq = discover_pq(pq_executable)
    runners = detect_runners()
    plan_request = RunPlanRequest(
        setup=request.setup,
        calculators=request.calculators,
        equilibration=request.equilibration,
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
    if request.structure.cell_generated and request.setup.ensemble == "NPT":
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
    structure_content = format_pq_restart(exported_structure)
    structure_hash = sha256(structure_content.encode("utf-8")).hexdigest()
    if request.preparation and request.preparation.prepared_sha256 != structure_hash:
        raise HTTPException(
            status_code=422,
            detail=(
                "Prepared coordinates do not match the recorded "
                "perturbation. Apply the preparation again."
            ),
        )

    input_files = [
        {
            "name": item.name,
            "sha256": sha256(item.input_text.encode("utf-8")).hexdigest(),
            "stage": item.stage_id,
            "stage_index": item.stage_index,
            "stage_count": item.stage_count,
            "calculator": item.calculator_id,
            "start_file": item.start_file,
            "restart_file": item.restart_file,
        }
        for item in rendered.files
    ]
    selected_ids = {item.calculator_id for item in rendered.files}
    aliases = {"mace": "mace_mp"}
    runner_by_id = {item.id: item for item in runners}
    environment_calculators = []
    for runner_id in sorted(selected_ids):
        status = runner_by_id.get(aliases.get(runner_id, runner_id))
        environment_calculators.append(
            {
                "id": runner_id,
                "detected": bool(status and status.ready),
                "version": status.version if status else None,
            }
        )

    manifest = {
        "schema_version": 2,
        "project_name": project_name,
        "pqsetup_version": __version__,
        "target_pq_release": TARGET_PQ_RELEASE,
        "plan": plan_request.model_dump(mode="json"),
        "files": {
            "inputs": input_files,
            "structure": {
                "name": structure_name,
                "sha256": structure_hash,
            },
        },
        "execution_order": [item.name for item in rendered.files],
        "environment": {
            "pq_detected": pq.found,
            "pq_version": pq.version,
            "calculators": environment_calculators,
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

    archive = io.BytesIO()
    with zipfile.ZipFile(
        archive,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as bundle:
        for item in rendered.files:
            bundle.writestr(item.name, item.input_text)
        bundle.writestr(structure_name, structure_content)
        bundle.writestr(
            "pqproject.json",
            json.dumps(manifest, indent=2) + "\n",
        )
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_name}.zip"'},
    )


app = create_app()
