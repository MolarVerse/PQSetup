from __future__ import annotations

import math
import re
from pathlib import Path

from .models import Diagnostic, RenderResult, SimulationSetup
from .release import (
    PQ_DEFAULT_RUNNER_SCRIPTS,
    PQ_MANOSTATS,
    PQ_PRESSURE_ISOTROPIES,
    PQ_QM_PROGRAMS,
    PQ_RUNNER_LABELS,
    PQ_THERMOSTATS,
    TARGET_PQ_RELEASE,
)
from .structures import analyze_structure, parse_structure_bytes


_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
_RUNNER_INPUT_NAMES = {
    "ase_dftbplus": "ase-dftbplus",
    "ase_xtb": "ase-xtb",
    "mace_mp": "mace",
    "mace_off": "mace_off",
}
_GENERATED_KEYS = {
    "jobtype",
    "nstep",
    "timestep",
    "start_file",
    "restart_file",
    "file_prefix",
    "random_seed",
    "init_velocities",
    "thermostat",
    "temp",
    "start_temp",
    "temp_ramp_steps",
    "temp_ramp_frequency",
    "t_relaxation",
    "friction",
    "nh_chain_length",
    "coupling_frequency",
    "manostat",
    "pressure",
    "p_relaxation",
    "compressibility",
    "isotropy",
    "qm_prog",
    "qm_script",
    "overwrite_output",
}
_EXTERNAL_RUNNERS = {"dftbplus", "pyscf", "turbomole"}


def render_input(setup: SimulationSetup) -> RenderResult:
    diagnostics = validate_setup(setup)
    if any(item.severity == "error" for item in diagnostics):
        return RenderResult(input_text="", diagnostics=diagnostics, valid=False)

    lines = [
        *_header(setup),
        "",
        "# ── Dynamics ──────────────────────────────────────────────────",
        f"jobtype = {setup.job_type};",
    ]
    if setup.ensemble != "OPT":
        lines.extend(
            [
                f"nstep = {setup.steps};",
                f"timestep = {_number(setup.timestep_fs)};",
            ]
        )
    lines.extend(
        [
            "",
            "# ── Files and continuation ────────────────────────────────────",
            f"start_file = {setup.start_file};",
            f"restart_file = {restart_filename(setup)};",
            f"file_prefix = {setup.file_prefix};",
        ]
    )
    if setup.overwrite_output:
        lines.append("overwrite_output = on;")

    if setup.ensemble != "OPT":
        lines.extend(
            [
                "",
                "# ── Initial state ─────────────────────────────────────────────",
            ]
        )
        if setup.initialize_velocities or setup.ensemble in {"NVT", "NPT"}:
            lines.append(f"temp = {_number(setup.temperature_k)};")
        if setup.initialize_velocities:
            lines.append("init_velocities = true;")
        lines.append(f"random_seed = {setup.random_seed};")
    if setup.ensemble in {"NVT", "NPT"}:
        lines.extend(
            [
                "",
                "# ── Temperature coupling ──────────────────────────────────────",
                f"thermostat = {setup.thermostat};",
            ]
        )
        if setup.start_temperature_k is not None:
            lines.append(f"start_temp = {_number(setup.start_temperature_k)};")
            if setup.temperature_ramp_steps is not None:
                lines.append(f"temp_ramp_steps = {setup.temperature_ramp_steps};")
            lines.append(f"temp_ramp_frequency = {setup.temperature_ramp_frequency};")
        if (
            setup.thermostat in {"berendsen", "velocity_rescaling"}
            and setup.thermostat_relaxation_ps is not None
        ):
            lines.append(f"t_relaxation = {_number(setup.thermostat_relaxation_ps)};")
        elif setup.thermostat == "langevin":
            lines.append(f"friction = {_number(setup.thermostat_friction_ps_inverse)};")
        elif setup.thermostat == "nh-chain":
            lines.extend(
                [
                    f"nh-chain_length = {setup.nh_chain_length};",
                    "coupling_frequency = "
                    f"{_number(setup.coupling_frequency_cm_inverse)};",
                ]
            )
    if setup.ensemble == "NPT":
        lines.extend(
            [
                "",
                "# ── Pressure coupling ─────────────────────────────────────────",
                f"manostat = {setup.manostat};",
                f"pressure = {_number(setup.pressure_bar)};",
            ]
        )
        if setup.manostat_relaxation_ps is not None:
            lines.append(f"p_relaxation = {_number(setup.manostat_relaxation_ps)};")
        lines.extend(
            [
                f"compressibility = {_number(setup.compressibility_bar_inverse)};",
                f"isotropy = {setup.pressure_isotropy};",
            ]
        )

    if setup.job_type.startswith("qm-") and setup.runner:
        runner_name = _RUNNER_INPUT_NAMES.get(setup.runner, setup.runner)
        lines.extend(
            [
                "",
                "# ── Electronic structure ──────────────────────────────────────",
                f"qm_prog = {runner_name};",
            ]
        )
        runner_script = setup.runner_script or PQ_DEFAULT_RUNNER_SCRIPTS.get(
            setup.runner
        )
        if runner_script:
            lines.append(f"qm_script = {runner_script};")
        if (
            setup.runner == "ase_xtb"
            and "xtb_method" not in setup.extra_settings
            and "xtb-method" not in setup.extra_settings
        ):
            lines.append("xtb_method = gfn2-xtb;")
    if setup.extra_settings:
        lines.extend(
            [
                "",
                "# ── Additional settings ───────────────────────────────────────",
            ]
        )
        for key in sorted(setup.extra_settings):
            lines.append(f"{key} = {_value(setup.extra_settings[key])};")
    return RenderResult(
        input_text="\n".join(lines).rstrip() + "\n",
        diagnostics=diagnostics,
        valid=True,
    )


