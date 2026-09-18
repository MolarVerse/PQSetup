/**
 * Optional PQ keywords the UI exposes per calculator, written through
 * `SimulationSetup.extra_settings`. Keys follow the PQ input reference; the
 * writer already skips its own defaults when one of these is present.
 */
import type { MMForceFieldMode, SimulationSetup } from "./types";

export type ExtraValue = string | number | boolean;
export type ExtraSettings = Record<string, ExtraValue>;

export interface ChoiceOption {
  value: string;
  label: string;
}

export const XTB_METHODS: ChoiceOption[] = [
  { value: "gfn2-xtb", label: "GFN2-xTB" },
  { value: "gfn1-xtb", label: "GFN1-xTB" },
  { value: "ipea1-xtb", label: "IPEA1-xTB" },
];

export const SLAKOS_SETS: ChoiceOption[] = [
  { value: "3ob", label: "3ob" },
  { value: "matsci", label: "matsci" },
  { value: "custom", label: "Custom path" },
];

export const MACE_MODELS: ChoiceOption[] = [
  { value: "small", label: "small" },
  { value: "medium", label: "medium" },
  { value: "large", label: "large" },
  { value: "small-0b", label: "small-0b" },
  { value: "medium-0b", label: "medium-0b" },
  { value: "small-0b2", label: "small-0b2" },
  { value: "medium-0b2", label: "medium-0b2" },
  { value: "large-0b2", label: "large-0b2" },
  { value: "medium-0b3", label: "medium-0b3" },
  { value: "medium-mpa-0", label: "medium-mpa-0" },
  { value: "medium-omat-0", label: "medium-omat-0" },
  { value: "custom", label: "Custom path" },
];

/** MACE-OFF ships only the three foundation sizes. */
export const MACE_OFF_MODELS = MACE_MODELS.slice(0, 3);

export const MACE_MODES: ChoiceOption[] = [
  { value: "accurate", label: "accurate · e3nn reference" },
  { value: "fast", label: "fast · cuequivariance kernels" },
];

export const NONCOULOMB_KINDS: ChoiceOption[] = [
  { value: "guff", label: "GUFF" },
  { value: "lj", label: "Lennard-Jones" },
  { value: "buck", label: "Buckingham" },
  { value: "morse", label: "Morse" },
];

export const LONG_RANGE_KINDS: ChoiceOption[] = [
  { value: "none", label: "None" },
  { value: "wolf", label: "Wolf summation" },
  { value: "reaction-field", label: "Reaction field" },
];

// M-SHAKE (needs an mshake_file) and the water models / rnoncoulomb exist only
// in PQ's development tree, not in the v0.7.x releases PQSetup targets.
export const SHAKE_MODES: ChoiceOption[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "SHAKE + RATTLE" },
];

/** Runners that PQ drives through an external script (qm_script_full_path). */
export function usesExternalScript(runner: string | null): boolean {
  return runner === "dftbplus" || runner === "pyscf" || runner === "turbomole";
}

/** Defaults PQ (or the writer) applies when a key is absent. */
export const QM_DEFAULTS = {
  xtb_method: "gfn2-xtb",
  slakos: "3ob",
  mace_model: "medium",
  mace_mode: "accurate",
  qm_loop_time_limit: 3600,
} as const;

export const MM_DEFAULTS = {
  noncoulomb: "guff",
  long_range: "none",
  wolf_param: 0.25,
  shake: "off",
  "shake-tolerance": 1e-8,
  "shake-iter": 20,
  "rattle-tolerance": 1e4,
  "rattle-iter": 20,
  "cell-number": 7,
} as const;

export function extraString(
  extra: ExtraSettings,
  key: string,
  fallback: string,
): string {
  const value = extra[key];
  return typeof value === "string" ? value : fallback;
}

export function extraNumber(
  extra: ExtraSettings,
  key: string,
): number | null {
  const value = extra[key];
  return typeof value === "number" ? value : null;
}

export function extraBool(
  extra: ExtraSettings,
  key: string,
  fallback: boolean,
): boolean {
  const value = extra[key];
  if (typeof value === "boolean") return value;
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  return fallback;
}

/** Runner-specific dispersion default: the writer turns it on for ASE DFTB+. */
export function dispersionDefault(runner: string | null): boolean {
  return runner === "ase_dftbplus";
}

/** PQ applies D3 dispersion for ASE DFTB+ and MACE; xTB ignores the key. */
export function supportsDispersion(runner: string | null): boolean {
  return (
    runner === "ase_dftbplus" || runner === "mace_mp" || runner === "mace_off"
  );
}

export function usesGuff(mode: MMForceFieldMode): boolean {
  return mode === "off" || mode === "bonded";
}

export function usesTopology(mode: MMForceFieldMode): boolean {
  return mode === "on" || mode === "bonded";
}

/** Keys the settings dialog owns; anything else in extra_settings is kept. */
export const QM_KEYS = [
  "xtb_method",
  "slakos",
  "slakos_path",
  "third_order",
  "hubbard_derivs",
  "dispersion",
  "remove_net_force",
  "mace_model",
  "mace_model_path",
  "mace_mode",
  "qm_loop_time_limit",
  "qm_script_full_path",
] as const;

export const MM_KEYS = [
  "noncoulomb",
  "long_range",
  "wolf_param",
  "rf_epsilon",
  "cell-list",
  "cell-number",
  "shake",
  "shake-tolerance",
  "shake-iter",
  "rattle-tolerance",
  "rattle-iter",
  "distance-constraints",
] as const;

