import { defaultSetupFileName } from "./method";
import type {
  EquilibrationStage,
  MMForceFieldMode,
  SetupFileRole,
  SimulationSetup,
  StructureAnalysis,
} from "./types";

export const EXAMPLE: StructureAnalysis = {
  structure: {
    atoms: [
      {
        symbol: "O",
        position: [0, 0, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
      {
        symbol: "H",
        position: [0.9572, 0, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
      {
        symbol: "H",
        position: [-0.239987, 0.927297, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
    ],
    cell: [
      [12, 0, 0],
      [0, 12, 0],
      [0, 0, 12],
    ],
    periodic: [true, true, true],
    source_name: "water-example.rst",
    source_format: "pq-restart",
    wrapped_centered: true,
    // This built-in single-molecule box is a vacuum example, not a measured
    // periodic cell suitable for pressure coupling.
    cell_generated: true,
    cell_padding_angstrom: null,
  },
  summary: {
    atom_count: 3,
    formula: "H2O",
    volume_angstrom3: 1728,
    density_g_cm3: 0.0173,
    minimum_distance_angstrom: 0.9572,
  },
  diagnostics: [],
  collisions: [],
  collisions_truncated: false,
  valid: true,
};

export const INITIAL_SETUP: SimulationSetup = {
  preset_id: null,
  job_type: "qm-md",
  ensemble: "NVT",
  start_file: "water-example.rst",
  restart_file: null,
  file_prefix: "water-nvt",
  timestep_fs: 0.5,
  steps: 1000,
  temperature_k: 298.15,
  start_temperature_k: null,
  temperature_ramp_steps: null,
  temperature_ramp_frequency: 1,
  pressure_bar: null,
  thermostat: "velocity_rescaling",
  thermostat_relaxation_ps: 0.1,
  thermostat_friction_ps_inverse: 0.1,
  nh_chain_length: 3,
  coupling_frequency_cm_inverse: 1000,
  manostat: null,
  manostat_relaxation_ps: 1,
  compressibility_bar_inverse: 4.591e-5,
  pressure_isotropy: "isotropic",
  initialize_velocities: true,
  random_seed: 238917,
  runner: "ase_xtb",
  runner_script: null,
  mm_force_field: "off",
  density_g_cm3: null,
  coulomb_cutoff_angstrom: 12.5,
  moldescriptor_file: null,
  guff_file: null,
  topology_file: null,
  parameter_file: null,
  intra_nonbonded_file: null,
  mshake_file: null,
  dftb_template_file: null,
  turbomole_define_template_file: null,
  overwrite_output: false,
  extra_settings: { output_freq: 1 },
};

export const INITIAL_EQUILIBRATION: EquilibrationStage = {
  enabled: true,
  steps: 5000,
  timestep_fs: 0.5,
  temperature_k: 298.15,
  start_temperature_k: null,
  temperature_ramp_steps: null,
  temperature_ramp_frequency: 1,
  thermostat: "berendsen",
  thermostat_relaxation_ps: 0.1,
  thermostat_friction_ps_inverse: 0.1,
  nh_chain_length: 3,
  coupling_frequency_cm_inverse: 1000,
};

export function isMolecularMechanics(setup: SimulationSetup): boolean {
  return setup.job_type === "mm-md" || setup.job_type === "mm-opt";
}

export function withMMFileNames(
  setup: SimulationSetup,
  mode: MMForceFieldMode,
): SimulationSetup {
  return {
    ...setup,
    mm_force_field: mode,
    moldescriptor_file:
      setup.moldescriptor_file ?? defaultSetupFileName("moldescriptor"),
    guff_file:
      mode === "off" || mode === "bonded"
        ? setup.guff_file ?? defaultSetupFileName("guff")
        : setup.guff_file,
    topology_file:
      mode === "on" || mode === "bonded"
        ? setup.topology_file ?? defaultSetupFileName("topology")
        : setup.topology_file,
    parameter_file:
      mode === "on" || mode === "bonded"
        ? setup.parameter_file ?? defaultSetupFileName("parameter")
        : setup.parameter_file,
  };
}

export function withSetupFileName(
  setup: SimulationSetup,
  role: SetupFileRole,
  name: string,
): SimulationSetup {
  if (role === "moldescriptor") {
    return { ...setup, moldescriptor_file: name };
  }
  if (role === "guff") return { ...setup, guff_file: name };
  if (role === "topology") return { ...setup, topology_file: name };
  if (role === "parameter") return { ...setup, parameter_file: name };
  if (role === "intra_nonbonded") {
    return { ...setup, intra_nonbonded_file: name };
  }
  if (role === "mshake") return { ...setup, mshake_file: name };
  if (role === "dftb_template") {
    return { ...setup, dftb_template_file: name };
  }
  return { ...setup, turbomole_define_template_file: name };
}
