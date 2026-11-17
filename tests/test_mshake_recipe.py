"""PQ's ``examples/h2o_mm-mshake``: GUFF (force-field = off) + M-SHAKE water."""

from __future__ import annotations

import io
import os
import subprocess
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.executable import discover_pq
from pqsetup.models import PQStatus, SimulationSetup
from pqsetup.pq_validation import validate_pq_input
from pqsetup.structures import parse_structure_bytes


# Three molecules of the example box; files as shipped with the example.
RESTART = """\
Box   39.4491 39.4491 39.4491  90 90 90
O 1 1 2.50541928 -13.48610577 1.09564113 0 0 0 0 0 0
H 2 1 2.97343814 -13.08693020 0.36225889 0 0 0 0 0 0
H 3 1 2.30747115 -12.75476654 1.68061045 0 0 0 0 0 0
O 1 1 9.56164216 0.83428830 -15.47470060 0 0 0 0 0 0
H 2 1 9.89507683 0.29913758 -14.75451468 0 0 0 0 0 0
H 3 1 8.61851199 0.88507178 -15.31927894 0 0 0 0 0 0
O 1 1 -11.86466489 1.28875655 18.49185356 0 0 0 0 0 0
H 2 1 -11.59195579 1.36083854 17.57715945 0 0 0 0 0 0
H 3 1 -11.65922818 0.38551544 18.73306286 0 0 0 0 0 0
"""

MOLDESCRIPTOR = """\
# Molecule Type 1
TIP3P-Water    3   0.0
O              0  -0.834
H              1   0.417
H              1   0.417
"""

GUFF = (
    "1;0;1;0;-1.0;230.96915590253644;-595.067688427684;6.0;582015.099443679;"
    "12.0;" + "0.000000;" * 18 + "\n"
    "1;0;1;1;0.01;-115.48457795126822;" + "0.000000;" * 22 + "\n"
    "1;1;1;1;0.01;57.74228897563411;" + "0.000000;" * 22 + "\n"
)

MSHAKE = """\
3
moltype = 1;
O   0.000000   0.000000   0.000000
H   0.585882   0.756950   0.000000
H   0.585882  -0.756950   0.000000
"""

FILES = {
    "moldescriptor": ("moldescriptor.dat", MOLDESCRIPTOR),
    "guff": ("guff.dat", GUFF),
    "topology": ("shake.top", ""),
    "mshake": ("mshake.top", MSHAKE),
}


def _payload(steps: int = 25000) -> dict[str, object]:
    setup = SimulationSetup(
        job_type="mm-md",
        ensemble="NVT",
        runner=None,
        start_file="input.rst",
        file_prefix="h2o-md-01",
        steps=steps,
        timestep_fs=2.0,
        temperature_k=298.15,
        thermostat="velocity_rescaling",
        thermostat_relaxation_ps=0.1,
        mm_force_field="off",
        coulomb_cutoff_angstrom=12.0,
        moldescriptor_file="moldescriptor.dat",
        guff_file="guff.dat",
        topology_file="shake.top",
        mshake_file="mshake.top",
        extra_settings={"shake": "mshake", "output_freq": 50},
    )
    structure = parse_structure_bytes("input.rst", RESTART.encode())
    return {
        "setup": setup.model_dump(mode="json"),
        "setup_files": [
            {"role": role, "name": name, "content": content}
            for role, (name, content) in FILES.items()
        ],
        "structure": structure.model_dump(mode="json"),
        "project_name": "h2o-mm-mshake",
        "sampling_run_count": 1,
    }


def _export(client: TestClient, payload: dict[str, object], target: Path) -> Path:
    response = client.post("/api/project/export", json=payload)
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        archive.extractall(target)
    return target


def _input_file(directory: Path) -> Path:
    (input_file,) = [
        path for path in directory.rglob("*.in") if "run-01" in path.name
    ]
    return input_file


def test_guff_mshake_example_exports_like_pq_ships_it(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        pqsetup.api,
        "discover_pq",
        lambda _: PQStatus(found=False, detail="Not found."),
    )
    monkeypatch.setattr(pqsetup.api, "detect_runners", lambda _: [])

    directory = _export(TestClient(create_app()), _payload(), tmp_path / "package")
    input_file = _input_file(directory)
    text = input_file.read_text(encoding="utf-8")

    for line in (
        "jobtype = mm-md;",
        "nstep = 25000;",
        "timestep = 2;",
        "thermostat = velocity_rescaling;",
        "t_relaxation = 0.1;",
        "force-field = off;",
        "rcoulomb = 12;",
        "shake = mshake;",
        "output_freq = 50;",
        "moldescriptor_file = moldescriptor.dat;",
        "guff_file = guff.dat;",
        "topology_file = shake.top;",
        "mshake_file = mshake.top;",
    ):
        assert line in text, line
    assert "parameter_file" not in text
    root = input_file.parent
    for name, content in FILES.values():
        assert (root / name).read_text(encoding="utf-8") == content


@pytest.mark.parametrize("shake", ["off", None])
def test_guff_without_constraints_names_no_topology(shake: str | None) -> None:
    payload = _payload()
    setup = payload["setup"]
    assert isinstance(setup, dict)
    setup["extra_settings"] = {} if shake is None else {"shake": shake}
    response = TestClient(create_app()).post("/api/input/render", json=setup)

    text = response.json()["input_text"]
    assert "topology_file" not in text
    assert "mshake_file" not in text


@pytest.mark.integration
def test_guff_mshake_example_passes_real_pq(tmp_path: Path) -> None:
    executable = os.environ.get("PQ_REAL_EXECUTABLE")
    if not executable:
        pytest.skip("Set PQ_REAL_EXECUTABLE to check the M-SHAKE recipe in PQ.")
    pq = discover_pq(executable)
    if not pq.supports_validation("portable"):
        pytest.skip("The selected PQ does not advertise portable validation.")

    directory = _export(
        TestClient(create_app(pq_executable=executable)),
        _payload(steps=2),
        tmp_path / "package",
    )
    input_file = _input_file(directory)
    result = validate_pq_input(executable, input_file, scope="portable")
    assert result.valid, result.diagnostics

    completed = subprocess.run(
        [executable, input_file.name],
        cwd=input_file.parent,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert 'Reading Topology File "shake.top"' in completed.stdout
    (log,) = input_file.parent.glob("*.log")
    assert "M-SHAKE: enabled" in log.read_text(encoding="utf-8")
