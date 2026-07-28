from __future__ import annotations

import pytest
from pydantic import ValidationError

from pqsetup.models import (
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
        "random_seed": 100,
    }
    values.update(overrides)
    return SimulationSetup(**values)


def _status(
    runner_id: str,
    *,
    installed: bool = True,
    ready: bool | None = None,
    detail: str | None = None,
) -> RunnerStatus:
    return RunnerStatus(
        id=runner_id,
        label=runner_id,
        supported=True,
        installed=installed,
        ready=installed if ready is None else ready,
        detail=detail or ("Detected." if installed else "Not detected."),
    )


def _pq(*, found: bool = True) -> PQStatus:
    return PQStatus(
        found=found,
        executable="/tools/PQ" if found else None,
        version="v0.6.4" if found else None,
        source="test" if found else None,
        detail="Ready." if found else "Not found.",
    )


def _render(request: RunPlanRequest):
    runner_id = request.setup.runner or "ase_xtb"
    return render_run_plan(
        request,
        pq=_pq(),
        runners=[_status(runner_id)],
    )


def test_equilibration_and_sampling_segments_form_exact_chain() -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(
                start_temperature_k=100.0,
                temperature_ramp_steps=500,
            ),
            equilibration=EquilibrationStage(enabled=True, steps=5000),
            sampling_run_count=3,
        )
    )

    assert result.valid
    assert [item.name for item in result.files] == [
        "run-eq.in",
        "run-01.in",
        "run-02.in",
        "run-03.in",
    ]
    assert [item.stage_index for item in result.files] == [1, 2, 3, 4]
    assert {item.stage_count for item in result.files} == {4}
    assert [item.segment_index for item in result.files] == [None, 1, 2, 3]
    assert [item.segment_count for item in result.files] == [None, 3, 3, 3]
    assert [item.start_file for item in result.files] == [
        "structure.rst",
        "water-eq.rst",
        "water-01.rst",
        "water-02.rst",
    ]
    assert [item.restart_file for item in result.files] == [
        "water-eq.rst",
        "water-01.rst",
        "water-02.rst",
        "water-03.rst",
    ]
    assert [
        line
        for item in result.files
        for line in item.input_text.splitlines()
        if line.startswith("file_prefix =")
    ] == [
        "file_prefix = water-eq;",
        "file_prefix = water-01;",
        "file_prefix = water-02;",
        "file_prefix = water-03;",
    ]
    assert "init_velocities = true;" in result.files[0].input_text
    assert all(
        "init_velocities = true;" not in item.input_text
        for item in result.files[1:]
    )
    assert [
        line
        for item in result.files
        for line in item.input_text.splitlines()
        if line.startswith("random_seed =")
    ] == [
        "random_seed = 100;",
        "random_seed = 101;",
        "random_seed = 102;",
        "random_seed = 103;",
    ]
    assert "start_temp = 100;" in result.files[1].input_text
    assert "temp_ramp_steps = 500;" in result.files[1].input_text
    assert all(
        "start_temp =" not in item.input_text
        and "temp_ramp_steps =" not in item.input_text
        for item in result.files[2:]
    )


def test_sampling_only_starts_from_structure_and_numbers_from_one() -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(),
            sampling_run_count=3,
        )
    )

    assert result.valid
    assert [item.name for item in result.files] == [
        "run-01.in",
        "run-02.in",
        "run-03.in",
    ]
    assert [item.stage_index for item in result.files] == [1, 2, 3]
    assert [item.segment_index for item in result.files] == [1, 2, 3]
    assert [item.start_file for item in result.files] == [
        "structure.rst",
        "water-01.rst",
        "water-02.rst",
    ]
    assert [item.restart_file for item in result.files] == [
        "water-01.rst",
        "water-02.rst",
        "water-03.rst",
    ]
    assert "init_velocities = true;" in result.files[0].input_text
    assert all(
        "init_velocities = true;" not in item.input_text
        for item in result.files[1:]
    )


def test_existing_velocities_are_preserved_without_initialization() -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(initialize_velocities=False),
            sampling_run_count=2,
        )
    )

    assert result.valid
    assert all(
        "init_velocities = true;" not in item.input_text for item in result.files
    )


def test_plan_owns_restart_filenames() -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(restart_file="custom.rst"),
            sampling_run_count=1,
        )
    )

    assert result.valid
    assert result.files[0].restart_file == "water-01.rst"
    assert "restart_file = water-01.rst;" in result.files[0].input_text
    assert "custom.rst" not in result.files[0].input_text