/** Momentum / temperature resets: valid for every MD job, never pruned. */
export const RESET_KEYS = [
  "nscale",
  "fscale",
  "nreset",
  "freset",
  "nreset_angular",
  "freset_angular",
  "freset_forces",
] as const;

/**
 * Keys that make sense for the current method/runner. Anything owned by the
 * settings dialogs but not in this set is stale (e.g. `shake` after switching
 * to QM) and must be dropped before rendering.
 */
export function applicableSettingKeys(setup: SimulationSetup): Set<string> {
  const keys = new Set<string>();
  if (setup.job_type === "mm-md") {
    for (const key of [
          "long_range",
      "wolf_param",
      "rf_epsilon",
      "cell-list",
      "cell-number",
    ]) {
      keys.add(key);
    }
    if (usesGuff(setup.mm_force_field)) {
      keys.add("noncoulomb");
    }
    if (usesTopology(setup.mm_force_field)) {
      for (const key of [
        "shake",
        "shake-tolerance",
        "shake-iter",
        "rattle-tolerance",
        "rattle-iter",
                    "distance-constraints",
      ]) {
        keys.add(key);
      }
    }
    return keys;
  }
  keys.add("qm_loop_time_limit");
  keys.add("remove_net_force");
  const runner = setup.runner;
  if (usesExternalScript(runner)) keys.add("qm_script_full_path");
  if (runner === "ase_xtb") keys.add("xtb_method");
  if (runner === "ase_dftbplus") {
    keys.add("slakos");
    keys.add("slakos_path");
    keys.add("third_order");
    keys.add("hubbard_derivs");
  }
  if (runner === "mace_mp" || runner === "mace_off") {
    keys.add("mace_model");
    keys.add("mace_model_path");
    keys.add("mace_mode");
  }
  if (supportsDispersion(runner)) keys.add("dispersion");
  return keys;
}

/** Drop dialog-owned keys that no longer apply; returns the same object if clean. */
export function pruneExtraSettings(setup: SimulationSetup): ExtraSettings {
  const owned = new Set<string>([...QM_KEYS, ...MM_KEYS]);
  const allowed = applicableSettingKeys(setup);
  const stale = Object.keys(setup.extra_settings).filter(
    (key) => owned.has(key) && !allowed.has(key),
  );
  if (stale.length === 0) return setup.extra_settings;
  const next = { ...setup.extra_settings };
  for (const key of stale) delete next[key];
  return next;
}

/**
 * The advanced keywords in force, in input-file form (`key = value;`), so the
 * line under "Advanced" reads exactly like the file it produces.
 */
export function settingsLines(setup: SimulationSetup): string[] {
  const owned = new Set<string>([...QM_KEYS, ...MM_KEYS]);
  const allowed = applicableSettingKeys(setup);
  return Object.keys(setup.extra_settings)
    .filter((key) => owned.has(key) && allowed.has(key))
    .sort()
    .map((key) => {
      const value = setup.extra_settings[key];
      const text =
        typeof value === "boolean" ? (value ? "true" : "false") : String(value);
      return `${key} = ${text};`;
    });
}

function label(options: ChoiceOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/** Short "what differs from defaults" line for the settings chip. */
export function qmSettingsSummary(setup: SimulationSetup): string[] {
  const extra = setup.extra_settings;
  const parts: string[] = [];
  const runner = setup.runner;
  if (runner === "ase_xtb" && extra.xtb_method) {
    parts.push(label(XTB_METHODS, String(extra.xtb_method)));
  }
  if (runner === "ase_dftbplus") {
    if (extra.slakos) parts.push(`slakos ${String(extra.slakos)}`);
    if (extraBool(extra, "third_order", false)) parts.push("3rd order");
  }
  if ((runner === "mace_mp" || runner === "mace_off") && extra.mace_model) {
    parts.push(`MACE ${String(extra.mace_model)}`);
  }
  if (extra.mace_mode === "fast") parts.push("fast kernels");
  if (supportsDispersion(runner) && "dispersion" in extra) {
    parts.push(
      extraBool(extra, "dispersion", dispersionDefault(runner))
        ? "dispersion on"
        : "dispersion off",
    );
  }
  if (extraBool(extra, "remove_net_force", false)) parts.push("net force removed");
  const limit = extraNumber(extra, "qm_loop_time_limit");
  if (limit != null) parts.push(limit <= 0 ? "no time limit" : `${limit} s limit`);
  return [...parts, ...resetSummary(extra)];
}

function resetSummary(extra: ExtraSettings): string[] {
  const parts: string[] = [];
  if (extraNumber(extra, "nscale") != null || extraNumber(extra, "fscale") != null) {
    parts.push("T rescaling");
  }
  if (
    RESET_KEYS.slice(2).some((key) => extraNumber(extra, key) != null)
  ) {
    parts.push("momentum resets");
  }
  return parts;
}

export function mmSettingsSummary(setup: SimulationSetup): string[] {
  const extra = setup.extra_settings;
  const parts: string[] = [];
  if (extra.noncoulomb && extra.noncoulomb !== MM_DEFAULTS.noncoulomb) {
    parts.push(label(NONCOULOMB_KINDS, String(extra.noncoulomb)));
  }
  if (extra.long_range && extra.long_range !== MM_DEFAULTS.long_range) {
    parts.push(label(LONG_RANGE_KINDS, String(extra.long_range)));
  }
  if (extraBool(extra, "cell-list", false)) parts.push("cell list");
  if (extra.shake && extra.shake !== MM_DEFAULTS.shake) {
    parts.push(label(SHAKE_MODES, String(extra.shake)));
  }
  if (extraBool(extra, "distance-constraints", false)) {
    parts.push("distance constraints");
  }
  return [...parts, ...resetSummary(extra)];
}
