from __future__ import annotations

import math
import re
from pathlib import Path

from .external_qm import selected_external_qm_script
from .mm import MM_FILE_FIELDS, mm_method_label, required_mm_file_roles
from .models import (
    Diagnostic,
    ExternalQMCapabilities,
    RenderResult,
    SimulationSetup,
)
from .release import (
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
    "density",
    "rcoulomb",
    "virial",
    "force_field",
    "moldescriptor_file",
    "guff_file",
    "topology_file",
    "parameter_file",
    "intra_nonbonded_file",
    "dftb_file",
    "overwrite_output",
}
_EXTERNAL_RUNNERS = {"dftbplus", "pyscf", "turbomole"}


def render_input(
    setup: SimulationSetup,
    *,
    external_qm: ExternalQMCapabilities | None = None,
) -> RenderResult:
    diagnostics = validate_setup(setup, external_qm=external_qm)
    if any(item.severity == "error" for item in diagnostics):
        return RenderResult(input_text="", diagnostics=diagnostics, valid=False)

    lines = [
        *_header(setup),
        "",
        _section("dynamics"),
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
            _section("files & continuation"),
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
                _section("initial state"),
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
                _section("temperature coupling"),
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
                _section("pressure coupling"),
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

    if setup.job_type == "mm-md":
        lines.extend(
            [
                "",
                _section("molecular mechanics"),
            ]
        )
        if setup.density_g_cm3 is not None:
            lines.append(f"density = {_number(setup.density_g_cm3)};")
        lines.extend(
            [
                f"rcoulomb = {_number(setup.coulomb_cutoff_angstrom)};",
                "virial = molecular;",
                f"force-field = {setup.mm_force_field};",
                "",
                _section("force-field files"),
                f"moldescriptor_file = {setup.moldescriptor_file};",
            ]
        )
        if setup.mm_force_field in {"off", "bonded"}:
            lines.append(f"guff_file = {setup.guff_file};")
        if setup.mm_force_field in {"on", "bonded"}:
            lines.extend(
                [
                    f"topology_file = {setup.topology_file};",
                    f"parameter_file = {setup.parameter_file};",
                ]
            )
        if setup.mm_force_field in {"bonded", "on"} and setup.intra_nonbonded_file:
            lines.append(f"intra-nonbonded_file = {setup.intra_nonbonded_file};")

    if setup.job_type.startswith("qm-") and setup.runner:
        runner_name = _RUNNER_INPUT_NAMES.get(setup.runner, setup.runner)
        lines.extend(
            [
                "",
                _section("electronic structure"),
                f"qm_prog = {runner_name};",
            ]
        )
        runner_script, _ = selected_external_qm_script(
            setup.runner,
            setup.runner_script,
            external_qm,
        )
        if runner_script:
            lines.append(f"qm_script = {runner_script.name};")
        if setup.ensemble == "NPT":
            lines.append(
                "moldescriptor_file = "
                f"{setup.moldescriptor_file or 'moldescriptor.dat'};"
            )
        if setup.runner == "dftbplus":
            lines.append(
                f"dftb_file = {setup.dftb_template_file or 'dftb_in.template'};"
            )
        if (
            setup.runner == "ase_xtb"
            and "xtb_method" not in setup.extra_settings
            and "xtb-method" not in setup.extra_settings
        ):
            lines.append("xtb_method = gfn2-xtb;")
        if (
            setup.runner == "ase_dftbplus"
            and "slakos" not in setup.extra_settings
        ):
            lines.append("slakos = 3ob;")
            if "dispersion" not in setup.extra_settings:
                lines.append("dispersion = on;")
    if setup.extra_settings:
        lines.extend(
            [
                "",
                _section("additional settings"),
            ]
        )
        for key in sorted(setup.extra_settings):
            lines.append(f"{key} = {_value(setup.extra_settings[key])};")
    lines.extend(sign_off(setup))
    return RenderResult(
        input_text="\n".join(_annotate(lines)).rstrip() + "\n",
        diagnostics=diagnostics,
        valid=True,
    )


def validate_setup(
    setup: SimulationSetup,
    *,
    external_qm: ExternalQMCapabilities | None = None,
) -> list[Diagnostic]:
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
    if setup.job_type == "mm-opt" and setup.ensemble != "OPT":
        diagnostics.append(
            _error(
                "workflow.mm_opt_ensemble",
                (
                    "mm-opt is an optimization job type and cannot use an "
                    "MD ensemble."
                ),
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
        "moldescriptor_file": setup.moldescriptor_file,
        "guff_file": setup.guff_file,
        "topology_file": setup.topology_file,
        "parameter_file": setup.parameter_file,
        "intra_nonbonded_file": setup.intra_nonbonded_file,
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
        for role in required_mm_file_roles(setup.mm_force_field):
            field_name = MM_FILE_FIELDS[role]
            if not getattr(setup, field_name):
                diagnostics.append(
                    _error(
                        f"mm.{field_name}",
                        f"{field_name.replace('_', ' ').capitalize()} is required.",
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
        elif setup.runner in _EXTERNAL_RUNNERS:
            _, script_error = selected_external_qm_script(
                setup.runner,
                setup.runner_script,
                external_qm,
            )
            has_full_path = (
                "qm_script_full_path" in setup.extra_settings
                or "qm-script-full-path" in setup.extra_settings
            )
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


SECTION_WIDTH = 64
NOTE_COLUMN = 30

# One-line quips per section. Purely cosmetic (comments), always deterministic.
_SECTION_QUIPS = {
    "dynamics": "how long, how fine",
    "files & continuation": "where we start, where we end up",
    "initial state": "roll the dice (seeded)",
    "temperature coupling": "gentle nudges toward T",
    "pressure coupling": "squeeze, but politely",
    "molecular mechanics": "springs, spheres and charges",
    "force-field files": "the recipe book",
    "electronic structure": "where the electrons live",
    "additional settings": "the fine print",
}

_ENSEMBLE_QUIPS = {
    "NVE": "energy conserved · nothing else promised",
    "NVT": "keep it cool",
    "NPT": "temperature and pressure on a leash",
    "OPT": "downhill only",
}

# Sign-off picked by random_seed so every run card gets one, reproducibly.
_SIGN_OFFS = (
    "May your trajectory be ergodic.",
    "Conserve energy. Or at least temperature.",
    "Every timestep is a tiny leap of faith.",
    "Statistically, this will be fine.",
    "Entropy always wins — make it work for you.",
    "Integrate responsibly.",
    "Go compute something beautiful.",
    "The atoms are ready. Are you?",
)


# Trailing `# unit` notes for numeric keys; aligned per section by _annotate.
_NOTES = {
    "nstep": "steps",
    "timestep": "fs",
    "temp": "K",
    "start_temp": "K",
    "temp_ramp_steps": "steps",
    "temp_ramp_frequency": "steps",
    "t_relaxation": "ps",
    "friction": "ps⁻¹",
    "coupling_frequency": "cm⁻¹",
    "pressure": "bar",
    "p_relaxation": "ps",
    "compressibility": "bar⁻¹",
    "density": "g/cm³",
    "rcoulomb": "Å",
    "rnoncoulomb": "Å",
    "wolf_param": "Å⁻¹",
    "output_freq": "steps",
    "qm_loop_time_limit": "s",
    "init_velocities": "Maxwell–Boltzmann",
    "random_seed": "reproducible",
}
_ASSIGNMENT = re.compile(r"^([A-Za-z][A-Za-z0-9_-]*) = .*;$")


def _annotate(lines: list[str]) -> list[str]:
    """Append `# unit` notes to known keys in one shared column.

    Only annotated lines decide the column, so a long filename elsewhere does
    not push the notes out; `key = value;` itself stays untouched/greppable.
    """
    notes: list[str | None] = []
    for line in lines:
        match = _ASSIGNMENT.match(line)
        key = match.group(1).replace("-", "_").lower() if match else None
        notes.append(_NOTES.get(key) if key else None)
    if not any(notes):
        return lines
    column = max(
        NOTE_COLUMN,
        max(len(line) for line, note in zip(lines, notes) if note) + 2,
    )
    return [
        f"{line:<{column}}# {note}" if note else line
        for line, note in zip(lines, notes)
    ]


def _section(title: str, quip: str | None = None) -> str:
    """Divider with the title left and the quip right, rule in between:

    `# ── dynamics ──────────────────── how long, how fine ──`
    """
    quip = _SECTION_QUIPS.get(title) if quip is None else quip
    lead = f"# ── {title} "
    tail = f" {quip} ──" if quip else ""
    fill = "─" * max(4, SECTION_WIDTH - len(lead) - len(tail))
    return lead + fill + tail


def _span(steps: int | None, timestep_fs: float | None) -> str | None:
    """Human span of the run: `1000 × 0.5 fs = 0.5 ps of physics`."""
    if steps is None or timestep_fs is None:
        return None
    total_fs = steps * timestep_fs
    if total_fs >= 1e6:
        total = f"{total_fs / 1e6:.4g} ns"
    elif total_fs >= 1e3:
        total = f"{total_fs / 1e3:.4g} ps"
    else:
        total = f"{total_fs:.4g} fs"
    return f"{steps} × {_number(timestep_fs)} fs = {total} of physics"


def sign_off(setup: SimulationSetup) -> list[str]:
    """Closing divider carrying a seed-picked one-liner."""
    return ["", _section("fin", _SIGN_OFFS[setup.random_seed % len(_SIGN_OFFS)])]


def _header(setup: SimulationSetup) -> list[str]:
    """Run card in a box: name and kind on the title row, then facts."""
    method = (
        mm_method_label(setup.mm_force_field)
        if setup.job_type == "mm-md"
        else PQ_RUNNER_LABELS.get(
            setup.runner or "",
            setup.runner or setup.job_type,
        )
    )
    ensemble_quip = _ENSEMBLE_QUIPS.get(setup.ensemble)
    ensemble = (
        f"{setup.ensemble} · {ensemble_quip}" if ensemble_quip else setup.ensemble
    )
    facts: list[tuple[str, str]] = [
        ("ensemble", ensemble),
        ("method", method),
    ]
    span = _span(setup.steps, setup.timestep_fs)
    if span:
        facts.append(("span", span))
    facts.extend(
        [
            ("files", f"{setup.start_file} → {restart_filename(setup)}"),
            ("written by", f"PQSetup · target {TARGET_PQ_RELEASE}"),
        ]
    )
    kind = "geometry optimization" if setup.ensemble == "OPT" else "molecular dynamics"
    rows = [f"{label:<11} {value}" for label, value in facts]
    inner = max(
        SECTION_WIDTH - 6,
        len(setup.file_prefix) + 2 + len(kind),
        *(len(row) for row in rows),
    )
    title = f"{setup.file_prefix:<{inner - len(kind)}}{kind}"
    rule = "─" * (inner + 2)
    return [
        f"# ┌{rule}┐",
        f"# │ {title} │",
        f"# ├{rule}┤",
        *(f"# │ {row:<{inner}} │" for row in rows),
        f"# └{rule}┘",
    ]


def _number(value: float | None) -> str:
    if value is None:
        raise ValueError("Missing numeric value.")
    return f"{value:.10g}"


def _value(value: str | int | float | bool) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)