@pytest.mark.parametrize(
    ("runner_id", "script"),
    [
        ("dftbplus", "dftbplus_periodic_stress"),
        ("pyscf", "pyscf_hf.py"),
        ("turbomole", "turbomole_rimp2"),
    ],
)
def test_external_calculators_use_canonical_release_scripts(
    runner_id: str,
    script: str,
) -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(runner=runner_id, runner_script="custom.py"),
            sampling_run_count=1,
        )
    )

    assert result.valid
    assert f"qm_script = {script};" in result.files[0].input_text
    assert "custom.py" not in result.files[0].input_text


def test_missing_tools_warn_but_still_render() -> None:
    result = render_run_plan(
        RunPlanRequest(
            setup=_setup(),
            sampling_run_count=1,
        ),
        pq=_pq(found=False),
        runners=[_status("ase_xtb", installed=False)],
    )

    assert result.valid
    assert len(result.files) == 1
    diagnostics = {item.code: item.severity for item in result.diagnostics}
    assert diagnostics["environment.pq_not_detected"] == "warning"
    assert diagnostics["runner.not_detected"] == "warning"


def test_detected_dependency_with_missing_script_warns_as_incomplete() -> None:
    result = render_run_plan(
        RunPlanRequest(
            setup=_setup(runner="dftbplus"),
            sampling_run_count=1,
        ),
        pq=_pq(),
        runners=[
            _status(
                "dftbplus",
                installed=True,
                ready=False,
                detail=(
                    "DFTB+ detected. PQ script not found near the selected "
                    "PQ executable."
                ),
            )
        ],
    )

    assert result.valid
    diagnostics = {item.code: item.message for item in result.diagnostics}
    assert "runner.not_detected" not in diagnostics
    assert diagnostics["runner.incomplete"].startswith("DFTB+ detected.")


def test_seed_derivation_wraps_at_uint32_boundary() -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(random_seed=4_294_967_295),
            sampling_run_count=2,
        )
    )

    assert result.valid
    assert "random_seed = 4294967295;" in result.files[0].input_text
    assert "random_seed = 0;" in result.files[1].input_text


@pytest.mark.parametrize("random_seed", [-1, 4_294_967_296, 2**40])
def test_invalid_base_seed_is_rejected_before_derivation(random_seed: int) -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(random_seed=random_seed),
            sampling_run_count=2,
        )
    )

    assert not result.valid
    assert result.files == []
    assert [(item.code, item.severity) for item in result.diagnostics] == [
        ("run.random_seed", "error")
    ]


@pytest.mark.parametrize(
    ("start_file", "equilibration", "sampling_run_count", "generated_restart"),
    [
        ("water-eq.rst", True, 2, "water-eq.rst"),
        ("water-01.rst", False, 2, "water-01.rst"),
        ("water-02.rst", False, 2, "water-02.rst"),
        ("WATER-03.RST", False, 3, "water-03.rst"),
    ],
)
def test_start_file_cannot_collide_with_any_generated_restart(
    start_file: str,
    equilibration: bool,
    sampling_run_count: int,
    generated_restart: str,
) -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(start_file=start_file),
            equilibration=EquilibrationStage(enabled=equilibration),
            sampling_run_count=sampling_run_count,
        )
    )

    assert not result.valid
    assert result.files == []
    diagnostic = result.diagnostics[0]
    assert diagnostic.code == "input.restart_collision"
    assert diagnostic.severity == "error"
    assert generated_restart in diagnostic.message


def test_one_hundred_sampling_runs_have_stable_names() -> None:
    result = _render(
        RunPlanRequest(
            setup=_setup(),
            sampling_run_count=100,
        )
    )

    assert result.valid
    assert len(result.files) == 100
    assert result.files[0].name == "run-01.in"
    assert result.files[-1].name == "run-100.in"
    assert result.files[-1].start_file == "water-99.rst"
    assert result.files[-1].restart_file == "water-100.rst"
    assert [item.stage_index for item in result.files] == list(range(1, 101))


@pytest.mark.parametrize("sampling_run_count", [0, 1000])
def test_sampling_run_count_rejects_out_of_range_values(
    sampling_run_count: int,
) -> None:
    with pytest.raises(ValidationError):
        RunPlanRequest(
            setup=_setup(),
            sampling_run_count=sampling_run_count,
        )


def test_sampling_run_count_defaults_to_one() -> None:
    request = RunPlanRequest.model_validate({"setup": _setup().model_dump()})

    assert request.sampling_run_count == 1
