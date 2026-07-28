from __future__ import annotations

import math

import pytest

from pqsetup.input_writer import render_input, validate_setup
from pqsetup.models import SimulationSetup


def _nvt(**overrides: object) -> SimulationSetup:
    values: dict[str, object] = {
        "ensemble": "NVT",
        "runner": "ase_xtb",
        "start_file": "structure.rst",
        "file_prefix": "water",
        "thermostat": "velocity_rescaling",
    }
    values.update(overrides)
    return SimulationSetup(**values)


@pytest.mark.parametrize(
    ("thermostat", "expected", "excluded"),
    [
        (
            "berendsen",
            "t_relaxation = 0.25;",
            ("friction =", "nh-chain_length =", "coupling_frequency ="),
        ),
        (
            "velocity_rescaling",
            "t_relaxation = 0.25;",
            ("friction =", "nh-chain_length =", "coupling_frequency ="),
        ),
        (
            "langevin",
            "friction = 0.35;",
            ("t_relaxation =", "nh-chain_length =", "coupling_frequency ="),
        ),
        (
            "nh-chain",
            "nh-chain_length = 5;",
            ("t_relaxation =", "friction ="),
        ),
    ],
)
def test_thermostat_writes_only_its_parameters(
    thermostat: str,
    expected: str,
    excluded: tuple[str, ...],
) -> None:
    result = render_input(
        _nvt(
            thermostat=thermostat,
            thermostat_relaxation_ps=0.25,
            thermostat_friction_ps_inverse=0.35,
            nh_chain_length=5,
            coupling_frequency_cm_inverse=850,
        )
    )

    assert result.valid
    assert f"thermostat = {thermostat};" in result.input_text
    assert expected in result.input_text
    for setting in excluded:
        assert setting not in result.input_text
    if thermostat == "nh-chain":
        assert "coupling_frequency = 850;" in result.input_text


def test_temperature_ramp_is_complete() -> None:
    result = render_input(
        _nvt(
            temperature_k=310,
            start_temperature_k=100,
            temperature_ramp_steps=400,
            temperature_ramp_frequency=4,
            steps=1000,
        )
    )

    assert result.valid
    assert "temp = 310;" in result.input_text
    assert "start_temp = 100;" in result.input_text
    assert "temp_ramp_steps = 400;" in result.input_text
    assert "temp_ramp_frequency = 4;" in result.input_text


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        (
            {"thermostat_relaxation_ps": 0},
            "conditions.t_relaxation",
        ),
        (
            {"thermostat_relaxation_ps": -0.1},
            "conditions.t_relaxation",
        ),
        (
            {"thermostat_relaxation_ps": math.inf},
            "conditions.t_relaxation",
        ),
        ({"temperature_ramp_frequency": 0}, "conditions.ramp_frequency"),
        (
            {"temperature_ramp_steps": 1001, "steps": 1000},
            "conditions.ramp_steps",
        ),
        (
            {
                "start_temperature_k": 100,
                "temperature_ramp_steps": 10,
                "temperature_ramp_frequency": 11,
            },
            "conditions.ramp_frequency",
        ),
    ],
)
def test_velocity_rescaling_rejects_unsafe_values(
    overrides: dict[str, object],
    code: str,
) -> None:
    assert code in {item.code for item in validate_setup(_nvt(**overrides))}


@pytest.mark.parametrize("thermostat", ["berendsen", "velocity_rescaling"])
def test_thermostat_relaxation_cannot_be_shorter_than_timestep(
    thermostat: str,
) -> None:
    invalid = validate_setup(
        _nvt(
            thermostat=thermostat,
            timestep_fs=2.0,
            thermostat_relaxation_ps=0.001,
        )
    )
    boundary = validate_setup(
        _nvt(
            thermostat=thermostat,
            timestep_fs=1.0,
            thermostat_relaxation_ps=0.001,
        )
    )

    assert "conditions.t_relaxation" in {item.code for item in invalid}
    assert "conditions.t_relaxation" not in {item.code for item in boundary}


@pytest.mark.parametrize("value", [-0.1, math.inf, math.nan])
def test_langevin_rejects_invalid_friction(value: float) -> None:
    setup = _nvt(
        thermostat="langevin",
        thermostat_friction_ps_inverse=value,
    )

    assert "conditions.friction" in {item.code for item in validate_setup(setup)}


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"nh_chain_length": 0}, "conditions.nh_chain_length"),
        ({"coupling_frequency_cm_inverse": -1}, "conditions.coupling_frequency"),
        (
            {"coupling_frequency_cm_inverse": math.inf},
            "conditions.coupling_frequency",
        ),
    ],
)
def test_nose_hoover_rejects_unsafe_values(
    overrides: dict[str, object],
    code: str,
) -> None:
    setup = _nvt(thermostat="nh-chain", **overrides)

    assert code in {item.code for item in validate_setup(setup)}


