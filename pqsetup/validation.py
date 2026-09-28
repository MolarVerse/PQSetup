"""Validate PQ setups and input files before rendering or export."""

from __future__ import annotations

import math
from pathlib import Path

from .external_qm import selected_external_qm_script
from .keywords import KEY_PATTERN, validate_extra_settings
from .mm import MM_FILE_FIELDS, required_mm_file_roles
from .models import Diagnostic, ExternalQMCapabilities, SimulationSetup
from .release import (
    PQ_MANOSTATS,
    PQ_PRESSURE_ISOTROPIES,
    PQ_QM_PROGRAMS,
    PQ_THERMOSTATS,
    TARGET_PQ_RELEASE,
)
from .structures import analyze_structure, parse_structure_bytes


_KEY = KEY_PATTERN
_EXTERNAL_RUNNERS = {"dftbplus", "pyscf", "turbomole"}


def has_script_full_path(setup: SimulationSetup) -> bool:
    """True when the user points PQ at a script by path; excludes ``qm_script``."""
    return (
        "qm_script_full_path" in setup.extra_settings
        or "qm-script-full-path" in setup.extra_settings
    )


def validate_setup(
    setup: SimulationSetup,
    *,
    external_qm: ExternalQMCapabilities | None = None,
) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    _validate_workflow(setup, diagnostics)
    _validate_run(setup, diagnostics)
    _validate_temperature_ramp(setup, diagnostics)
    _validate_thermostat(setup, diagnostics)
    _validate_pressure(setup, diagnostics)
    _validate_seed(setup, diagnostics)
    _validate_file_references(setup, diagnostics)
    _validate_mm(setup, diagnostics)
    _validate_qm(setup, diagnostics, external_qm)
    diagnostics.extend(validate_extra_settings(setup))
    return diagnostics


def _validate_workflow(setup: SimulationSetup, diagnostics: list[Diagnostic]) -> None:
    if setup.ensemble == "OPT":
        diagnostics.append(
            _error(
                "workflow.unsupported",
                (
                    "Guided MM optimization needs force-field files and is "
                    "not available yet."
                ),
            )
        )
    if setup.job_type == "mm-opt" and setup.ensemble != "OPT":
        diagnostics.append(
            _error(
                "workflow.mm_opt_ensemble",
                ("mm-opt is an optimization job type and cannot use an MD ensemble."),
            )
        )
    if setup.job_type == "qm-rpmd":
        beads = setup.extra_settings.get("rpmd_n_replica")
        if beads is None:
            beads = setup.extra_settings.get("rpmd-n-replica")
        try:
            bead_count = int(beads)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            bead_count = None
        if bead_count is None or bead_count < 2:
            diagnostics.append(
                _error(
                    "workflow.rpmd_n_replica",
                    (
                        "qm-rpmd requires extra_settings['rpmd_n_replica'] "
                        "with at least 2 beads."
                    ),
                )
            )


def _validate_run(setup: SimulationSetup, diagnostics: list[Diagnostic]) -> None:
    if not setup.start_file:
        diagnostics.append(_error("input.start_file", "Start file is required."))
    if not setup.file_prefix:
        diagnostics.append(_error("input.file_prefix", "Run name is required."))
    if _utf8_too_long(setup.start_file, 255):
        diagnostics.append(_error("input.start_file", "Start filename is too long."))
    if setup.restart_file and _utf8_too_long(setup.restart_file, 255):
        diagnostics.append(
            _error("input.restart_file", "Restart filename is too long.")
        )
    if (
        setup.start_file
        and setup.start_file.casefold() == restart_filename(setup).casefold()
    ):
        diagnostics.append(
            _error(
                "input.restart_collision",
                (
                    "Start file and restart file must differ so PQ does not "
                    "overwrite the starting structure."
                ),
            )
        )
    if len(setup.file_prefix) > 128:
        diagnostics.append(_error("input.file_prefix", "Run name is too long."))
    if setup.ensemble != "OPT":
        if setup.steps is None or setup.steps <= 0:
            diagnostics.append(_error("run.steps", "Steps must be positive."))
        if not _positive_finite(setup.timestep_fs):
            diagnostics.append(
                _error(
                    "run.timestep",
                    "The timestep must be finite and positive.",
                )
            )
    if (setup.ensemble != "OPT" and setup.initialize_velocities) or setup.ensemble in {
        "NVT",
        "NPT",
    }:
        if not _positive_finite(setup.temperature_k):
            diagnostics.append(
                _error(
                    "conditions.temperature",
                    "Temperature must be finite and positive.",
                )
            )


