export type Severity = "error" | "warning" | "info";
export type Ensemble = "NPT" | "NVT" | "NVE" | "OPT";
export type JobType = "mm-md" | "qm-md" | "qm-rpmd" | "mm-opt";
export type MMForceFieldMode = "off" | "bonded" | "on";
export type SetupFileRole =
  | "moldescriptor"
  | "guff"
  | "topology"
  | "parameter"
  | "intra_nonbonded"
  | "dftb_template"
  | "turbomole_define_template";
export type PressureIsotropy =
  | "isotropic"
  | "xy"
  | "xz"
  | "yz"
  | "anisotropic"
  | "full_anisotropic";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  atom_indices: number[];
}

export interface Atom {
  symbol: string;
  position: [number, number, number];
  atom_name?: string | null;
  molecule_type: number;
  velocity: [number, number, number] | null;
  force: [number, number, number] | null;
}

export interface Structure {
  atoms: Atom[];
  cell: [number, number, number][] | null;
  periodic: [boolean, boolean, boolean];
  source_name: string | null;
  source_format: string | null;
  wrapped_centered: boolean;
  cell_generated: boolean;
  cell_padding_angstrom: number | null;
}

export interface Collision {
  atom_i: number;
  atom_j: number;
  distance_angstrom: number;
  threshold_angstrom: number;
  severity: "error" | "warning";
}

export interface StructureSummary {
  atom_count: number;
  formula: string;
  volume_angstrom3: number | null;
  density_g_cm3: number | null;
  minimum_distance_angstrom: number | null;
}

export interface StructureAnalysis {
  structure: Structure;
  summary: StructureSummary;
  diagnostics: Diagnostic[];
  collisions: Collision[];
  collisions_truncated: boolean;
  valid: boolean;
}

export interface PerturbationResult extends StructureAnalysis {
  sigma_angstrom: number;
  seed: number;
  source_sha256: string;
  prepared_sha256: string;
  restart_filename: string;
  restart_content: string;
}

export interface PreparationMetadata {
  kind: "gaussian-position-jitter";
  sigma_angstrom: number;
  seed: number;
  source_sha256: string;
  prepared_sha256: string;
}

export interface RunnerStatus {
  id: string;
  label: string;
  supported: boolean;
  installed: boolean;
  ready: boolean;
  executable: string | null;
  version: string | null;
  detail: string;
}

export interface ExternalQMScript {
  name: string;
  label: string;
  required_file_keywords: string[];
  required_working_files: string[];
}

export interface ExternalQMProgram {
  recommended_script: string | null;
  scripts: ExternalQMScript[];
}

export interface ExternalQMCapabilities {
  script_mode: "bundled_or_full_path" | "full_path_only";
  programs: Record<string, ExternalQMProgram>;
}

export interface PQStatus {
  found: boolean;
  executable: string | null;
  version: string | null;
  source: string | null;
  detail: string;
  external_qm: ExternalQMCapabilities | null;
  validation_available: boolean;
  validation_scopes: ("portable" | "installed")[];
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  ensemble: Ensemble;
  job_type: JobType;
  temperature_k: number | null;
  pressure_bar: number | null;
  timestep_fs: number | null;
  steps: number | null;
  thermostat: string | null;
  manostat: string | null;
  runner: string | null;
}

export interface Bootstrap {
  version: string;
  target_pq_release: string;
  pq: PQStatus;
  runners: RunnerStatus[];
  presets: Preset[];
}

export interface SimulationSetup {
  preset_id: string | null;
  job_type: JobType;
  ensemble: Ensemble;
  start_file: string;
  restart_file: string | null;
  file_prefix: string;
  timestep_fs: number | null;
  steps: number | null;
  temperature_k: number | null;
  start_temperature_k: number | null;
  temperature_ramp_steps: number | null;
  temperature_ramp_frequency: number;
  pressure_bar: number | null;
  thermostat: string | null;
  thermostat_relaxation_ps: number | null;
  thermostat_friction_ps_inverse: number;
  nh_chain_length: number;
  coupling_frequency_cm_inverse: number;
  manostat: string | null;
  manostat_relaxation_ps: number | null;
  compressibility_bar_inverse: number;
  pressure_isotropy: PressureIsotropy;
  initialize_velocities: boolean;
  random_seed: number;
  runner: string | null;
  runner_script: string | null;
  mm_force_field: MMForceFieldMode;
  density_g_cm3: number | null;
  coulomb_cutoff_angstrom: number;
  moldescriptor_file: string | null;
  guff_file: string | null;
  topology_file: string | null;
  parameter_file: string | null;
  intra_nonbonded_file: string | null;
  dftb_template_file: string | null;
  turbomole_define_template_file: string | null;
  overwrite_output: boolean;
  extra_settings: Record<string, string | number | boolean>;
}

export interface SetupFile {
  role: SetupFileRole;
  name: string;
  content: string;
}

export interface SetupFileReference {
  role: SetupFileRole;
  name: string;
  content?: string | null;
}

export interface RenderResult {
  input_text: string;
  diagnostics: Diagnostic[];
  valid: boolean;
}

export interface EquilibrationStage {
  enabled: boolean;
  steps: number;
  timestep_fs: number;
  temperature_k: number;
  start_temperature_k: number | null;
  temperature_ramp_steps: number | null;
  temperature_ramp_frequency: number;
  thermostat: string;
  thermostat_relaxation_ps: number;
  thermostat_friction_ps_inverse: number;
  nh_chain_length: number;
  coupling_frequency_cm_inverse: number;
}

export interface PlannedInput {
  name: string;
  stage_id: "equilibration" | "sampling";
  stage_label: string;
  stage_index: number;
  stage_count: number;
  segment_index: number | null;
  segment_count: number | null;
  calculator_id: string;
  calculator_label: string;
  input_text: string;
  start_file: string;
  restart_file: string;
}

export interface PlanRenderResult {
  files: PlannedInput[];
  diagnostics: Diagnostic[];
  valid: boolean;
}
