"""Optional PQ input keywords ("Advanced settings") and what PQ accepts for them.

This is the single description of the keywords a user may add on top of the
ones PQSetup writes itself. It mirrors PQ's input parsers at the targeted
release (``src/input/inputFileParser/*.cpp`` and ``inputValidation.cpp``), so
the same file drives validation here and the settings dialog in the frontend.

Keys are compared case-insensitively with ``-`` and ``_`` treated alike, the
way PQ's reader does.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal

from .models import Diagnostic, SimulationSetup

KEY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")

# Keywords PQSetup writes from its own controls; adding them again would
# produce a duplicate line and PQ reads the last one, so they are refused.
GENERATED_KEYS = frozenset(
    {
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
        "force_field",
        "moldescriptor_file",
        "guff_file",
        "topology_file",
        "parameter_file",
        "intra_nonbonded_file",
        "mshake_file",
        "dftb_file",
        "overwrite_output",
    }
)

Scope = Literal["qm", "mm", "md"]
Kind = Literal["choice", "bool", "int", "float", "text"]

BOOL_TOKENS = frozenset({"on", "yes", "true", "off", "no", "false"})
_BOOL_FALSE = frozenset({"off", "no", "false"})

XTB_METHODS = ("gfn1-xtb", "gfn2-xtb", "ipea1-xtb")
SLAKOS_SETS = ("3ob", "matsci", "custom")
MACE_MODELS = (
    "small",
    "medium",
    "large",
    "small-0b",
    "medium-0b",
    "small-0b2",
    "medium-0b2",
    "large-0b2",
    "medium-0b3",
    "medium-mpa-0",
    "medium-omat-0",
    "custom",
)
MACE_OFF_MODELS = ("small", "medium", "large", "custom")
MACE_MODES = ("accurate", "fast")
NONCOULOMB_KINDS = ("guff", "lj", "buck", "morse")
LONG_RANGE_KINDS = ("none", "shifted", "reaction-field", "wolf")
VIRIAL_KINDS = ("molecular", "atomic")
SHAKE_MODES = ("off", "on", "shake", "mshake")

MACE_RUNNERS = ("mace_mp", "mace_off")
SCRIPTED_RUNNERS = ("dftbplus", "pyscf", "turbomole")
DISPERSION_RUNNERS = ("ase_dftbplus", "mace_mp", "mace_off")
GUFF_MODES = ("off", "bonded")
TOPOLOGY_MODES = ("on", "bonded")


@dataclass(frozen=True)
class Keyword:
    """One optional PQ keyword and the values its parser accepts."""

    name: str
    scope: Scope
    kind: Kind
    choices: tuple[str, ...] = ()
    minimum: float | None = None
    exclusive: bool = False
    runners: tuple[str, ...] = ()
    ff_modes: tuple[str, ...] = ()
    note: str = ""

    def applies(self, setup: SimulationSetup) -> bool:
        mm = setup.job_type.startswith("mm-")
        if self.scope == "qm" and mm:
            return False
        if self.scope == "mm" and not mm:
            return False
        if self.runners and not mm and setup.runner not in self.runners:
            return False
        if self.ff_modes and mm and setup.mm_force_field not in self.ff_modes:
            return False
        return True


KEYWORDS: tuple[Keyword, ...] = (
    # --- electronic structure -------------------------------------------
    Keyword(
        "xtb_method",
        "qm",
        "choice",
        choices=XTB_METHODS,
        runners=("ase_xtb",),
        note="Hamiltonian for the ASE xTB calculator.",
    ),
    Keyword(
        "slakos",
        "qm",
        "choice",
        choices=SLAKOS_SETS,
        runners=("ase_dftbplus",),
        note="Slater–Koster set; custom needs slakos_path.",
    ),
    Keyword(
        "slakos_path",
        "qm",
        "text",
        runners=("ase_dftbplus",),
        note="Directory with the .skf files (slakos = custom).",
    ),
    Keyword(
        "third_order",
        "qm",
        "bool",
        runners=("ase_dftbplus",),
        note="Third-order DFTB; PQ enables it for 3ob when unset.",
    ),
    Keyword(
        "hubbard_derivs",
        "qm",
        "text",
        runners=("ase_dftbplus",),
        note="Element: value pairs, comma separated; needs third order.",
    ),
    Keyword(
        "dispersion",
        "qm",
        "bool",
        runners=DISPERSION_RUNNERS,
        note="D3 dispersion correction (ASE DFTB+, MACE).",
    ),
    Keyword(
        "mace_model",
        "qm",
        "choice",
        choices=MACE_MODELS,
        runners=MACE_RUNNERS,
        note="Foundation model; MACE-OFF ships small, medium, large.",
    ),
    Keyword(
        "mace_model_path",
        "qm",
        "text",
        runners=MACE_RUNNERS,
        note="Local file or URL (mace_model = custom).",
    ),
    Keyword(
        "mace_mode",
        "qm",
        "choice",
        choices=MACE_MODES,
        runners=MACE_RUNNERS,
        note="fast uses cuequivariance kernels.",
    ),
    Keyword(
        "qm_script_full_path",
        "qm",
        "text",
        runners=SCRIPTED_RUNNERS,
        note="Script path that replaces the bundled qm_script lookup.",
    ),
    Keyword(
        "qm_loop_time_limit",
        "qm",
        "float",
        note="Wall-clock cap per QM call in seconds; ≤ 0 disables.",
    ),
    Keyword(
        "remove_net_force",
        "qm",
        "bool",
        note="Subtract the mean QM force after each call.",
    ),
    Keyword(
        "rpmd_n_replica",
        "qm",
        "int",
        minimum=1,
        note="Ring-polymer beads (qm-rpmd).",
    ),
    # --- molecular mechanics --------------------------------------------
    Keyword(
        "noncoulomb",
        "mm",
        "choice",
        choices=NONCOULOMB_KINDS,
        ff_modes=GUFF_MODES,
        note="How guff.dat is read; a parameter file sets its own type.",
    ),
    Keyword(
        "long_range",
        "mm",
        "choice",
        choices=LONG_RANGE_KINDS,
        note="Coulomb long-range correction.",
    ),
    Keyword(
        "wolf_param",
        "mm",
        "float",
        minimum=0.0,
        note="Wolf damping κ in Å⁻¹ (long_range = wolf).",
    ),
    Keyword(
        "rf_epsilon",
        "mm",
        "float",
        minimum=1.0,
        note="Dielectric constant (long_range = reaction-field).",
    ),
    Keyword(
        "virial",
        "mm",
        "choice",
        choices=VIRIAL_KINDS,
        note="molecular applies the intramolecular virial correction.",
    ),
    Keyword(
        "cell-list",
        "mm",
        "bool",
        note="Cell-list neighbour search; needs rcoulomb > 0.",
    ),
    Keyword(
        "cell-number",
        "mm",
        "int",
        minimum=1,
        note="Cells per direction (cell-list = on).",
    ),
    # --- constraints: any MD job, bonds come from a topology file ---------
    Keyword(
        "shake",
        "md",
        "choice",
        choices=SHAKE_MODES,
        ff_modes=TOPOLOGY_MODES,
        note="Bond constraints from the topology; mshake adds rigid bodies (MM).",
    ),
    Keyword("shake-tolerance", "md", "float", minimum=0.0, exclusive=True),
    Keyword("shake-iter", "md", "int", minimum=1),
    Keyword("rattle-tolerance", "md", "float", minimum=0.0, exclusive=True),
    Keyword("rattle-iter", "md", "int", minimum=1),
    Keyword("mshake-tolerance", "mm", "float", minimum=0.0, exclusive=True),
    Keyword("mshake-iter", "mm", "int", minimum=1),
    Keyword(
        "distance-constraints",
        "md",
        "bool",
        ff_modes=TOPOLOGY_MODES,
        note="Distance constraints defined in the topology.",
    ),
    # --- any MD job ------------------------------------------------------
    Keyword("nscale", "md", "int", minimum=0),
    Keyword("fscale", "md", "int", minimum=0),
    Keyword("nreset", "md", "int", minimum=0),
    Keyword("freset", "md", "int", minimum=0),
    Keyword("nreset_angular", "md", "int", minimum=0),
    Keyword("freset_angular", "md", "int", minimum=0),
    Keyword("freset_forces", "md", "int", minimum=0),
    Keyword("output_freq", "md", "int", minimum=1),
)

def normalize_key(key: str) -> str:
    return key.replace("-", "_").lower()


_BY_NAME = {normalize_key(keyword.name): keyword for keyword in KEYWORDS}


def normalize_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).strip().lower().replace("-", "_")


def lookup(key: str) -> Keyword | None:
    return _BY_NAME.get(normalize_key(key))


def extra_value(setup: SimulationSetup, key: str) -> object | None:
    """The user's value for ``key`` regardless of dash/underscore spelling."""
    wanted = normalize_key(key)
    for name, value in setup.extra_settings.items():
        if normalize_key(name) == wanted:
            return value
    return None


