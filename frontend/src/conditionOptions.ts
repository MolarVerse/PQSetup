export const THERMOSTATS = [
  { value: "berendsen", label: "Berendsen" },
  {
    value: "velocity_rescaling",
    label: "Stochastic velocity rescaling",
  },
  { value: "langevin", label: "Langevin" },
  { value: "nh-chain", label: "Nosé–Hoover chain" },
] as const;

export const MANOSTATS = [
  { value: "berendsen", label: "Berendsen" },
  {
    value: "stochastic_rescaling",
    label: "Stochastic cell rescaling",
  },
] as const;