def _validate_temperature_ramp(
    setup: SimulationSetup, diagnostics: list[Diagnostic]
) -> None:
    # A ramp only exists under a thermostat; the writer ignores it otherwise,
    # so it must not block an NVE run either.
    if setup.ensemble in {"NVT", "NPT"}:
        if setup.start_temperature_k is not None and not _nonnegative_finite(
            setup.start_temperature_k
        ):
            diagnostics.append(
                _error(
                    "conditions.start_temperature",
                    "Starting temperature must be finite and non-negative.",
                )
            )
        if (
            setup.temperature_ramp_steps is not None
            and setup.start_temperature_k is None
        ):
            diagnostics.append(
                _error(
                    "conditions.ramp_steps",
                    "A temperature ramp needs a starting temperature.",
                )
            )
        if (
            setup.temperature_ramp_steps is not None
            and setup.temperature_ramp_steps < 0
        ):
            diagnostics.append(
                _error(
                    "conditions.ramp_steps",
                    "Temperature ramp steps must be non-negative.",
                )
            )
        if (
            setup.temperature_ramp_steps is not None
            and setup.steps is not None
            and setup.temperature_ramp_steps > setup.steps
        ):
            diagnostics.append(
                _error(
                    "conditions.ramp_steps",
                    "Temperature ramp steps cannot exceed the run length.",
                )
            )
        if setup.temperature_ramp_frequency <= 0:
            diagnostics.append(
                _error(
                    "conditions.ramp_frequency",
                    "Temperature ramp frequency must be positive.",
                )
            )
        elif setup.start_temperature_k is not None:
            effective_ramp_steps = setup.temperature_ramp_steps or setup.steps
            if (
                effective_ramp_steps is not None
                and effective_ramp_steps > 0
                and setup.temperature_ramp_frequency > effective_ramp_steps
            ):
                diagnostics.append(
                    _error(
                        "conditions.ramp_frequency",
                        "Temperature ramp frequency cannot exceed the ramp length.",
                    )
                )


def _validate_thermostat(setup: SimulationSetup, diagnostics: list[Diagnostic]) -> None:
    if setup.ensemble in {"NVT", "NPT"}:
        if not setup.thermostat:
            diagnostics.append(
                _error(
                    "conditions.thermostat",
                    f"{setup.ensemble} needs a thermostat.",
                )
            )
        elif setup.thermostat not in PQ_THERMOSTATS:
            diagnostics.append(
                _error(
                    "conditions.thermostat",
                    f"Thermostat is not supported by PQ {TARGET_PQ_RELEASE}.",
                )
            )
        elif setup.thermostat in {"berendsen", "velocity_rescaling"}:
            if not _positive_finite(setup.thermostat_relaxation_ps):
                diagnostics.append(
                    _error(
                        "conditions.t_relaxation",
                        "Thermostat relaxation time must be finite and positive.",
                    )
                )
            elif (
                _positive_finite(setup.timestep_fs)
                and setup.thermostat_relaxation_ps * 1000 < setup.timestep_fs
            ):
                diagnostics.append(
                    _error(
                        "conditions.t_relaxation",
                        "Thermostat relaxation time cannot be shorter than the timestep.",
                    )
                )
        elif setup.thermostat == "langevin":
            if not _nonnegative_finite(setup.thermostat_friction_ps_inverse):
                diagnostics.append(
                    _error(
                        "conditions.friction",
                        "Langevin friction must be finite and non-negative.",
                    )
                )
        elif setup.thermostat == "nh-chain":
            if setup.nh_chain_length <= 0:
                diagnostics.append(
                    _error(
                        "conditions.nh_chain_length",
                        "Nose-Hoover chain length must be positive.",
                    )
                )
            if not _nonnegative_finite(setup.coupling_frequency_cm_inverse):
                diagnostics.append(
                    _error(
                        "conditions.coupling_frequency",
                        "Coupling frequency must be finite and non-negative.",
                    )
                )
            elif setup.coupling_frequency_cm_inverse == 0:
                diagnostics.append(
                    _warning(
                        "conditions.coupling_frequency",
                        "A zero coupling frequency disables Nose-Hoover coupling.",
                    )
                )


