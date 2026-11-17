import { clampSamplingRunCount } from "./runPlan";
import { INITIAL_EQUILIBRATION, INITIAL_SETUP } from "./setupState";
import type {
  EquilibrationStage,
  PreparationMetadata,
  SetupFile,
  SetupFileRole,
  SimulationSetup,
  StructureAnalysis,
} from "./types";

/** Browser storage key of the remembered setup page. */
export const SAVED_SETUP_KEY = "pqsetup.setup";
const SAVED_SETUP_VERSION = 1;

/** The form state that defines the run plan. */
export interface SetupForm {
  setup: SimulationSetup;
  equilibration: EquilibrationStage | null;
  samplingRunCount: number;
  setupFiles: SetupFile[];
  baseStartFile: string;
  derivedRunName: string;
}

/** The analysed structure the form was prepared for. */
export interface SavedStructure {
  analysis: StructureAnalysis;
  originalAnalysis: StructureAnalysis | null;
  preparation: PreparationMetadata | null;
  jitter: boolean;
  sigma: number;
  jitterSeed: number;
}

export interface SavedSetup {
  form: SetupForm;
  structure: SavedStructure | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Remember the page; a structure too large for the browser quota is left
 * out. Returns what was kept.
 */
export function saveSetup(
  storage: StorageLike | null,
  saved: SavedSetup,
): "all" | "settings" | "nothing" {
  if (!storage) return "nothing";
  const write = (value: SavedSetup) =>
    storage.setItem(
      SAVED_SETUP_KEY,
      JSON.stringify({ version: SAVED_SETUP_VERSION, ...value }),
    );
  try {
    write(saved);
    return saved.structure ? "all" : "settings";
  } catch {
    try {
      write({ ...saved, structure: null });
      return "settings";
    } catch {
      return "nothing";
    }
  }
}

export function clearSavedSetup(storage: StorageLike | null): void {
  try {
    storage?.removeItem(SAVED_SETUP_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function loadSavedSetup(storage: StorageLike | null): SavedSetup | null {
  let value: unknown;
  try {
    const text = storage?.getItem(SAVED_SETUP_KEY);
    if (!text) return null;
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== SAVED_SETUP_VERSION) return null;
  const form = value.form;
  if (!isRecord(form) || !isRecord(form.setup)) return null;
  return {
    form: {
      setup: mergeSetup(form.setup, { keepNull: true }),
      equilibration: isRecord(form.equilibration)
        ? mergeEquilibration(form.equilibration)
        : null,
      samplingRunCount: clampSamplingRunCount(Number(form.samplingRunCount)),
      setupFiles: Array.isArray(form.setupFiles)
        ? form.setupFiles.filter(isSetupFile)
        : [],
      baseStartFile:
        typeof form.baseStartFile === "string"
          ? form.baseStartFile
          : INITIAL_SETUP.start_file,
      derivedRunName:
        typeof form.derivedRunName === "string"
          ? form.derivedRunName
          : INITIAL_SETUP.file_prefix,
    },
    structure: savedStructure(value.structure),
  };
}

/** True when the remembered form differs from a fresh page. */
export function differsFromInitial(saved: SavedSetup): boolean {
  return (
    saved.structure != null ||
    saved.form.equilibration != null ||
    saved.form.samplingRunCount !== 1 ||
    saved.form.setupFiles.length > 0 ||
    JSON.stringify(saved.form.setup) !== JSON.stringify(INITIAL_SETUP)
  );
}

/** What a run folder's pqproject.json brings back into the form. */
export interface ManifestImport {
  setup: SimulationSetup;
  equilibration: EquilibrationStage | null;
  samplingRunCount: number;
  structureName: string | null;
  cellGenerated: boolean | null;
  cellPaddingAngstrom: number | null;
  atomCount: number | null;
  setupFiles: { role: SetupFileRole; name: string }[];
  methodLabel: string | null;
}

export function manifestImport(text: string): ManifestImport | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  // Schema 3 records the run plan; schema 1 a single input setup.
  const plan = isRecord(value.plan) ? value.plan : null;
  const setupRecord = plan?.setup ?? value.setup;
  if (!isRecord(setupRecord)) return null;
  const files = isRecord(value.files) ? value.files : {};
  const structureFile = isRecord(files.structure) ? files.structure : {};
  const structure = isRecord(value.structure) ? value.structure : {};
  const method = isRecord(value.method) ? value.method : {};
  const equilibration =
    plan && isRecord(plan.equilibration) && plan.equilibration.enabled === true
      ? mergeEquilibration(plan.equilibration)
      : null;
  const runCount = Number(plan?.sampling_run_count ?? 1);
  return {
    setup: mergeSetup(setupRecord, { keepNull: false }),
    equilibration,
    samplingRunCount: clampSamplingRunCount(Number.isFinite(runCount) ? runCount : 1),
    structureName:
      typeof structureFile.name === "string" ? structureFile.name : null,
    cellGenerated:
      typeof structure.cell_generated === "boolean"
        ? structure.cell_generated
        : null,
    cellPaddingAngstrom:
      typeof structure.cell_padding_angstrom === "number"
        ? structure.cell_padding_angstrom
        : null,
    atomCount:
      typeof structure.atom_count === "number" ? structure.atom_count : null,
    setupFiles: Array.isArray(plan?.setup_files)
      ? plan.setup_files.filter(
          (item): item is { role: SetupFileRole; name: string } =>
            isRecord(item) &&
            typeof item.role === "string" &&
            typeof item.name === "string",
        )
      : [],
    methodLabel: typeof method.label === "string" ? method.label : null,
  };
}

/** One line naming what the import restored, for the page notice. */
export function manifestSummary(imported: ManifestImport): string {
  const setup = imported.setup;
  const runs = imported.samplingRunCount;
  const parts = [
    imported.methodLabel ?? setup.runner ?? setup.job_type,
    setup.ensemble,
    `${(setup.steps ?? 0).toLocaleString("en-US")} steps × ${setup.timestep_fs} fs`,
    `${runs} ${runs === 1 ? "run" : "runs"}`,
    imported.equilibration ? "equilibration on" : "equilibration off",
    `seed ${setup.random_seed}`,
    `name ${setup.file_prefix}`,
  ];
  return parts.join(" · ");
}

function mergeSetup(
  record: Record<string, unknown>,
  { keepNull }: { keepNull: boolean },
): SimulationSetup {
  // Only known fields: the backend rejects unknown keys.
  const merged: Record<string, unknown> = { ...INITIAL_SETUP };
  for (const key of Object.keys(INITIAL_SETUP)) {
    if (!(key in record)) continue;
    const item = record[key];
    if (item === undefined || (item === null && !keepNull)) continue;
    merged[key] = item;
  }
  if (!isRecord(merged.extra_settings)) {
    merged.extra_settings = { ...INITIAL_SETUP.extra_settings };
  }
  return merged as unknown as SimulationSetup;
}

function mergeEquilibration(
  record: Record<string, unknown>,
): EquilibrationStage {
  const merged: Record<string, unknown> = { ...INITIAL_EQUILIBRATION };
  for (const key of Object.keys(INITIAL_EQUILIBRATION)) {
    if (record[key] !== undefined) merged[key] = record[key];
  }
  merged.enabled = true;
  return merged as unknown as EquilibrationStage;
}

function savedStructure(value: unknown): SavedStructure | null {
  if (!isRecord(value) || !isAnalysis(value.analysis)) return null;
  return {
    analysis: value.analysis,
    originalAnalysis: isAnalysis(value.originalAnalysis)
      ? value.originalAnalysis
      : null,
    preparation: isRecord(value.preparation)
      ? (value.preparation as unknown as PreparationMetadata)
      : null,
    jitter: value.jitter === true,
    sigma: typeof value.sigma === "number" ? value.sigma : 0.01,
    jitterSeed:
      typeof value.jitterSeed === "number"
        ? value.jitterSeed
        : INITIAL_SETUP.random_seed,
  };
}

function isAnalysis(value: unknown): value is StructureAnalysis {
  return (
    isRecord(value) &&
    isRecord(value.structure) &&
    Array.isArray(value.structure.atoms) &&
    isRecord(value.summary)
  );
}

function isSetupFile(value: unknown): value is SetupFile {
  return (
    isRecord(value) &&
    typeof value.role === "string" &&
    typeof value.name === "string" &&
    typeof value.content === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
