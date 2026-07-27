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
    PerturbationResult,
    RenderResult,
    SimulationSetup,
    StructureAnalysis,
)
from .presets import list_presets
from .runners import detect_runners
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

    @app.post("/api/project/export")
    def export_project(request: ExportRequest) -> Response:
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


app = create_app()
