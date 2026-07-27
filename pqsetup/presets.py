from __future__ import annotations

from .models import Preset


PRESETS: tuple[Preset, ...] = (
    Preset(
        id="ambient-npt",
        name="Ambient NPT",
        description="Equilibrate at 298.15 K and 1 atm.",
        ensemble="NPT",
        job_type="qm-md",
        temperature_k=298.15,
        pressure_bar=1.01325,
        timestep_fs=0.5,
        steps=1000,
        thermostat="velocity_rescaling",
        manostat="stochastic_rescaling",
        runner="ase_xtb",
    ),
    Preset(
        id="ambient-nvt",
        name="Ambient NVT",
        description="Run at 298.15 K with a fixed cell.",
        ensemble="NVT",
        job_type="qm-md",
        temperature_k=298.15,
        timestep_fs=0.5,
        steps=1000,
        thermostat="velocity_rescaling",
        runner="ase_xtb",
    ),
    Preset(
        id="nve",
        name="Microcanonical NVE",
        description="Run without temperature or pressure coupling.",
        ensemble="NVE",
        job_type="qm-md",
        temperature_k=298.15,
        timestep_fs=0.5,
        steps=1000,
        runner="ase_xtb",
    ),
)


def list_presets() -> list[Preset]:
    return [preset.model_copy(deep=True) for preset in PRESETS]
