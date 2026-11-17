from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.models import PQStatus, RunnerStatus, SimulationSetup
from pqsetup.run_script import python_requirements, render_run_script
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

prefix=$(sed -n 's/^file_prefix = \\([^;]*\\);.*/\\1/p' "$input_file")
: > "$prefix.en"
printf '*                          PQ ended normally                            *\\n'
"""


@pytest.fixture(autouse=True)
def _python_with_ase(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Put a python3 that has ASE (this interpreter) first on PATH."""
    directory = tmp_path / "python bin"
    directory.mkdir()
    shim = directory / "python3"
    shim.write_text(f'#!/bin/sh\nexec "{sys.executable}" "$@"\n')
    shim.chmod(0o755)
    monkeypatch.setenv("PATH", f"{directory}{os.pathsep}{os.environ['PATH']}")
    return shim


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


def test_python_requirements_follow_the_calculator() -> None:
    assert python_requirements(["mace_off", "mace_off"]) == [
        ("python3", "ase"),
        ("python3", "mace"),
    ]
    assert python_requirements(["ase_xtb"]) == [("python3", "ase")]
    assert python_requirements(["pyscf"]) == [("python", "pyscf")]
    assert python_requirements(["molecular_mechanics", "dftbplus"]) == []


def test_run_script_text_lists_outputs_and_modules() -> None:
    script = render_run_script(
        ["run-01.in"],
        output_prefixes=["human ethanol-01"],
        python_modules=[("python3", "mace")],
    )

    assert "output_prefixes=('human ethanol-01')" in script
    assert "output_suffixes=(.rst .log " in script
    assert "    python3 mace mace-torch" in script
    assert "--fresh" in script
    assert "overwrite" not in script.replace("does not overwrite", "")


def _bundle(archive_content: bytes, tmp_path: Path) -> tuple[Path, Path, dict]:
    bundle_directory = tmp_path / "run package"
    with zipfile.ZipFile(io.BytesIO(archive_content)) as archive:
        archive.extractall(bundle_directory)
    executable = tmp_path / "PQ"
    executable.write_text(_FAKE_PQ)
    executable.chmod(0o755)
    environment = os.environ.copy()
    environment["FAKE_PQ_RECORD"] = str(tmp_path / "executed-inputs.txt")
    return bundle_directory, executable, environment


def _launch(
    bundle_directory: Path,
    executable: Path,
    environment: dict,
    *options: str,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(bundle_directory / "run.sh"), *options, str(executable)],
        cwd=bundle_directory,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def test_missing_calculator_module_stops_before_pq_runs(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    _python_with_ase: Path,
) -> None:
    bundle_directory, executable, environment = _bundle(
        _export(_client(monkeypatch)), tmp_path
    )
    _python_with_ase.write_text("#!/bin/sh\nexit 1\n")

    completed = _launch(bundle_directory, executable, environment)

    assert completed.returncode == 3
    assert "Python module ase not found by python3" in completed.stderr
    assert "python -m pip install ase" in completed.stderr
    assert not (tmp_path / "executed-inputs.txt").exists()
    assert not (bundle_directory / "run-logs").exists()

    skipped = _launch(bundle_directory, executable, environment, "--skip-check")
    assert skipped.returncode == 0, skipped.stderr


def test_retry_refuses_earlier_outputs_and_fresh_keeps_them(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    bundle_directory, executable, environment = _bundle(
        _export(_client(monkeypatch)), tmp_path
    )
    environment["FAKE_PQ_MODE"] = "nonzero"
    failed = _launch(bundle_directory, executable, environment)
    assert failed.returncode == 23
    assert "--fresh" in failed.stderr

    environment["FAKE_PQ_MODE"] = "success"
    record = tmp_path / "executed-inputs.txt"
    record.unlink()
    refused = _launch(bundle_directory, executable, environment)

    assert refused.returncode == 4
    assert "water-eq.en" in refused.stderr
    assert "run-logs" in refused.stderr
    assert not record.exists()

    retried = _launch(bundle_directory, executable, environment, "--fresh")

    assert retried.returncode == 0, retried.stderr
    assert "Moved 3 earlier outputs to attempt-1/" in retried.stdout
    kept = bundle_directory / "attempt-1"
    assert sorted(path.name for path in kept.iterdir()) == [
        "run-logs",
        "water-01.en",
        "water-eq.en",
    ]
    assert sorted(path.name for path in (kept / "run-logs").iterdir()) == [
        "run-01.log",
        "run-02.log",
        "run-eq.log",
    ]
    assert (bundle_directory / "water-03.en").exists()
    assert (bundle_directory / "structure.rst").exists()

    again = _launch(bundle_directory, executable, environment, "--fresh")
    assert again.returncode == 0, again.stderr
    assert (bundle_directory / "attempt-2" / "water-03.en").exists()
    assert (bundle_directory / "attempt-1" / "water-01.en").exists()
