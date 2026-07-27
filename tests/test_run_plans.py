from __future__ import annotations

import pytest

from pqsetup.models import (
    CalculatorSelection,
    EquilibrationStage,
    PQStatus,
    RunPlanRequest,
    RunnerStatus,
    SimulationSetup,
)
from pqsetup.run_plan import render_run_plan


def _setup(**overrides: object) -> SimulationSetup:
    values: dict[str, object] = {
        "ensemble": "NVT",
        "runner": "ase_xtb",
        "start_file": "structure.rst",
        "file_prefix": "water",
        "steps": 2000,
    }
    values.update(overrides)
    return SimulationSetup(**values)


def _status(runner_id: str, *, installed: bool = True) -> RunnerStatus:
    return RunnerStatus(
        id=runner_id,
        label=runner_id,
        supported=True,
        installed=installed,
        ready=installed,
        detail="Ready." if installed else "Not installed.",
    )


def _pq(*, found: bool = True) -> PQStatus:
    return PQStatus(
        found=found,
        executable="/tools/PQ" if found else None,
        version="v0.6.4" if found else None,
        source="test" if found else None,
        detail="Ready." if found else "Not found.",
    )


def test_two_stage_plan_links_restart_files() -> None:
    request = RunPlanRequest(
        setup=_setup(),
        calculators=[
            CalculatorSelection(runner_id="ase_xtb"),
            CalculatorSelection(runner_id="mace_off"),
        ],
        equilibration=EquilibrationStage(
            enabled=True,
            steps=5000,
            thermostat="berendsen",
        ),
    )

    result = render_run_plan(
        request,
        pq=_pq(),
        runners=[_status("ase_xtb"), _status("mace_off")],
    )

    assert result.valid
    assert len(result.files) == 4
    assert len({item.name for item in result.files}) == 4
    assert len({item.restart_file for item in result.files}) == 4

    for calculator in ("ase_xtb", "mace_off"):
        stages = [
            item for item in result.files if item.calculator_id == calculator
        ]
        assert [item.stage_id for item in stages] == [
            "equilibration",
            "sampling",
        ]
        equilibration, sampling = stages
        assert equilibration.start_file == "structure.rst"
        assert sampling.start_file == equilibration.restart_file
        assert f"start_file = {equilibration.restart_file};" in sampling.input_text
        assert "init_velocities = true;" not in sampling.input_text
        assert "restart_file =" in equilibration.input_text
        assert "restart_file =" in sampling.input_text
        assert "rst_file =" not in equilibration.input_text
        assert "rst_file =" not in sampling.input_text


@pytest.mark.parametrize(
    ("runner_id", "script"),
    [
        ("dftbplus", "dftbplus_periodic_stress"),
        ("pyscf", "pyscf_hf.py"),
        ("turbomole", "turbomole_rimp2"),
    ],
)
def test_external_calculators_use_release_scripts(
    runner_id: str,
    script: str,
) -> None:
    result = render_run_plan(
        RunPlanRequest(
            setup=_setup(runner=runner_id),
            calculators=[CalculatorSelection(runner_id=runner_id)],
        ),
        pq=_pq(),
        runners=[_status(runner_id)],
    )

    assert result.valid
    assert len(result.files) == 1
    assert f"qm_script = {script};" in result.files[0].input_text


def test_explicit_runner_script_wins() -> None:
    result = render_run_plan(
        RunPlanRequest(
            setup=_setup(runner="pyscf"),
            calculators=[
                CalculatorSelection(
                    runner_id="pyscf",
                    runner_script="pyscf_mp2.py",
                )
            ],
        ),
        pq=_pq(),
        runners=[_status("pyscf")],
    )

    assert result.valid
    assert "qm_script = pyscf_mp2.py;" in result.files[0].input_text
    assert "qm_script = pyscf_hf.py;" not in result.files[0].input_text


def test_missing_tools_warn_but_still_render() -> None:
    result = render_run_plan(
        RunPlanRequest(
            setup=_setup(runner="ase_xtb"),
            calculators=[CalculatorSelection(runner_id="ase_xtb")],
        ),
        pq=_pq(found=False),
        runners=[_status("ase_xtb", installed=False)],
    )

    assert result.valid
    assert len(result.files) == 1
    diagnostics = {item.code: item.severity for item in result.diagnostics}
    assert diagnostics["environment.pq_not_detected"] == "warning"
    assert diagnostics["runner.not_detected"] == "warning"


def test_all_released_calculators_make_independent_chains() -> None:
    calculator_ids = (
        "dftbplus",
        "ase_dftbplus",
        "ase_xtb",
        "pyscf",
        "turbomole",
        "mace_mp",
        "mace_off",
    )
    result = render_run_plan(
        RunPlanRequest(
            setup=_setup(),
            calculators=[
                CalculatorSelection(runner_id=runner_id)
                for runner_id in calculator_ids
            ],
            equilibration=EquilibrationStage(enabled=True),
        ),
        pq=_pq(),
        runners=[_status(runner_id) for runner_id in calculator_ids],
    )

    assert result.valid
    assert len(result.files) == 2 * len(calculator_ids)
    assert {item.calculator_id for item in result.files} == set(calculator_ids)
    assert len({item.name for item in result.files}) == len(result.files)
    assert len({item.restart_file for item in result.files}) == len(result.files)