def _validate_pressure(setup: SimulationSetup, diagnostics: list[Diagnostic]) -> None:
    if setup.ensemble == "NPT":
        if not _finite(setup.pressure_bar):
            diagnostics.append(
                _error(
                    "conditions.pressure",
                    "Pressure must be finite.",
                )
            )
        if not setup.manostat:
            diagnostics.append(_error("conditions.manostat", "NPT needs a manostat."))
        elif setup.manostat not in PQ_MANOSTATS:
            diagnostics.append(
                _error(
                    "conditions.manostat",
                    f"Manostat is not supported by PQ {TARGET_PQ_RELEASE}.",
                )
            )
        if not _positive_finite(setup.manostat_relaxation_ps):
            diagnostics.append(
                _error(
                    "conditions.p_relaxation",
                    "Manostat relaxation time must be finite and positive.",
                )
            )
        elif (
            _positive_finite(setup.timestep_fs)
            and setup.manostat_relaxation_ps * 1000 < setup.timestep_fs
        ):
            diagnostics.append(
                _error(
                    "conditions.p_relaxation",
                    "Manostat relaxation time cannot be shorter than the timestep.",
                )
            )
        if not _nonnegative_finite(setup.compressibility_bar_inverse):
            diagnostics.append(
                _error(
                    "conditions.compressibility",
                    "Compressibility must be finite and non-negative.",
                )
            )
        if setup.pressure_isotropy not in PQ_PRESSURE_ISOTROPIES:
            diagnostics.append(
                _error(
                    "conditions.pressure_isotropy",
                    f"Pressure isotropy is not supported by PQ {TARGET_PQ_RELEASE}.",
                )
            )


def _validate_seed(setup: SimulationSetup, diagnostics: list[Diagnostic]) -> None:
    if setup.random_seed < 0 or setup.random_seed > 4_294_967_295:
        diagnostics.append(
            _error(
                "run.random_seed",
                "Random seed must be between 0 and 4294967295.",
            )
        )


def _validate_file_references(
    setup: SimulationSetup, diagnostics: list[Diagnostic]
) -> None:
    for name, token_value in {
        "start_file": setup.start_file,
        "restart_file": setup.restart_file,
        "file_prefix": setup.file_prefix,
        "runner_script": setup.runner_script,
        "moldescriptor_file": setup.moldescriptor_file,
        "guff_file": setup.guff_file,
        "topology_file": setup.topology_file,
        "parameter_file": setup.parameter_file,
        "intra_nonbonded_file": setup.intra_nonbonded_file,
        "mshake_file": setup.mshake_file,
        "dftb_template_file": setup.dftb_template_file,
        "turbomole_define_template_file": setup.turbomole_define_template_file,
    }.items():
        if token_value and (
            any(character in token_value for character in ";\n\r#\x00\\")
            or any(character.isspace() for character in token_value)
        ):
            diagnostics.append(
                _error(
                    f"input.{name}",
                    f"{name.replace('_', ' ').capitalize()} contains an invalid character.",
                )
            )
    if setup.job_type == "mm-md":
        for field_name in MM_FILE_FIELDS.values():
            filename = getattr(setup, field_name)
            if filename and Path(filename).name != filename:
                diagnostics.append(
                    _error(
                        f"mm.{field_name}",
                        (
                            f"{field_name.replace('_', ' ').capitalize()} "
                            "must be a filename."
                        ),
                    )
                )
            if filename and _utf8_too_long(filename, 255):
                diagnostics.append(
                    _error(
                        f"mm.{field_name}",
                        f"{field_name.replace('_', ' ').capitalize()} is too long.",
                    )
                )
    if setup.start_file and Path(setup.start_file).name != setup.start_file:
        diagnostics.append(
            _error(
                "input.start_file",
                "Start file must be a filename, not a path.",
            )
        )
    if Path(setup.file_prefix).name != setup.file_prefix:
        diagnostics.append(
            _error(
                "input.file_prefix",
                "Run name must not contain a directory.",
            )
        )
    if setup.start_file and Path(setup.start_file).suffix.lower() != ".rst":
        diagnostics.append(
            _error(
                "input.start_file",
                "Start file must use the PQ restart format (.rst).",
            )
        )
    if setup.restart_file:
        if Path(setup.restart_file).name != setup.restart_file:
            diagnostics.append(
                _error(
                    "input.restart_file",
                    "Restart file must be a filename, not a path.",
                )
            )
        if Path(setup.restart_file).suffix.lower() != ".rst":
            diagnostics.append(
                _error(
                    "input.restart_file",
                    "Restart file must use the PQ restart format (.rst).",
                )
            )


