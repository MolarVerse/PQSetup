from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


Severity = Literal["error", "warning", "info"]
Ensemble = Literal["NPT", "NVT", "NVE", "OPT"]
JobType = Literal["mm-md", "qm-md", "qm-rpmd", "mm-opt"]
PressureIsotropy = Literal[
    "isotropic",
    "xy",
    "xz",
    "yz",
    "anisotropic",
    "full_anisotropic",
]


class Diagnostic(BaseModel):
    code: str
    severity: Severity
    message: str
    atom_indices: list[int] = Field(default_factory=list)


class Atom(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    position: tuple[float, float, float]
    molecule_type: int = 0
    velocity: tuple[float, float, float] | None = None
    force: tuple[float, float, float] | None = None


class Structure(BaseModel):
    model_config = ConfigDict(extra="forbid")

    atoms: list[Atom]
    cell: list[tuple[float, float, float]] | None = None
    periodic: tuple[bool, bool, bool] = (False, False, False)
    source_name: str | None = None
    source_format: str | None = None
    wrapped_centered: bool = False
    cell_generated: bool = False
    cell_padding_angstrom: float | None = None


class Collision(BaseModel):
    atom_i: int
    atom_j: int
    distance_angstrom: float
    threshold_angstrom: float
    severity: Literal["error", "warning"]


class StructureSummary(BaseModel):
    atom_count: int
    formula: str
    volume_angstrom3: float | None = None
    density_g_cm3: float | None = None
    minimum_distance_angstrom: float | None = None


class StructureAnalysis(BaseModel):
    structure: Structure
    summary: StructureSummary
    diagnostics: list[Diagnostic]
    collisions: list[Collision]
    collisions_truncated: bool = False
    valid: bool


class PerturbationResult(StructureAnalysis):
    sigma_angstrom: float
    seed: int
    source_sha256: str
    prepared_sha256: str
    restart_filename: str
    restart_content: str


class RunnerStatus(BaseModel):
    id: str
    label: str
    supported: bool
    installed: bool
    ready: bool
    executable: str | None = None
    version: str | None = None
    detail: str


class PQStatus(BaseModel):
    found: bool
    executable: str | None = None
    version: str | None = None
    source: str | None = None
    detail: str


class Preset(BaseModel):
    id: str
    name: str
    description: str
    ensemble: Ensemble
    job_type: JobType
    temperature_k: float | None = None
    pressure_bar: float | None = None
    timestep_fs: float | None = None
    steps: int | None = None
    thermostat: str | None = None
    manostat: str | None = None
    runner: str | None = None


class SimulationSetup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preset_id: str | None = None
    job_type: JobType = "qm-md"
    ensemble: Ensemble = "NVT"
    start_file: str = "structure.rst"
    restart_file: str | None = None
    file_prefix: str = "pq-run"
    timestep_fs: float | None = 0.5
    steps: int | None = 1000
    temperature_k: float | None = 298.15
    start_temperature_k: float | None = None
    temperature_ramp_steps: int | None = None
    temperature_ramp_frequency: int = 1
    pressure_bar: float | None = None
    thermostat: str | None = "velocity_rescaling"
    thermostat_relaxation_ps: float | None = 0.1
    thermostat_friction_ps_inverse: float = 0.1
    nh_chain_length: int = 3
    coupling_frequency_cm_inverse: float = 1000.0
    manostat: str | None = None
    manostat_relaxation_ps: float | None = 1.0
    compressibility_bar_inverse: float = 4.591e-5
    pressure_isotropy: PressureIsotropy = "isotropic"
    initialize_velocities: bool = True
    random_seed: int = 238917
    runner: str | None = "ase_xtb"
    runner_script: str | None = None
    overwrite_output: bool = False
    extra_settings: dict[str, str | int | float | bool] = Field(default_factory=dict)


class RenderResult(BaseModel):
    input_text: str
    diagnostics: list[Diagnostic]
    valid: bool


class EquilibrationStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    steps: int = 5000
    timestep_fs: float = 0.5
    temperature_k: float = 298.15
    start_temperature_k: float | None = None
    temperature_ramp_steps: int | None = None
    temperature_ramp_frequency: int = 1
    thermostat: str = "berendsen"
    thermostat_relaxation_ps: float = 0.1
    thermostat_friction_ps_inverse: float = 0.1
    nh_chain_length: int = 3
    coupling_frequency_cm_inverse: float = 1000.0


class RunPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    setup: SimulationSetup
    equilibration: EquilibrationStage | None = None
    sampling_run_count: int = Field(default=1, ge=1, le=99)


class PlannedInput(BaseModel):
    name: str
    stage_id: Literal["equilibration", "sampling"]
    stage_label: str
    stage_index: int
    stage_count: int
    segment_index: int | None = None
    segment_count: int | None = None
    calculator_id: str
    calculator_label: str
    input_text: str
    start_file: str
    restart_file: str


class PlanRenderResult(BaseModel):
    files: list[PlannedInput]
    diagnostics: list[Diagnostic]
    valid: bool


class Bootstrap(BaseModel):
    version: str
    target_pq_release: str
    pq: PQStatus
    runners: list[RunnerStatus]
    presets: list[Preset]


class PreparationMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["gaussian-position-jitter"] = "gaussian-position-jitter"
    sigma_angstrom: float = Field(ge=0.0)
    seed: int = Field(ge=0, le=4_294_967_295)
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    prepared_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    setup: SimulationSetup
    structure: Structure
    project_name: str = "pq-run"
    preparation: PreparationMetadata | None = None
    equilibration: EquilibrationStage | None = None
    sampling_run_count: int | None = Field(default=None, ge=1, le=99)


class DoctorReport(BaseModel):
    pq: PQStatus
    runners: list[RunnerStatus]
    diagnostics: list[Diagnostic]


JsonObject = dict[str, Any]
