from __future__ import annotations

from pqsetup.input_writer import render_input, validate_setup
from pqsetup.models import SimulationSetup
from pqsetup.presets import list_presets


def setup_from_preset(preset_id: str, **overrides: object) -> SimulationSetup:
    preset = next(item for item in list_presets() if item.id == preset_id)
    values = {
        key: value
        for key, value in preset.model_dump().items()
        if key in SimulationSetup.model_fields
    }
    values.update(overrides)
    return SimulationSetup(**values)


def test_ambient_npt_is_exact_and_reproducible() -> None:
    result = render_input(setup_from_preset("ambient-npt"))

    assert result.valid
    assert result.input_text.count("temp = 298.15;") == 1
    assert "pressure = 1.01325;" in result.input_text
    assert "manostat = stochastic_rescaling;" in result.input_text
    assert "thermostat = velocity_rescaling;" in result.input_text
    assert "init_velocities = true;" in result.input_text
    assert "random_seed = 238917;" in result.input_text
    assert "nstep = 1000;" in result.input_text
    assert "qm_prog = ase-xtb;" in result.input_text
    assert "xtb_method = gfn2-xtb;" in result.input_text


def test_nvt_and_nve_have_no_pressure_coupling() -> None:
    nvt = render_input(setup_from_preset("ambient-nvt"))
    nve = render_input(setup_from_preset("nve"))

    assert "thermostat = velocity_rescaling;" in nvt.input_text
    assert "manostat" not in nvt.input_text
    assert "pressure" not in nvt.input_text
    assert "thermostat" not in nve.input_text
    assert "manostat" not in nve.input_text
    assert "temp = 298.15;" in nve.input_text


def test_stochastic_run_stays_seeded_when_velocities_are_preserved() -> None:
    setup = setup_from_preset(
        "ambient-nvt", initialize_velocities=False, random_seed=17
    )

    result = render_input(setup)

    assert result.valid
    assert "init_velocities" not in result.input_text
    assert "random_seed = 17;" in result.input_text


def test_incomplete_mm_optimization_package_is_rejected() -> None:
    result = render_input(
        SimulationSetup(
            job_type="mm-opt",
            ensemble="OPT",
            runner=None,
            initialize_velocities=False,
        )
    )

    assert not result.valid
    assert {item.code for item in result.diagnostics} == {"workflow.unsupported"}


def test_unsupported_and_unknown_runners_fail_without_probing(
    monkeypatch,
) -> None:
    def fail_probe() -> None:
        raise AssertionError("render must not probe external runners")

    monkeypatch.setattr("pqsetup.runners.detect_runners", fail_probe)
    gaussian = setup_from_preset("ambient-nvt", runner="g16")
    unknown = setup_from_preset("ambient-nvt", runner="other")

    assert {item.code for item in validate_setup(gaussian)} == {"runner.unsupported"}
    assert {item.code for item in validate_setup(unknown)} == {"runner.unknown"}


def test_input_tokens_reject_paths_spaces_and_injection() -> None:
    path_setup = setup_from_preset(
        "ambient-nvt",
        start_file="input/structure.rst",
    )
    spaced = setup_from_preset(
        "ambient-nvt",
        file_prefix="my run",
    )

    assert not render_input(path_setup).valid
    assert not render_input(spaced).valid


def test_required_output_names_cannot_be_empty() -> None:
    missing_start = setup_from_preset(
        "ambient-nvt",
        runner="ase_xtb",
        start_file="",
    )
    missing_prefix = setup_from_preset(
        "ambient-nvt",
        runner="ase_xtb",
        file_prefix="",
    )

    assert "input.start_file" in {
        item.code for item in render_input(missing_start).diagnostics
    }
    assert "input.file_prefix" in {
        item.code for item in render_input(missing_prefix).diagnostics
    }


def test_native_external_runner_requires_a_script() -> None:
    missing = setup_from_preset("ambient-nvt", runner="dftbplus")
    configured = setup_from_preset(
        "ambient-nvt",
        runner="dftbplus",
        runner_script="run-dftbplus",
    )

    assert {item.code for item in validate_setup(missing)} == {"runner.script"}
    assert render_input(configured).valid
