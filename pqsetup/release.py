TARGET_PQ_RELEASE = "v0.6.4"

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