def uses_constraints(setup: SimulationSetup) -> bool:
    """True when SHAKE/RATTLE, M-SHAKE or distance constraints are switched on.

    PQ then reads the topology file for every job type, QM included.
    """
    shake = extra_value(setup, "shake")
    if shake is not None and normalize_value(shake) != "off":
        return True
    distance = extra_value(setup, "distance-constraints")
    return distance is not None and is_on(distance)


def is_off(value: object) -> bool:
    if isinstance(value, bool):
        return not value
    return normalize_value(value) in _BOOL_FALSE


def _as_number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except ValueError:
        return None


def _value_diagnostic(keyword: Keyword, key: str, value: object) -> Diagnostic | None:
    if keyword.kind == "choice":
        allowed = {normalize_value(option) for option in keyword.choices}
        if normalize_value(value) not in allowed:
            return _error(
                "input.extra_value",
                f"'{key}' must be one of: {', '.join(keyword.choices)}.",
            )
        return None
    if keyword.kind == "bool":
        if isinstance(value, bool):
            return None
        if str(value).strip().lower() not in BOOL_TOKENS:
            return _error(
                "input.extra_value",
                f"'{key}' must be on/off (or true/false, yes/no).",
            )
        return None
    if keyword.kind in {"int", "float"}:
        number = _as_number(value)
        if number is None or not math.isfinite(number):
            return _error("input.extra_value", f"'{key}' must be a finite number.")
        if keyword.kind == "int" and not number.is_integer():
            return _error("input.extra_value", f"'{key}' must be a whole number.")
        if keyword.minimum is not None:
            if keyword.exclusive and number <= keyword.minimum:
                return _error(
                    "input.extra_value",
                    f"'{key}' must be greater than {_number(keyword.minimum)}.",
                )
            if not keyword.exclusive and number < keyword.minimum:
                return _error(
                    "input.extra_value",
                    f"'{key}' must be at least {_number(keyword.minimum)}.",
                )
        return None
    if not str(value).strip():
        return _error("input.extra_value", f"'{key}' must not be empty.")
    return None


