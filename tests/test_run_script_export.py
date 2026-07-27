from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.models import PQStatus, RunnerStatus, SimulationSetup
from pqsetup.structures import parse_structure_bytes


DATA = Path(__file__).parent / "data"

_FAKE_PQ = """#!/bin/sh
input_file=$1
printf '%s\\n' "$input_file" >> "$FAKE_PQ_RECORD"

if [ ! -f "$input_file" ]; then
    printf 'Input is missing: %s\\n' "$input_file" >&2
    exit 9
fi

case "${FAKE_PQ_MODE:-success}:$input_file" in
    nonzero:run-02.in)
        printf 'Calculation failed.\\n' >&2
        exit 23
        ;;
    missing-marker:run-02.in)
        printf 'Exception: InputFileError\\n'
        exit 0
        ;;
esac

printf '*                          PQ ended normally                            *\\n'
"""


def _client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(
        pqsetup.api,
        "discover_pq",
        lambda _: PQStatus(
            found=True,
            executable="/tools/PQ",
            version="v0.6.4",
            source="test",
            detail="Ready.",
        ),
    )
    monkeypatch.setattr(
        pqsetup.api,
        "detect_runners",
        lambda _: [
            RunnerStatus(
                id="ase_xtb",
                label="ASE · xTB",
                supported=True,
                installed=True,
                ready=True,
                version="1.0",
                detail="Detected.",
            )
        ],
    )
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
        random_seed=200,
    )
    return {
        "setup": setup.model_dump(mode="json"),
        "structure": structure.model_dump(mode="json"),
        "project_name": "water-study",
        "equilibration": {
            "enabled": True,
            "steps": 5000,
            "timestep_fs": 0.5,
            "temperature_k": 298.15,
            "thermostat": "berendsen",
        },
        "sampling_run_count": 3,
    }


def _export(client: TestClient) -> bytes:
    response = client.post("/api/project/export", json=_project_payload())
    assert response.status_code == 200
    return response.content


def _run_script(
    archive_content: bytes,
    tmp_path: Path,
    *,
    mode: str,
) -> tuple[subprocess.CompletedProcess[str], list[str], Path]:
    bundle_directory = tmp_path / "run package"
    with zipfile.ZipFile(io.BytesIO(archive_content)) as archive:
        archive.extractall(bundle_directory)

    executable_directory = tmp_path / "fake tools"
    executable_directory.mkdir()
    executable = executable_directory / "custom PQ"
    executable.write_text(_FAKE_PQ)
    executable.chmod(0o755)

    record = tmp_path / "executed-inputs.txt"
    environment = os.environ.copy()
    environment["FAKE_PQ_MODE"] = mode
    environment["FAKE_PQ_RECORD"] = str(record)
    completed = subprocess.run(
        ["bash", str(bundle_directory / "run.sh"), str(executable)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    return completed, record.read_text().splitlines(), bundle_directory


def test_schema_three_export_includes_executable_run_script(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive_content = _export(_client(monkeypatch))

    with zipfile.ZipFile(io.BytesIO(archive_content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
        script = archive.read("run.sh")
        script_entry = archive.getinfo("run.sh")

    assert manifest["files"]["run_script"] == {
        "name": "run.sh",
        "sha256": hashlib.sha256(script).hexdigest(),
        "shell": "bash",
    }
    assert (script_entry.external_attr >> 16) & 0o777 == 0o755
    assert script.startswith(b"#!/usr/bin/env bash\n")
    assert b"PQ ended normally" in script


def test_run_script_uses_the_manifest_execution_order(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    archive_content = _export(_client(monkeypatch))
    with zipfile.ZipFile(io.BytesIO(archive_content)) as archive:
        execution_order = json.loads(archive.read("pqproject.json"))["execution_order"]

    completed, executed, bundle_directory = _run_script(
        archive_content,
        tmp_path,
        mode="success",
    )

    assert completed.returncode == 0, completed.stderr
    assert executed == execution_order
    assert "Completed 4 input files." in completed.stdout
    assert sorted(path.name for path in (bundle_directory / "run-logs").iterdir()) == [
        "run-01.log",
        "run-02.log",
        "run-03.log",
        "run-eq.log",
    ]


def test_run_script_resolves_relative_executable_before_entering_package(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    bundle_directory = tmp_path / "package"
    with zipfile.ZipFile(io.BytesIO(_export(_client(monkeypatch)))) as archive:
        archive.extractall(bundle_directory)
    executable = tmp_path / "PQ"
    executable.write_text(_FAKE_PQ)
    executable.chmod(0o755)
    record = tmp_path / "executed-inputs.txt"
    environment = os.environ.copy()
    environment["FAKE_PQ_MODE"] = "success"
    environment["FAKE_PQ_RECORD"] = str(record)

    completed = subprocess.run(
        ["bash", str(bundle_directory / "run.sh"), "./PQ"],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    assert record.read_text().splitlines() == [
        "run-eq.in",
        "run-01.in",
        "run-02.in",
        "run-03.in",
    ]


@pytest.mark.parametrize(
    ("mode", "expected_status", "error"),
    [
        ("nonzero", 23, "run-02.in exited with status 23"),
        (
            "missing-marker",
            1,
            "run-02.in did not report normal completion",
        ),
    ],
)
def test_run_script_stops_before_later_inputs_after_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    mode: str,
    expected_status: int,
    error: str,
) -> None:
    archive_content = _export(_client(monkeypatch))

    completed, executed, bundle_directory = _run_script(
        archive_content,
        tmp_path,
        mode=mode,
    )

    assert completed.returncode == expected_status
    assert executed == ["run-eq.in", "run-01.in", "run-02.in"]
    assert error in completed.stderr
    assert "Completed" not in completed.stdout
    assert not (bundle_directory / "run-logs" / "run-03.log").exists()
