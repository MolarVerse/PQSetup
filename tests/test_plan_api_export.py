from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.models import (
    PQStatus,
    PQValidationResult,
    RunnerStatus,
    SimulationSetup,
)
from pqsetup.structures import parse_structure_bytes


DATA = Path(__file__).parent / "data"


def _pq(
    *,
    found: bool = True,
    validation_available: bool = False,
) -> PQStatus:
    return PQStatus(
        found=found,
        executable="/tools/PQ" if found else None,
        version="v0.6.4" if found else None,
        source="test" if found else None,
        detail="Ready." if found else "Not found.",
        validation_available=validation_available,
        validation_scopes=(["portable", "installed"] if validation_available else []),
    )


def _runner(
    *,
    installed: bool = True,
    ready: bool | None = None,
    detail: str | None = None,
) -> RunnerStatus:
    return RunnerStatus(
        id="ase_xtb",
        label="ASE · xTB",
        supported=True,
        installed=installed,
        ready=installed if ready is None else ready,
        version="1.0" if installed else None,
        detail=detail or ("Detected." if installed else "Not detected."),
    )


def _client(
    monkeypatch,
    *,
    pq_found: bool = True,
    installed: bool = True,
    ready: bool | None = None,
    detail: str | None = None,
) -> TestClient:
    monkeypatch.setattr(pqsetup.api, "discover_pq", lambda _: _pq(found=pq_found))
    monkeypatch.setattr(
        pqsetup.api,
        "detect_runners",
        lambda _: [_runner(installed=installed, ready=ready, detail=detail)],
    )
    return TestClient(create_app())


def _project_payload(
    *,
    sampling_run_count: int | None = 3,
    equilibration: bool = True,
) -> dict[str, object]:
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
        random_seed=200,
    )
    payload: dict[str, object] = {
        "setup": setup.model_dump(mode="json"),
        "structure": structure.model_dump(mode="json"),
        "project_name": "water-study",
        "equilibration": (
            {
                "enabled": True,
                "steps": 5000,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
                "thermostat": "berendsen",
            }
            if equilibration
            else None
        ),
    }
    if sampling_run_count is not None:
        payload["sampling_run_count"] = sampling_run_count
    return payload


