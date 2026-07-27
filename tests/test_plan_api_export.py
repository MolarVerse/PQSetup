from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.models import PQStatus, RunnerStatus, SimulationSetup
from pqsetup.structures import parse_structure_bytes


DATA = Path(__file__).parent / "data"


def _pq(*, found: bool = True) -> PQStatus:
    return PQStatus(
        found=found,
        executable="/tools/PQ" if found else None,
        version="v0.6.4" if found else None,
        source="test" if found else None,
        detail="Ready." if found else "Not found.",
    )


def _runner(runner_id: str, *, installed: bool = True) -> RunnerStatus:
    return RunnerStatus(
        id=runner_id,
        label=runner_id,
        supported=True,
        installed=installed,
        ready=installed,
        detail="Ready." if installed else "Not installed.",
    )


def _client(
    monkeypatch,
    *,
    pq_found: bool = True,
    installed: bool = True,
) -> TestClient:
    statuses = [
        _runner("ase_xtb", installed=installed),
        _runner("mace_off", installed=installed),
    ]
    monkeypatch.setattr(pqsetup.api, "discover_pq", lambda _: _pq(found=pq_found))
    monkeypatch.setattr(pqsetup.api, "detect_runners", lambda: statuses)
    return TestClient(create_app())


def _project_payload() -> dict[str, object]:
    structure = parse_structure_bytes(
        "water.rst",
        (DATA / "water.rst").read_bytes(),
    )
    setup = SimulationSetup(
        ensemble="NVT",
        runner="ase_xtb",
        start_file="structure.rst",
        file_prefix="water",
        steps=2000,
    )
    return {
        "setup": setup.model_dump(mode="json"),
        "structure": structure.model_dump(mode="json"),
        "project_name": "water-study",
        "calculators": [
            {"runner_id": "ase_xtb"},
            {"runner_id": "mace_off"},
        ],
        "equilibration": {
            "enabled": True,
            "steps": 5000,
            "timestep_fs": 0.5,
            "temperature_k": 298.15,
            "thermostat": "berendsen",
        },
    }


def test_plan_api_preserves_stage_links(monkeypatch) -> None:
    client = _client(monkeypatch)
    payload = _project_payload()

    response = client.post(
        "/api/plan/render",
        json={
            "setup": payload["setup"],
            "calculators": payload["calculators"],
            "equilibration": payload["equilibration"],
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["valid"]
    assert len(result["files"]) == 4
    for calculator in ("ase_xtb", "mace_off"):
        stages = [
            item
            for item in result["files"]
            if item["calculator_id"] == calculator
        ]
        equilibration, sampling = stages
        assert sampling["start_file"] == equilibration["restart_file"]
        assert "init_velocities = true;" not in sampling["input_text"]


def test_plan_export_is_self_consistent(monkeypatch) -> None:
    client = _client(monkeypatch)

    response = client.post("/api/project/export", json=_project_payload())

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
        inputs = manifest["files"]["inputs"]
        input_names = [item["name"] for item in inputs]
        assert manifest["schema_version"] == 2
        assert len(inputs) == 4
        assert manifest["execution_order"] == input_names
        assert manifest["plan"]["equilibration"]["enabled"]
        assert {
            item["runner_id"] for item in manifest["plan"]["calculators"]
        } == {"ase_xtb", "mace_off"}
        assert set(archive.namelist()) == {
            *input_names,
            manifest["files"]["structure"]["name"],
            "pqproject.json",
        }
        for item in inputs:
            content = archive.read(item["name"])
            assert hashlib.sha256(content).hexdigest() == item["sha256"]

        for calculator in ("ase_xtb", "mace_off"):
            chain = [
                item for item in inputs if item["calculator"] == calculator
            ]
            equilibration, sampling = chain
            assert sampling["start_file"] == equilibration["restart_file"]


def test_missing_environment_is_recorded_as_warning(monkeypatch) -> None:
    client = _client(monkeypatch, pq_found=False, installed=False)

    response = client.post("/api/project/export", json=_project_payload())

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
    warnings = {
        item["code"]: item["severity"] for item in manifest["diagnostics"]
    }
    assert warnings["environment.pq_not_detected"] == "warning"
    assert warnings["runner.not_detected"] == "warning"
    assert not manifest["environment"]["pq_detected"]
    assert not any(
        item["detected"] for item in manifest["environment"]["calculators"]
    )


def test_legacy_render_payload_remains_supported() -> None:
    response = TestClient(create_app()).post(
        "/api/input/render",
        json={
            "ensemble": "NVT",
            "runner": "ase_xtb",
            "start_file": "structure.rst",
            "file_prefix": "legacy",
        },
    )

    assert response.status_code == 200
    assert response.json()["valid"]
    assert "restart_file = legacy.rst;" in response.json()["input_text"]
