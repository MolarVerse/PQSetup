TARGET_PQ_RELEASE = "v0.7.0"

PQ_QM_PROGRAMS = frozenset(
    {
        "dftbplus",
        "ase_dftbplus",
        "ase_xtb",
        "pyscf",
        "turbomole",
        "mace",
        "mace_mp",
        "mace_off",
    }
)

PQ_THERMOSTATS = frozenset(
    {
        "berendsen",
        "velocity_rescaling",
        "langevin",
        "nh-chain",
    }
)

PQ_MANOSTATS = frozenset(
    {
        "berendsen",
        "stochastic_rescaling",
    }
)

PQ_PRESSURE_ISOTROPIES = frozenset(
    {
        "isotropic",
        "xy",
        "xz",
        "yz",
        "anisotropic",
        "full_anisotropic",
    }
)

PQ_RUNNER_LABELS = {
    "dftbplus": "DFTB+",
    "ase_dftbplus": "ASE · DFTB+",
    "ase_xtb": "ASE · xTB",
    "pyscf": "PySCF",
    "turbomole": "Turbomole",
    "mace": "MACE-MP",
    "mace_mp": "MACE-MP",
    "mace_off": "MACE-OFF",
}
