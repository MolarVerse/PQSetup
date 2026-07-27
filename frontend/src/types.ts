export type Severity = "error" | "warning" | "info";
export type Ensemble = "NPT" | "NVT" | "NVE" | "OPT";
export type JobType = "mm-md" | "qm-md" | "qm-rpmd" | "mm-opt";

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  atom_indices: number[];
}

export interface Atom {
  symbol: string;
  position: [number, number, number];
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

export interface PQStatus {
  found: boolean;
  executable: string | null;
  version: string | null;
  source: string | null;
  detail: string;
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
}

export interface Bootstrap {
  version: string;
  pq: PQStatus;
  runners: RunnerStatus[];
  presets: Preset[];
}

export interface SimulationSetup {
  preset_id: string | null;
  job_type: JobType;
  ensemble: Ensemble;
  start_file: string;
  file_prefix: string;
  timestep_fs: number | null;
  steps: number | null;
  temperature_k: number | null;
  pressure_bar: number | null;
  thermostat: string | null;
  thermostat_relaxation_ps: number | null;
  manostat: string | null;
  manostat_relaxation_ps: number | null;
  initialize_velocities: boolean;
  random_seed: number;
  runner: string | null;
  runner_script: string | null;
  overwrite_output: boolean;
  extra_settings: Record<string, string | number | boolean>;
}

export interface RenderResult {
  input_text: string;
  diagnostics: Diagnostic[];
  valid: boolean;
}
