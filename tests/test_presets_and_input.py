from __future__ import annotations

from pqsetup.input_writer import render_input, validate_setup
from pqsetup.models import SimulationSetup
from pqsetup.presets import list_presets
from pqsetup.release import PQ_MANOSTATS, PQ_THERMOSTATS, TARGET_PQ_RELEASE


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
    assert result.input_text.startswith("# ╭─ PQSetup · simulation input")
    assert f"Written by PQSetup · target {TARGET_PQ_RELEASE}" in result.input_text
    assert "# ── Pressure coupling" in result.input_text


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


def test_unreleased_and_unknown_runners_fail_without_probing(
    monkeypatch,
) -> None:
    def fail_probe() -> None:
        raise AssertionError("render must not probe external runners")

    monkeypatch.setattr("pqsetup.runners.detect_runners", fail_probe)
    gaussian = setup_from_preset("ambient-nvt", runner="g16")
    mace_cpp = setup_from_preset("ambient-nvt", runner="mace_cpp")
    unknown = setup_from_preset("ambient-nvt", runner="other")

    assert {item.code for item in validate_setup(gaussian)} == {"runner.unknown"}
    assert {item.code for item in validate_setup(mace_cpp)} == {"runner.unknown"}
    assert {item.code for item in validate_setup(unknown)} == {"runner.unknown"}


def test_every_released_thermostat_is_rendered_safely() -> None:
    for thermostat in PQ_THERMOSTATS:
        result = render_input(setup_from_preset("ambient-nvt", thermostat=thermostat))

        assert result.valid
        assert f"thermostat = {thermostat};" in result.input_text
        if thermostat in {"langevin", "nh-chain"}:
            assert "t_relaxation" not in result.input_text


def test_every_released_manostat_is_rendered_safely() -> None:
    for manostat in PQ_MANOSTATS:
        result = render_input(setup_from_preset("ambient-npt", manostat=manostat))

        assert result.valid
        assert f"manostat = {manostat};" in result.input_text


def test_unreleased_coupling_values_are_rejected() -> None:
    thermostat = setup_from_preset("ambient-nvt", thermostat="future-coupler")
    manostat = setup_from_preset("ambient-npt", manostat="future-coupler")

    assert {item.code for item in validate_setup(thermostat)} == {
        "conditions.thermostat"
    }
    assert {item.code for item in validate_setup(manostat)} == {"conditions.manostat"}


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


def test_native_external_runner_uses_default_or_custom_script() -> None:
    default = setup_from_preset("ambient-nvt", runner="dftbplus")
    configured = setup_from_preset(
        "ambient-nvt",
        runner="dftbplus",
        runner_script="run-dftbplus",
    )

    default_result = render_input(default)
    assert default_result.valid
    assert "qm_script = dftbplus_periodic_stress;" in default_result.input_text
    assert render_input(configured).valid
    assert "qm_script = run-dftbplus;" in render_input(configured).input_text
