from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.cli import _print_doctor, build_parser, main
from pqsetup.models import DoctorReport, PQStatus, RunnerStatus, SimulationSetup
from pqsetup.release import TARGET_PQ_RELEASE
from pqsetup.structures import parse_structure_bytes
from pqsetup.structures import perturb_structure


DATA = Path(__file__).parent / "data"


def test_bootstrap_reports_pq_runners_and_presets() -> None:
    response = TestClient(create_app()).get("/api/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["pq"]["found"]
    assert payload["pq"]["version"] == "v0.6.4-5a09e6a1"
    assert payload["target_pq_release"] == TARGET_PQ_RELEASE
    assert {item["id"] for item in payload["presets"]} == {
        "ambient-npt",
        "ambient-nvt",
        "nve",
    }
    runner_ids = {item["id"] for item in payload["runners"]}
    assert "g16" not in runner_ids
    assert "fennol" not in runner_ids
    assert "mace_cpp" not in runner_ids


def test_analyze_and_perturb_upload_end_to_end() -> None:
    client = TestClient(create_app())
    content = (DATA / "water.rst").read_bytes()

    analysis = client.post(
        "/api/structure/analyze",
        files={"file": ("water.rst", content, "text/plain")},
    )
    perturbation = client.post(
        "/api/structure/perturb",
        files={"file": ("water.rst", content, "text/plain")},
        data={"sigma": "0.01", "seed": "17"},
    )

    assert analysis.status_code == 200
    assert analysis.json()["summary"]["formula"] == "H2O"
    assert analysis.json()["valid"]
    assert perturbation.status_code == 200
    assert perturbation.json()["seed"] == 17
    assert perturbation.json()["restart_filename"] == "water-prepared.rst"


def test_invalid_structure_uploads_are_recoverable() -> None:
    client = TestClient(create_app(), raise_server_exceptions=False)
    uploads = [
        ("empty.xyz", b""),
        ("truncated.xyz", b"2\nincomplete\nH 0 0 0\n"),
        ("thing.weird", b"not a structure\n"),
    ]

    for filename, content in uploads:
        response = client.post(
            "/api/structure/analyze",
            files={"file": (filename, content, "application/octet-stream")},
        )

        assert response.status_code == 400
        assert isinstance(response.json()["detail"], str)


def test_oversized_structure_upload_is_rejected(
    monkeypatch,
) -> None:
    monkeypatch.setattr(pqsetup.api, "_MAX_STRUCTURE_BYTES", 16)
    response = TestClient(create_app()).post(
        "/api/structure/analyze",
        files={"file": ("large.xyz", b"x" * 17, "text/plain")},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Structure files must be 100 MB or smaller."


def test_non_finite_ase_coordinates_are_rejected() -> None:
    client = TestClient(create_app(), raise_server_exceptions=False)

    for value in ("nan", "inf", "-inf"):
        content = f"1\\ninvalid\\nH {value} 0 0\\n".encode()
        response = client.post(
            "/api/structure/analyze",
            files={"file": ("invalid.xyz", content, "text/plain")},
        )

        assert response.status_code == 400
        assert isinstance(response.json()["detail"], str)


def test_ase_format_named_without_an_extension_is_supported() -> None:
    client = TestClient(create_app())
    poscar = b"hydrogen\n1.0\n10 0 0\n0 10 0\n0 0 10\nH\n1\nCartesian\n0 0 0\n"

    response = client.post(
        "/api/structure/analyze",
        files={"file": ("POSCAR", poscar, "text/plain")},
    )

    assert response.status_code == 200
    assert response.json()["summary"]["formula"] == "H"
    assert response.json()["structure"]["periodic"] == [True, True, True]


def test_render_and_export_project() -> None:
    client = TestClient(create_app())
    setup = SimulationSetup(
        ensemble="NPT",
        runner="ase_xtb",
        pressure_bar=1.01325,
        manostat="stochastic_rescaling",
    )
    structure = parse_structure_bytes("water.rst", (DATA / "water.rst").read_bytes())

    render = client.post("/api/input/render", json=setup.model_dump(mode="json"))
    export = client.post(
        "/api/project/export",
        json={
            "setup": setup.model_dump(mode="json"),
            "structure": structure.model_dump(mode="json"),
            "project_name": "water-run",
        },
    )

    assert render.status_code == 200
    assert render.json()["valid"]
    assert export.status_code == 200
    with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
        assert set(archive.namelist()) == {
            "water-run.in",
            "structure.rst",
            "pqproject.json",
        }
        setup_text = archive.read("water-run.in").decode()
        assert "start_file = structure.rst;" in setup_text
        manifest = json.loads(archive.read("pqproject.json"))
        assert manifest["project_name"] == "water-run"
        assert manifest["schema_version"] == 1
        assert manifest["target_pq_release"] == TARGET_PQ_RELEASE
        assert manifest["structure"]["velocities"] == "initialized_by_pq"
        assert manifest["files"]["structure"]["name"] == "structure.rst"
        assert "atoms" not in manifest["structure"]


def test_generated_vacuum_cell_is_exportable_except_for_npt() -> None:
    client = TestClient(create_app())
    structure = parse_structure_bytes("water.xyz", (DATA / "water.xyz").read_bytes())
    payload = {
        "setup": SimulationSetup(ensemble="NVT").model_dump(mode="json"),
        "structure": structure.model_dump(mode="json"),
        "project_name": "isolated-water",
    }

    nvt = client.post("/api/project/export", json=payload)
    payload["setup"] = SimulationSetup(
        ensemble="NPT",
        pressure_bar=1.01325,
        manostat="stochastic_rescaling",
    ).model_dump(mode="json")
    npt = client.post("/api/project/export", json=payload)

    assert nvt.status_code == 200
    assert npt.status_code == 422
    assert "physical periodic cell" in npt.json()["detail"]


def test_export_records_and_verifies_perturbation() -> None:
    client = TestClient(create_app())
    source = parse_structure_bytes("water.rst", (DATA / "water.rst").read_bytes())
    prepared = perturb_structure(source, 0.01, 17)
    setup = SimulationSetup(
        ensemble="NVT",
        runner="ase_xtb",
        start_file=prepared.restart_filename,
    )
    metadata = {
        "kind": "gaussian-position-jitter",
        "sigma_angstrom": prepared.sigma_angstrom,
        "seed": prepared.seed,
        "source_sha256": prepared.source_sha256,
        "prepared_sha256": prepared.prepared_sha256,
    }
    payload = {
        "setup": setup.model_dump(mode="json"),
        "structure": prepared.structure.model_dump(mode="json"),
        "project_name": "prepared-water",
        "preparation": metadata,
    }

    response = client.post("/api/project/export", json=payload)

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
        assert manifest["preparation"] == metadata
        assert manifest["files"]["structure"]["sha256"] == prepared.prepared_sha256

    payload["preparation"] = {
        **metadata,
        "prepared_sha256": "0" * 64,
    }
    mismatch = client.post("/api/project/export", json=payload)
    assert mismatch.status_code == 422
    assert "do not match" in mismatch.json()["detail"]


def test_export_velocity_choice_is_explicit() -> None:
    client = TestClient(create_app())
    structure = parse_structure_bytes("legacy.rst", (DATA / "legacy.rst").read_bytes())

    def exported_restart(initialize: bool) -> str:
        setup = SimulationSetup(
            ensemble="NVT",
            runner="ase_xtb",
            initialize_velocities=initialize,
        )
        response = client.post(
            "/api/project/export",
            json={
                "setup": setup.model_dump(mode="json"),
                "structure": structure.model_dump(mode="json"),
                "project_name": "legacy",
            },
        )
        assert response.status_code == 200
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            return archive.read("structure.rst").decode()

    regenerated = exported_restart(True).splitlines()[2].split()
    preserved = exported_restart(False).splitlines()[2].split()

    assert len(regenerated) == 6
    assert len(preserved) == 12


def test_validate_cli_checks_input_and_structure(tmp_path: Path, capsys) -> None:
    (tmp_path / "structure.rst").write_bytes((DATA / "water.rst").read_bytes())
    input_file = tmp_path / "run.in"
    input_file.write_text(
        "jobtype = qm-md; nstep = 5; timestep = 0.5; start_file = structure.rst;\n",
        encoding="utf-8",
    )

    exit_code = main(["validate", str(input_file), "--json"])
    payload = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert payload == []


def test_pq_executable_option_works_before_or_after_serve() -> None:
    parser = build_parser()

    default_serve = parser.parse_args(["--pq-executable", "/tmp/PQ-custom"])
    explicit_serve = parser.parse_args(["serve", "--pq-executable", "/tmp/PQ-other"])

    assert default_serve.pq_executable == "/tmp/PQ-custom"
    assert explicit_serve.command_pq_executable == "/tmp/PQ-other"
    assert parser.parse_args(["serve"]).port == 8888


def test_doctor_reports_incomplete_setup_without_calling_it_missing(capsys) -> None:
    _print_doctor(
        DoctorReport(
            pq=PQStatus(
                found=True,
                executable="/tools/PQ",
                version="v0.6.4",
                detail="Detected.",
            ),
            runners=[
                RunnerStatus(
                    id="dftbplus",
                    label="DFTB+",
                    supported=True,
                    installed=True,
                    ready=False,
                    detail="DFTB+ detected. PQ script not found.",
                )
            ],
            diagnostics=[],
        )
    )

    output = capsys.readouterr().out
    assert "PQ             detected" in output
    assert "DFTB+          setup incomplete · DFTB+ detected." in output
    assert "missing" not in output
    assert "ready" not in output
