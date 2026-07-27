export const THERMOSTATS = [
  {
    value: "berendsen",
    label: "Berendsen",
    description: "Fast equilibration; does not sample the canonical ensemble.",
  },
  {
    value: "velocity_rescaling",
    label: "Stochastic velocity rescaling",
    description: "Canonical temperature sampling with stochastic rescaling.",
  },
  {
    value: "langevin",
    label: "Langevin",
    description: "Stochastic coupling through friction and random forces.",
  },
  {
    value: "nh-chain",
    label: "Nosé–Hoover chain",
    description: "Deterministic canonical sampling with an extended chain.",
  },
] as const;

export const MANOSTATS = [
  {
    value: "berendsen",
    label: "Berendsen",
    description: "Weak pressure coupling for equilibration.",
  },
  {
    value: "stochastic_rescaling",
    label: "Stochastic cell rescaling",
    description: "Stochastic pressure coupling through cell rescaling.",
  },
] as const;

export const PRESSURE_ISOTROPIES = [
  { value: "isotropic", label: "Isotropic" },
  { value: "xy", label: "Semi-isotropic · xy" },
  { value: "xz", label: "Semi-isotropic · xz" },
  { value: "yz", label: "Semi-isotropic · yz" },
  { value: "anisotropic", label: "Anisotropic" },
  { value: "full_anisotropic", label: "Fully anisotropic" },
] as const;