def _validate_mm(setup: SimulationSetup, diagnostics: list[Diagnostic]) -> None:
    if setup.job_type == "mm-md":
        if setup.density_g_cm3 is not None and not _positive_finite(
            setup.density_g_cm3
        ):
            diagnostics.append(
                _error("mm.density", "Density must be finite and positive.")
            )
        if not _positive_finite(setup.coulomb_cutoff_angstrom):
            diagnostics.append(
                _error(
                    "mm.coulomb_cutoff",
                    "Coulomb cutoff must be finite and positive.",
                )
            )
        for role in required_mm_file_roles(setup.mm_force_field, setup):
            field_name = MM_FILE_FIELDS[role]
            if role == "mshake":
                continue  # reported with the shake keyword by validate_extra_settings
            if not getattr(setup, field_name):
                diagnostics.append(
                    _error(
                        f"mm.{field_name}",
                        f"{field_name.replace('_', ' ').capitalize()} is required.",
                    )
                )


def _validate_qm(
    setup: SimulationSetup,
    diagnostics: list[Diagnostic],
    external_qm: ExternalQMCapabilities | None,
) -> None:
    if setup.job_type.startswith("qm-"):
        if not setup.runner:
            diagnostics.append(
                _error("runner.missing", "A QM runner must be selected.")
            )
        elif setup.runner not in PQ_QM_PROGRAMS:
            diagnostics.append(
                _error(
                    "runner.unknown",
                    f"The selected runner is not available in PQ {TARGET_PQ_RELEASE}.",
                )
            )
        elif setup.runner in _EXTERNAL_RUNNERS:
            _, script_error = selected_external_qm_script(
                setup.runner,
                setup.runner_script,
                external_qm,
            )
            has_full_path = has_script_full_path(setup)
            if script_error and (setup.runner_script or not has_full_path):
                diagnostics.append(_error("runner.script", script_error))
        for field_name in (
            "moldescriptor_file",
            "dftb_template_file",
            "turbomole_define_template_file",
        ):
            filename = getattr(setup, field_name)
            if filename and Path(filename).name != filename:
                diagnostics.append(
                    _error(
                        f"qm.{field_name}",
                        (
                            f"{field_name.replace('_', ' ').capitalize()} "
                            "must be a filename."
                        ),
                    )
                )
            if filename and _utf8_too_long(filename, 255):
                diagnostics.append(
                    _error(
                        f"qm.{field_name}",
                        f"{field_name.replace('_', ' ').capitalize()} is too long.",
                    )
                )


def validate_input_file(path: Path) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return [_error("input.read", str(error))]
    settings: dict[str, str] = {}
    without_comments = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
    for command in without_comments.split(";"):
        command = command.strip()
        if not command:
            continue
        if "=" not in command:
            diagnostics.append(
                _error(
                    "input.syntax",
                    f"Expected key = value near '{command[:40]}'.",
                )
            )
            continue
        key, value = (part.strip() for part in command.split("=", 1))
        if not _KEY.fullmatch(key) or not value:
            diagnostics.append(
                _error("input.syntax", f"Invalid assignment for '{key}'.")
            )
            continue
        normalized = key.replace("-", "_").lower()
        if normalized in settings:
            diagnostics.append(
                Diagnostic(
                    code="input.duplicate",
                    severity="warning",
                    message=f"'{key}' is set more than once.",
                )
            )
        settings[normalized] = value
    if "jobtype" not in settings:
        diagnostics.append(_error("input.jobtype", "jobtype is required."))
    elif settings["jobtype"].replace("_", "-").lower() != "mm-opt":
        for required in ("nstep", "timestep"):
            if required not in settings:
                diagnostics.append(
                    _error(
                        f"input.{required}",
                        f"{required} is required for molecular dynamics.",
                    )
                )
    start_name = settings.get("start_file")
    if not start_name:
        diagnostics.append(_error("input.start_file", "start_file is required."))
    else:
        structure_path = path.parent / start_name
        if not structure_path.is_file():
            diagnostics.append(
                _error(
                    "structure.missing",
                    f"Structure file '{start_name}' was not found.",
                )
            )
        else:
            try:
                structure = parse_structure_bytes(
                    structure_path.name, structure_path.read_bytes()
                )
                diagnostics.extend(analyze_structure(structure).diagnostics)
            except (OSError, ValueError) as error:
                diagnostics.append(_error("structure.read", f"Structure: {error}"))
    return diagnostics


def _positive_finite(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value > 0.0


def _utf8_too_long(value: str, limit: int) -> bool:
    try:
        return len(value.encode("utf-8")) > limit
    except UnicodeEncodeError:
        return True


def _finite(value: float | None) -> bool:
    return value is not None and math.isfinite(value)


def _nonnegative_finite(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value >= 0.0


def _error(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="error", message=message)


def _warning(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="warning", message=message)


def restart_filename(setup: SimulationSetup) -> str:
    return setup.restart_file or f"{setup.file_prefix}.rst"