def validate_setup(setup: SimulationSetup) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
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
    if not setup.start_file:
        diagnostics.append(_error("input.start_file", "Start file is required."))
    if not setup.file_prefix:
        diagnostics.append(_error("input.file_prefix", "Run name is required."))
    if len(setup.start_file) > 255:
        diagnostics.append(_error("input.start_file", "Start filename is too long."))
    if setup.restart_file and len(setup.restart_file) > 255:
        diagnostics.append(
            _error("input.restart_file", "Restart filename is too long.")
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
    if setup.start_temperature_k is not None and not _nonnegative_finite(
        setup.start_temperature_k
    ):
        diagnostics.append(
            _error(
                "conditions.start_temperature",
                "Starting temperature must be finite and non-negative.",
            )
        )
    if setup.temperature_ramp_steps is not None and setup.start_temperature_k is None:
        diagnostics.append(
            _error(
                "conditions.ramp_steps",
                "A temperature ramp needs a starting temperature.",
            )
        )
    if setup.temperature_ramp_steps is not None and setup.temperature_ramp_steps < 0:
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
    if setup.random_seed < 0 or setup.random_seed > 4_294_967_295:
        diagnostics.append(
            _error(
                "run.random_seed",
                "Random seed must be between 0 and 4294967295.",
            )
        )
    for name, token_value in {
        "start_file": setup.start_file,
        "restart_file": setup.restart_file,
        "file_prefix": setup.file_prefix,
        "runner_script": setup.runner_script,
    }.items():
        if token_value and (
            any(character in token_value for character in ";\n\r#")
            or any(character.isspace() for character in token_value)
        ):
            diagnostics.append(
                _error(
                    f"input.{name}",
                    f"{name.replace('_', ' ').capitalize()} contains an invalid character.",
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
        elif (
            setup.runner in _EXTERNAL_RUNNERS
            and not setup.runner_script
            and setup.runner not in PQ_DEFAULT_RUNNER_SCRIPTS
            and "qm_script_full_path" not in setup.extra_settings
            and "qm-script-full-path" not in setup.extra_settings
        ):
            diagnostics.append(
                _error(
                    "runner.script",
                    f"{setup.runner} needs a QM runner script.",
                )
            )
    for key, value in setup.extra_settings.items():
        normalized = key.replace("-", "_").lower()
        if not _KEY.fullmatch(key):
            diagnostics.append(
                _error(
                    "input.extra_key",
                    f"'{key}' is not a valid PQ keyword.",
                )
            )
        elif normalized in _GENERATED_KEYS:
            diagnostics.append(
                _error(
                    "input.extra_conflict",
                    f"'{key}' is already managed by PQSetup.",
                )
            )
        if isinstance(value, float) and not math.isfinite(value):
            diagnostics.append(
                _error(
                    "input.extra_value",
                    f"'{key}' must be finite.",
                )
            )
        if isinstance(value, str) and any(character in value for character in ";\n\r#"):
            diagnostics.append(
                _error(
                    "input.extra_value",
                    f"'{key}' contains an invalid character.",
                )
            )
    return diagnostics


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


def _header(setup: SimulationSetup) -> list[str]:
    width = 62
    title = "─ PQSetup · simulation input "
    top = title + "─" * (width - len(title))

    def row(value: str) -> str:
        content = value if len(value) <= width - 2 else f"{value[: width - 3]}…"
        return f"# │ {content:<{width - 2}} │"

    method = PQ_RUNNER_LABELS.get(setup.runner or "", setup.runner or setup.job_type)
    transition = f"{setup.start_file} → {restart_filename(setup)}"

    return [
        f"# ╭{top}╮",
        row(f"       ●          {setup.ensemble} · {method}"),
        row(f"      ╱ ╲         {transition}"),
        row(f"     ●───●        Written by PQSetup · target {TARGET_PQ_RELEASE}"),
        f"# ╰{'─' * width}╯",
        "# Generated deterministically. Review paths and resources before running.",
    ]


def _number(value: float | None) -> str:
    if value is None:
        raise ValueError("Missing numeric value.")
    return f"{value:.10g}"


def _value(value: str | int | float | bool) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)