def test_zero_nose_hoover_frequency_warns() -> None:
    diagnostics = validate_setup(
        _nvt(
            thermostat="nh-chain",
            coupling_frequency_cm_inverse=0,
        )
    )

    assert not any(item.severity == "error" for item in diagnostics)
    warning = next(
        item for item in diagnostics if item.code == "conditions.coupling_frequency"
    )
    assert warning.severity == "warning"


def test_irrelevant_thermostat_values_are_ignored() -> None:
    berendsen = validate_setup(
        _nvt(
            thermostat="berendsen",
            thermostat_friction_ps_inverse=math.inf,
            nh_chain_length=0,
        )
    )
    langevin = validate_setup(
        _nvt(
            thermostat="langevin",
            thermostat_relaxation_ps=math.inf,
            nh_chain_length=0,
        )
    )

    assert not berendsen
    assert not langevin


@pytest.mark.parametrize(
    "isotropy",
    ["isotropic", "xy", "xz", "yz", "anisotropic", "full_anisotropic"],
)
def test_manostat_writes_all_parameters(isotropy: str) -> None:
    result = render_input(
        _nvt(
            ensemble="NPT",
            pressure_bar=-25,
            manostat="stochastic_rescaling",
            manostat_relaxation_ps=2.5,
            compressibility_bar_inverse=1.2e-5,
            pressure_isotropy=isotropy,
        )
    )

    assert result.valid
    assert "pressure = -25;" in result.input_text
    assert "p_relaxation = 2.5;" in result.input_text
    assert "compressibility = 1.2e-05;" in result.input_text
    assert f"isotropy = {isotropy};" in result.input_text


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"pressure_bar": math.inf}, "conditions.pressure"),
        ({"pressure_bar": math.nan}, "conditions.pressure"),
        ({"manostat_relaxation_ps": 0}, "conditions.p_relaxation"),
        ({"manostat_relaxation_ps": -1}, "conditions.p_relaxation"),
        (
            {"compressibility_bar_inverse": -1},
            "conditions.compressibility",
        ),
        (
            {"compressibility_bar_inverse": math.inf},
            "conditions.compressibility",
        ),
    ],
)
def test_manostat_rejects_invalid_parameters(
    overrides: dict[str, object],
    code: str,
) -> None:
    values: dict[str, object] = {
        "ensemble": "NPT",
        "pressure_bar": 1.01325,
        "manostat": "berendsen",
    }
    values.update(overrides)
    setup = _nvt(**values)

    assert code in {item.code for item in validate_setup(setup)}


def test_manostat_relaxation_cannot_be_shorter_than_timestep() -> None:
    invalid = validate_setup(
        _nvt(
            ensemble="NPT",
            pressure_bar=1.01325,
            manostat="berendsen",
            timestep_fs=2.0,
            manostat_relaxation_ps=0.001,
        )
    )
    boundary = validate_setup(
        _nvt(
            ensemble="NPT",
            pressure_bar=1.01325,
            manostat="berendsen",
            timestep_fs=1.0,
            manostat_relaxation_ps=0.001,
        )
    )

    assert "conditions.p_relaxation" in {item.code for item in invalid}
    assert "conditions.p_relaxation" not in {item.code for item in boundary}


def test_restart_file_is_explicit_and_reserved() -> None:
    result = render_input(
        _nvt(
            restart_file="water-final.rst",
            extra_settings={"restart-file": "other.rst"},
        )
    )

    assert not result.valid
    assert "input.extra_conflict" in {item.code for item in result.diagnostics}

    rendered = render_input(_nvt(restart_file="water-final.rst"))
    assert rendered.valid
    assert "restart_file = water-final.rst;" in rendered.input_text
    assert "rst_file =" not in rendered.input_text


@pytest.mark.parametrize(
    "restart_file",
    ["nested/water.rst", "water.out", "water run.rst", "water;run.rst"],
)
def test_restart_filename_rejects_unsafe_values(restart_file: str) -> None:
    result = render_input(_nvt(restart_file=restart_file))

    assert not result.valid
    assert "input.restart_file" in {item.code for item in result.diagnostics}


def test_coupling_matrix_has_no_duplicate_assignments() -> None:
    thermostats = ("berendsen", "velocity_rescaling", "langevin", "nh-chain")
    manostats = ("berendsen", "stochastic_rescaling")
    isotropies = (
        "isotropic",
        "xy",
        "xz",
        "yz",
        "anisotropic",
        "full_anisotropic",
    )

    for thermostat in thermostats:
        for manostat in manostats:
            for isotropy in isotropies:
                result = render_input(
                    _nvt(
                        ensemble="NPT",
                        thermostat=thermostat,
                        manostat=manostat,
                        pressure_bar=1.01325,
                        pressure_isotropy=isotropy,
                    )
                )

                assert result.valid
                for keyword in (
                    "thermostat",
                    "manostat",
                    "pressure",
                    "p_relaxation",
                    "compressibility",
                    "isotropy",
                ):
                    assert result.input_text.count(f"{keyword} =") == 1
