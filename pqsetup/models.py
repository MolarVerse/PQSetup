from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Severity = Literal["error", "warning", "info"]
Ensemble = Literal["NPT", "NVT", "NVE", "OPT"]
JobType = Literal["mm-md", "qm-md", "qm-rpmd", "mm-opt"]
MMForceFieldMode = Literal["off", "bonded", "on"]
JsonObject = dict[str, Any]
PQValidationScope = Literal["portable", "installed"]
SetupFileRole = Literal[
    "moldescriptor",
    "guff",
    "topology",
    "parameter",
    "intra_nonbonded",
    "dftb_template",
    "turbomole_define_template",
]
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
    atom_name: str | None = None
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
    available_in_pq: bool | None = None
    detail: str


class ExternalQMScript(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(pattern=r"^[A-Za-z0-9._+-]+$")
    label: str = Field(min_length=1, max_length=120)
    required_file_keywords: list[str] = Field(default_factory=list)
    required_working_files: list[str] = Field(default_factory=list)


class ExternalQMProgram(BaseModel):
    model_config = ConfigDict(extra="ignore")

    recommended_script: str | None = None
    scripts: list[ExternalQMScript] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_scripts(self) -> ExternalQMProgram:
        names = [script.name for script in self.scripts]
        if len(names) != len(set(names)):
            raise ValueError("External QM script names must be unique.")
        if self.recommended_script is not None and self.recommended_script not in names:
            raise ValueError("The recommended external QM script must be advertised.")
        return self


class ExternalQMCapabilities(BaseModel):
    model_config = ConfigDict(extra="ignore")

    script_mode: Literal["bundled_or_full_path", "full_path_only"]
    programs: dict[str, ExternalQMProgram]


class PQStatus(BaseModel):
    found: bool
    executable: str | None = None
    version: str | None = None
    source: str | None = None
    detail: str
    capabilities: JsonObject | None = None
    external_qm: ExternalQMCapabilities | None = None
    validation_available: bool = False
    validation_scopes: list[PQValidationScope] = Field(default_factory=list)

    def supports_validation(self, scope: PQValidationScope) -> bool:
        return self.validation_available and scope in self.validation_scopes


class PQValidationDiagnostic(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)

    severity: Literal["error", "warning"]
    message: str
    file: str
    line: int | None = Field(default=None, ge=1)


class PQValidationResult(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)

    schema_name: Literal["pq.validation"] = Field(alias="schema")
    schema_version: Literal[1]
    valid: bool
    input: str
    scope: PQValidationScope
    diagnostics: list[PQValidationDiagnostic]


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
    mm_force_field: MMForceFieldMode = "off"
    density_g_cm3: float | None = None
    coulomb_cutoff_angstrom: float = 12.5
    moldescriptor_file: str | None = None
    guff_file: str | None = None
    topology_file: str | None = None
    parameter_file: str | None = None
    intra_nonbonded_file: str | None = None
    dftb_template_file: str | None = None
    turbomole_define_template_file: str | None = None
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


class SetupFileReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: SetupFileRole
    name: str
    content: str | None = None


class SetupFile(SetupFileReference):
    content: str


class RunPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    setup: SimulationSetup
    structure: Structure | None = None
    equilibration: EquilibrationStage | None = None
    sampling_run_count: int = Field(default=1, ge=1, le=999)
    setup_files: list[SetupFileReference] = Field(
        default_factory=list,
        max_length=6,
    )


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
    sampling_run_count: int | None = Field(default=None, ge=1, le=999)
    setup_files: list[SetupFile] = Field(default_factory=list, max_length=6)


class DoctorReport(BaseModel):
    pq: PQStatus
    runners: list[RunnerStatus]
    diagnostics: list[Diagnostic]
