"""Presentation of generated PQ inputs; all output in this module is commentary."""
from __future__ import annotations

import math
import re

from .mm import mm_method_label
from .models import SimulationSetup
from .release import PQ_RUNNER_LABELS, TARGET_PQ_RELEASE
from .validation import restart_filename


def _number(value: float | None) -> str:
    if value is None:
        raise ValueError("Missing numeric value.")
    return f"{value:.10g}"


SECTION_WIDTH = 64
NOTE_COLUMN = 30

# One-line quips per section. Purely cosmetic (comments), always deterministic.
_SECTION_QUIPS = {
    "dynamics": "how long, how fine",
    "files & continuation": "from here to there",
    "initial state": "roll the dice (seeded)",
    "temperature coupling": "gentle nudges toward T",
    "pressure coupling": "squeeze, but politely",
    "molecular mechanics": "springs, spheres and charges",
    "force-field files": "the recipe book",
    "electronic structure": "where the electrons live",
    "additional settings": "the fine print",
}

# A glyph per section: the divider reads `# ── ψ electronic structure ───`.
_SECTION_GLYPHS = {
    "dynamics": "∫",
    "files & continuation": "⇄",
    "initial state": "⚄",
    "temperature coupling": "T",
    "pressure coupling": "P",
    "molecular mechanics": "⚛",
    "force-field files": "⚙",
    "electronic structure": "ψ",
    "additional settings": "+",
    "fin": "∎",
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
    "Equilibrated is a state of mind.",
    "Boltzmann would have wanted this.",
    "⟨A⟩ awaits. Sample well.",
    "Verlet, not verily.",
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
    glyph = _SECTION_GLYPHS.get(title)
    lead = f"# ── {glyph} {title} " if glyph else f"# ── {title} "
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


_BOLTZMANN_EV = 8.617333262e-5  # eV/K
_BOLTZMANN_KJ_MOL = 8.314462618e-3  # kJ/(mol·K)
_OH_STRETCH_PERIOD_FS = 9.1  # ~3650 cm⁻¹, the fastest common vibration


def _thermal_energy(temperature_k: float | None) -> str | None:
    """`25.7 meV · 2.48 kJ/mol` — what kT buys you at this temperature."""
    if temperature_k is None or not math.isfinite(temperature_k):
        return None
    mev = _BOLTZMANN_EV * temperature_k * 1000
    kj = _BOLTZMANN_KJ_MOL * temperature_k
    return f"{mev:.3g} meV · {kj:.3g} kJ/mol"


def _frames(steps: int | None, output_freq: object) -> str | None:
    """How many snapshots the trajectory will hold."""
    if steps is None:
        return None
    try:
        every = max(1, int(output_freq))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        every = 1
    count = steps // every
    stride = "every step" if every == 1 else f"every {every} steps"
    return f"{count} snapshots · {stride}"


def _resolution(timestep_fs: float | None) -> str | None:
    """Steps per O–H stretch period: the classic timestep sanity check."""
    if timestep_fs is None or timestep_fs <= 0:
        return None
    per_period = _OH_STRETCH_PERIOD_FS / timestep_fs
    verdict = "fine" if per_period >= 10 else "coarse" if per_period >= 4 else "bold"
    return f"{per_period:.0f} steps per O–H stretch · {verdict}"


def _ramp_bar(start_k: float, target_k: float, steps: int | None) -> str:
    """`# 100 K ━━━━━━━━━━━▶ 298.15 K · 500 steps`."""
    over = f" · {steps} steps" if steps else ""
    return f"# {_number(start_k)} K {'━' * 14}▶ {_number(target_k)} K{over}"


def sign_off(setup: SimulationSetup) -> list[str]:
    """Closing divider carrying a seed-picked one-liner."""
    return ["", _section("fin", _SIGN_OFFS[setup.random_seed % len(_SIGN_OFFS)])]


# figlet "small": the PQ wordmark that opens every run card.
_PQ_ART = (
    r" ___  ___   ",
    r"| _ \/ _ \  ",
    r"|  _/ (_) | ",
    r"|_|  \__\_\ ",
)
ART_WIDTH = 13  # art column incl. gutter; InputSource.tsx splits here too


def _header(setup: SimulationSetup) -> list[str]:
    """Run card in a box: PQ wordmark + name/kind, a rule, then facts."""
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
    if setup.ensemble != "OPT":
        resolution = _resolution(setup.timestep_fs)
        if resolution:
            facts.append(("timestep", resolution))
        if setup.ensemble in {"NVT", "NPT"} or setup.initialize_velocities:
            kt = _thermal_energy(setup.temperature_k)
            if kt:
                facts.append(("kT", kt))
        frames = _frames(setup.steps, setup.extra_settings.get("output_freq"))
        if frames:
            facts.append(("frames", frames))
    facts.append(("files", f"{setup.start_file} → {restart_filename(setup)}"))
    kind = "geometry optimization" if setup.ensemble == "OPT" else "molecular dynamics"
    title_texts = [
        "",
        setup.file_prefix,
        f"{kind} · PQ {TARGET_PQ_RELEASE}",
        "written by PQSetup",
    ]
    title_rows = [
        f"{art:<{ART_WIDTH}}{text}" for art, text in zip(_PQ_ART, title_texts)
    ]
    rows = [f"{label:<11} {value}" for label, value in facts]
    inner = max(
        SECTION_WIDTH - 6,
        *(len(row) for row in title_rows),
        *(len(row) for row in rows),
    )
    rule = "─" * (inner + 2)
    return [
        f"# ┌{rule}┐",
        *(f"# │ {row:<{inner}} │" for row in title_rows),
        f"# ├{rule}┤",
        *(f"# │ {row:<{inner}} │" for row in rows),
        f"# └{rule}┘",
    ]