def test_plan_api_preserves_exact_execution_chain(monkeypatch) -> None:
    client = _client(monkeypatch)
    payload = _project_payload()

    response = client.post(
        "/api/plan/render",
        json={
            "setup": payload["setup"],
            "equilibration": payload["equilibration"],
            "sampling_run_count": payload["sampling_run_count"],
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["valid"]
    assert [item["name"] for item in result["files"]] == [
        "run-eq.in",
        "run-01.in",
        "run-02.in",
        "run-03.in",
    ]
    assert [item["start_file"] for item in result["files"]] == [
        "structure.rst",
        "water-eq.rst",
        "water-01.rst",
        "water-02.rst",
    ]
    assert [item["restart_file"] for item in result["files"]] == [
        "water-eq.rst",
        "water-01.rst",
        "water-02.rst",
        "water-03.rst",
    ]
    assert [item["segment_index"] for item in result["files"]] == [
        None,
        1,
        2,
        3,
    ]


def test_plan_export_manifest_and_archive_are_self_consistent(monkeypatch) -> None:
    client = _client(monkeypatch)

    response = client.post("/api/project/export", json=_project_payload())

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
        inputs = manifest["files"]["inputs"]
        input_names = [item["name"] for item in inputs]
        assert manifest["schema_version"] == 3
        assert manifest["plan"]["sampling_run_count"] == 3
        assert "structure" not in manifest["plan"]
        assert "calculators" not in manifest["plan"]
        assert input_names == [
            "run-eq.in",
            "run-01.in",
            "run-02.in",
            "run-03.in",
        ]
        assert manifest["execution_order"] == input_names
        assert archive.namelist() == [
            *input_names,
            manifest["files"]["structure"]["name"],
            manifest["files"]["run_script"]["name"],
            "pqproject.json",
        ]
        assert manifest["environment"]["calculator"] == {
            "id": "ase_xtb",
            "detected": True,
            "ready": True,
            "version": "1.0",
            "detail": "Detected.",
        }
        assert [item["stage_index"] for item in inputs] == [1, 2, 3, 4]
        assert [item["stage_count"] for item in inputs] == [4, 4, 4, 4]
        assert [item["segment_index"] for item in inputs] == [None, 1, 2, 3]
        assert [item["segment_count"] for item in inputs] == [None, 3, 3, 3]
        for item in inputs:
            content = archive.read(item["name"])
            assert hashlib.sha256(content).hexdigest() == item["sha256"]

        for previous, current in zip(inputs[:-1], inputs[1:], strict=True):
            assert current["start_file"] == previous["restart_file"]


def test_export_validates_only_distinct_generated_shapes(monkeypatch) -> None:
    discoveries = 0

    def discover(_: str | None) -> PQStatus:
        nonlocal discoveries
        discoveries += 1
        return _pq(validation_available=True)

    validated: list[str] = []

    def validate(
        _: str,
        input_file: Path,
        *,
        scope: str,
    ) -> PQValidationResult:
        validated.append(input_file.name)
        assert scope == "portable"
        assert (input_file.parent / "run-eq.in").is_file()
        assert (input_file.parent / "run-05.in").is_file()
        assert (input_file.parent / "structure.rst").is_file()
        return PQValidationResult(
            schema="pq.validation",
            schema_version=1,
            valid=True,
            input=input_file.name,
            scope="portable",
            diagnostics=(
                [
                    {
                        "severity": "warning",
                        "message": "Review this setting.",
                        "file": input_file.name,
                        "line": 8,
                    }
                ]
                if input_file.name == "run-eq.in"
                else []
            ),
        )

    monkeypatch.setattr(pqsetup.api, "discover_pq", discover)
    monkeypatch.setattr(pqsetup.api, "detect_runners", lambda _: [_runner()])
    monkeypatch.setattr(pqsetup.api, "validate_pq_input", validate)
    client = TestClient(create_app())
    payload = _project_payload(sampling_run_count=5)

    plan = client.post(
        "/api/plan/render",
        json={
            "setup": payload["setup"],
            "equilibration": payload["equilibration"],
            "sampling_run_count": payload["sampling_run_count"],
        },
    )
    assert plan.status_code == 200
    assert validated == []

    response = client.post("/api/project/export", json=payload)

    assert response.status_code == 200, response.text
    assert discoveries == 1
    assert validated == ["run-eq.in", "run-01.in", "run-02.in"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
    results = manifest["validation"]["results"]
    assert [item["input"] for item in results] == validated
    assert results[0]["diagnostics"][0]["line"] == 8


def test_export_returns_pq_diagnostics_without_losing_location(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        pqsetup.api,
        "discover_pq",
        lambda _: _pq(validation_available=True),
    )
    monkeypatch.setattr(pqsetup.api, "detect_runners", lambda _: [_runner()])
    monkeypatch.setattr(
        pqsetup.api,
        "validate_pq_input",
        lambda _, input_file, *, scope: PQValidationResult(
            schema="pq.validation",
            schema_version=1,
            valid=False,
            input=input_file.name,
            scope=scope,
            diagnostics=[
                {
                    "severity": "error",
                    "message": "nstep must be at least 1",
                    "file": input_file.name,
                    "line": 17,
                }
            ],
        ),
    )
    client = TestClient(create_app())

    response = client.post(
        "/api/project/export",
        json=_project_payload(sampling_run_count=1, equilibration=False),
    )

    assert response.status_code == 422
    assert response.json()["detail"] == [
        {
            "severity": "error",
            "message": "nstep must be at least 1",
            "file": "run-01.in",
            "line": 17,
        }
    ]


def test_missing_environment_is_recorded_as_warning(monkeypatch) -> None:
    client = _client(monkeypatch, pq_found=False, installed=False)

    response = client.post("/api/project/export", json=_project_payload())

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
    warnings = {item["code"]: item["severity"] for item in manifest["diagnostics"]}
    assert warnings["environment.pq_not_detected"] == "warning"
    assert warnings["runner.not_detected"] == "warning"
    assert not manifest["environment"]["pq_detected"]
    assert not manifest["environment"]["calculator"]["detected"]
    assert not manifest["environment"]["calculator"]["ready"]
    assert manifest["validation"] == {
        "status": "not_run",
        "scope": "portable",
        "detail": "Not found.",
        "results": [],
    }


def test_manifest_distinguishes_detection_from_incomplete_setup(monkeypatch) -> None:
    client = _client(
        monkeypatch,
        installed=True,
        ready=False,
        detail="ASE detected. PQ script not found.",
    )

    response = client.post("/api/project/export", json=_project_payload())

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
    calculator = manifest["environment"]["calculator"]
    assert calculator["detected"]
    assert not calculator["ready"]
    assert calculator["detail"] == "ASE detected. PQ script not found."
    warnings = {item["code"] for item in manifest["diagnostics"]}
    assert "runner.incomplete" in warnings
    assert "runner.not_detected" not in warnings


def test_legacy_export_without_protocol_fields_remains_schema_one(
    monkeypatch,
) -> None:
    client = _client(monkeypatch)
    payload = _project_payload(
        sampling_run_count=None,
        equilibration=False,
    )

    response = client.post("/api/project/export", json=payload)

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
    assert manifest["schema_version"] == 1
    assert manifest["files"]["input"]["name"] == "water-study.in"


@pytest.mark.parametrize("sampling_run_count", [0, 1000])
def test_plan_api_rejects_out_of_range_counts(
    monkeypatch,
    sampling_run_count: int,
) -> None:
    client = _client(monkeypatch)
    payload = _project_payload(sampling_run_count=sampling_run_count)

    response = client.post(
        "/api/plan/render",
        json={
            "setup": payload["setup"],
            "equilibration": payload["equilibration"],
            "sampling_run_count": payload["sampling_run_count"],
        },
    )

    assert response.status_code == 422


def test_plan_api_defaults_sampling_run_count_to_one(monkeypatch) -> None:
    client = _client(monkeypatch)
    payload = _project_payload()

    response = client.post(
        "/api/plan/render",
        json={
            "setup": payload["setup"],
            "equilibration": payload["equilibration"],
        },
    )

    assert response.status_code == 200
    assert [item["name"] for item in response.json()["files"]] == [
        "run-eq.in",
        "run-01.in",
    ]


def test_export_explicitly_rejects_legacy_calculators(monkeypatch) -> None:
    client = _client(monkeypatch)
    payload = _project_payload()
    payload["calculators"] = [{"runner_id": "ase_xtb"}]

    response = client.post("/api/project/export", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == "calculators"
