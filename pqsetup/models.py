from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


Severity = Literal["error", "warning", "info"]
Ensemble = Literal["NPT", "NVT", "NVE", "OPT"]
JobType = Literal["mm-md", "qm-md", "qm-rpmd", "mm-opt"]


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
    file_prefix: str = "pq-run"
    timestep_fs: float | None = 0.5
    steps: int | None = 1000
    temperature_k: float | None = 298.15
    pressure_bar: float | None = None
    thermostat: str | None = "velocity_rescaling"
    thermostat_relaxation_ps: float | None = 0.1
    manostat: str | None = None
    manostat_relaxation_ps: float | None = 1.0
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


class Bootstrap(BaseModel):
    version: str
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
    setup: SimulationSetup
    structure: Structure
    project_name: str = "pq-run"
    preparation: PreparationMetadata | None = None


class DoctorReport(BaseModel):
    pq: PQStatus
    runners: list[RunnerStatus]
    diagnostics: list[Diagnostic]


JsonObject = dict[str, Any]