_HUBBARD_PAIR = re.compile(r"^[A-Z][a-z]?\s*:\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


def _hubbard_format_ok(text: str) -> bool:
    items = [item.strip() for item in text.split(",")]
    return all(item and _HUBBARD_PAIR.match(item) for item in items)


def validate_extra_settings(setup: SimulationSetup) -> list[Diagnostic]:
    """Check ``setup.extra_settings`` the way PQ's reader and validator would."""
    diagnostics: list[Diagnostic] = []
    extras: dict[str, object] = {}
    seen: dict[str, str] = {}

    for key, value in setup.extra_settings.items():
        normalized = normalize_key(key)
        if not KEY_PATTERN.fullmatch(key):
            diagnostics.append(
                _error("input.extra_key", f"'{key}' is not a valid PQ keyword.")
            )
            continue
        if normalized in GENERATED_KEYS:
            diagnostics.append(
                _error(
                    "input.extra_conflict",
                    f"'{key}' is already managed by PQSetup.",
                )
            )
            continue
        if normalized in seen:
            diagnostics.append(
                _error(
                    "input.extra_conflict",
                    f"'{key}' repeats '{seen[normalized]}'; PQ keeps only one.",
                )
            )
            continue
        seen[normalized] = key
        if isinstance(value, float) and not math.isfinite(value):
            diagnostics.append(
                _error("input.extra_value", f"'{key}' must be finite.")
            )
            continue
        if isinstance(value, str) and any(
            character in value for character in ";\n\r#"
        ):
            diagnostics.append(
                _error(
                    "input.extra_value",
                    f"'{key}' contains an invalid character.",
                )
            )
            continue
        extras[normalized] = value

        keyword = _BY_NAME.get(normalized)
        if keyword is None:
            diagnostics.append(
                _warning(
                    "input.extra_unknown",
                    f"'{key}' is not a keyword PQSetup knows; PQ decides.",
                )
            )
            continue
        problem = _value_diagnostic(keyword, key, value)
        if problem is not None:
            diagnostics.append(problem)
            continue
        if not keyword.applies(setup):
            diagnostics.append(_scope_diagnostic(keyword, key, setup))

    diagnostics.extend(_combination_diagnostics(setup, extras))
    return diagnostics


def _scope_diagnostic(
    keyword: Keyword, key: str, setup: SimulationSetup
) -> Diagnostic:
    mm = setup.job_type.startswith("mm-")
    if keyword.name == "cell-list" and not mm:
        return _error(
            "input.extra_scope",
            "Cell lists are not available for pure QM runs; PQ rejects them.",
        )
    if keyword.scope == "qm" and mm:
        where = "MM runs"
    elif keyword.scope == "mm" and not mm:
        where = "QM runs"
    elif keyword.runners:
        where = "this calculator"
    else:
        where = "this force-field mode"
    return _warning(
        "input.extra_scope",
        f"'{key}' is ignored for {where}.",
    )


def _combination_diagnostics(
    setup: SimulationSetup, extras: dict[str, object]
) -> list[Diagnostic]:
    """Rules PQ's ``inputValidation.cpp`` enforces across keywords."""
    diagnostics: list[Diagnostic] = []
    mm = setup.job_type.startswith("mm-")

    if not mm and setup.runner == "ase_dftbplus":
        slakos = normalize_value(extras.get("slakos", "3ob"))
        if slakos == "custom" and not str(extras.get("slakos_path", "")).strip():
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "Custom Slater–Koster parameters need slakos_path.",
                )
            )
        third_order = extras.get("third_order")
        effective_third = (
            not is_off(third_order) if third_order is not None else slakos == "3ob"
        )
        hubbard = extras.get("hubbard_derivs")
        if hubbard and not effective_third:
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "Hubbard derivatives need third-order DFTB; PQ rejects them "
                    "with third_order off.",
                )
            )
        if hubbard and not _hubbard_format_ok(str(hubbard)):
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "Hubbard derivatives must read like 'C: -0.1492, H: -0.1857'.",
                )
            )

    if not mm and setup.runner in MACE_RUNNERS:
        model = normalize_value(extras.get("mace_model", "medium"))
        path = str(extras.get("mace_model_path", "")).strip()
        if model == "custom" and not path:
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "A custom MACE model needs mace_model_path.",
                )
            )
        if model != "custom" and path:
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "mace_model_path is only read with mace_model = custom.",
                )
            )
        if setup.runner == "mace_off" and model not in {
            normalize_value(option) for option in MACE_OFF_MODELS
        }:
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "MACE-OFF ships only small, medium and large models.",
                )
            )

    shake = normalize_value(extras.get("shake", "off"))
    if not mm and shake == "mshake":
        diagnostics.append(
            _error(
                "input.extra_value",
                "M-SHAKE rigid bodies are offered for MM runs; use SHAKE + RATTLE.",
            )
        )
    if not mm and uses_constraints(setup) and not (setup.topology_file or "").strip():
        diagnostics.append(
            _error(
                "qm.topology_file",
                "Bond constraints need a topology file with a shake section.",
            )
        )

    if mm:
        long_range = normalize_value(extras.get("long_range", "none"))
        if long_range == "reaction_field" and extras.get("rf_epsilon") is None:
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "Reaction field needs a dielectric constant (rf_epsilon ≥ 1).",
                )
            )
        if shake == "mshake" and not (setup.mshake_file or "").strip():
            diagnostics.append(
                _error(
                    "mm.mshake_file",
                    "M-SHAKE needs a reference-geometry file (mshake_file).",
                )
            )
        if (
            is_on(extras.get("cell-list", extras.get("cell_list", "off")))
            and not setup.coulomb_cutoff_angstrom > 0
        ):
            diagnostics.append(
                _error(
                    "input.extra_value",
                    "A cell list needs a Coulomb cutoff greater than zero.",
                )
            )

    return diagnostics


def is_on(value: object) -> bool:
    if isinstance(value, bool):
        return value
    return normalize_value(value) in {"on", "yes", "true"}


def _number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def _error(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="error", message=message)


def _warning(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="warning", message=message)
