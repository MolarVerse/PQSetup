from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Literal

import pytest

from pqsetup.executable import discover_pq
from pqsetup.input_writer import render_input
from pqsetup.models import SimulationSetup
from pqsetup.runners import detect_runners
from pqsetup.structures import format_pq_restart, parse_structure_bytes


DATA = Path(__file__).parent / "data"


@pytest.mark.integration
def test_unicode_header_runs_in_pq(tmp_path: Path) -> None:
    pq = discover_pq()
    runner = next(item for item in detect_runners() if item.id == "ase_xtb")
    if not pq.found or not pq.executable:
        pytest.skip("PQ is not available.")
    if not runner.ready:
        pytest.skip("ASE-XTB is not available.")

    setup = SimulationSetup(
        ensemble="NVT",
        runner="ase_xtb",
        start_file="structure.rst",
        file_prefix="water-smoke",
        steps=1,
        overwrite_output=True,
    )
    rendered = render_input(setup)
    assert rendered.valid
    assert rendered.input_text.startswith("# ╭─ PQSetup")
    assert "╰─" in rendered.input_text
    shutil.copyfile(DATA / "water.rst", tmp_path / "structure.rst")
    input_path = tmp_path / "run.in"
    input_path.write_text(rendered.input_text, encoding="utf-8")

    result = subprocess.run(
        [pq.executable, input_path.name],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "PQ ended normally" in output


@pytest.mark.integration
@pytest.mark.parametrize(
    ("ensemble", "thermostat", "manostat"),
    [
        ("NVT", "berendsen", None),
        ("NVT", "velocity_rescaling", None),
        ("NVT", "langevin", None),
        ("NVT", "nh-chain", None),
        ("NPT", "velocity_rescaling", "berendsen"),
        ("NPT", "velocity_rescaling", "stochastic_rescaling"),
    ],
)
def test_every_released_coupling_runs_in_pq(
    tmp_path: Path,
    ensemble: Literal["NVT", "NPT"],
    thermostat: str,
    manostat: str | None,
) -> None:
    pq = discover_pq()
    runner = next(item for item in detect_runners() if item.id == "ase_xtb")
    if not pq.found or not pq.executable:
        pytest.skip("PQ is not available.")
    if not runner.ready:
        pytest.skip("ASE-XTB is not available.")

    setup = SimulationSetup(
        ensemble=ensemble,
        thermostat=thermostat,
        manostat=manostat,
        pressure_bar=1.01325 if ensemble == "NPT" else None,
        runner="ase_xtb",
        start_file="structure.rst",
        file_prefix="coupling-smoke",
        steps=1,
        overwrite_output=True,
    )
    rendered = render_input(setup)
    assert rendered.valid
    shutil.copyfile(DATA / "water.rst", tmp_path / "structure.rst")
    input_path = tmp_path / "run.in"
    input_path.write_text(rendered.input_text, encoding="utf-8")

    result = subprocess.run(
        [pq.executable, input_path.name],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "PQ ended normally" in output


@pytest.mark.integration
@pytest.mark.parametrize("ensemble", ["NVT", "NVE"])
def test_generated_vacuum_cell_runs_in_pq(
    tmp_path: Path,
    ensemble: Literal["NVT", "NVE"],
) -> None:
    pq = discover_pq()
    runner = next(item for item in detect_runners() if item.id == "ase_xtb")
    if not pq.found or not pq.executable:
        pytest.skip("PQ is not available.")
    if not runner.ready:
        pytest.skip("ASE-XTB is not available.")

    structure = parse_structure_bytes(
        "water.xyz",
        (DATA / "water.xyz").read_bytes(),
    )
    setup = SimulationSetup(
        ensemble=ensemble,
        runner="ase_xtb",
        start_file="structure.rst",
        file_prefix=f"water-{ensemble.lower()}",
        steps=1,
        overwrite_output=True,
    )
    rendered = render_input(setup)
    assert rendered.valid
    (tmp_path / "structure.rst").write_text(
        format_pq_restart(structure),
        encoding="utf-8",
    )
    input_path = tmp_path / "run.in"
    input_path.write_text(rendered.input_text, encoding="utf-8")

    result = subprocess.run(
        [pq.executable, input_path.name],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "PQ ended normally" in output
