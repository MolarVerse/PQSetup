import { describe, expect, it } from "vitest";
import {
  SAVED_SETUP_KEY,
  clearSavedSetup,
  differsFromInitial,
  loadSavedSetup,
  manifestImport,
  manifestSummary,
  saveSetup,
  type SavedSetup,
} from "./savedSetup";
import { EXAMPLE, INITIAL_EQUILIBRATION, INITIAL_SETUP } from "./setupState";

function memoryStorage(limit = Infinity) {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new Error("QuotaExceededError");
      values.set(key, value);
    },
    removeItem: (key: string) => void values.delete(key),
  };
}

const saved: SavedSetup = {
  form: {
    setup: {
      ...INITIAL_SETUP,
      runner: "mace_off",
      steps: 10,
      file_prefix: "human-ethanol",
      start_file: "ethanol.rst",
    },
    equilibration: { ...INITIAL_EQUILIBRATION, steps: 200 },
    samplingRunCount: 2,
    setupFiles: [{ role: "moldescriptor", name: "moldescriptor.dat", content: "x" }],
    baseStartFile: "ethanol.rst",
    derivedRunName: "ethanol-run",
  },
  structure: {
    analysis: EXAMPLE,
    originalAnalysis: null,
    preparation: null,
    jitter: false,
    sigma: 0.01,
    jitterSeed: 238917,
  },
};

describe("remembered setup", () => {
  it("restores the saved form and structure", () => {
    const storage = memoryStorage();
    expect(saveSetup(storage, saved)).toBe("all");
    const loaded = loadSavedSetup(storage);
    expect(loaded).toEqual(saved);
    expect(loaded && differsFromInitial(loaded)).toBe(true);
  });

  it("keeps the settings when the structure exceeds the quota", () => {
    const settingsOnly = JSON.stringify({ version: 1, ...saved, structure: null });
    const storage = memoryStorage(settingsOnly.length);
    expect(saveSetup(storage, saved)).toBe("settings");
    expect(loadSavedSetup(storage)?.structure).toBeNull();
    expect(loadSavedSetup(storage)?.form.setup.runner).toBe("mace_off");
  });

  it("ignores broken, foreign and outdated records", () => {
    const storage = memoryStorage();
    storage.setItem(SAVED_SETUP_KEY, "{not json");
    expect(loadSavedSetup(storage)).toBeNull();
    storage.setItem(SAVED_SETUP_KEY, JSON.stringify({ version: 99, form: {} }));
    expect(loadSavedSetup(storage)).toBeNull();
    expect(loadSavedSetup(null)).toBeNull();
  });

  it("drops fields the backend no longer knows and fills new ones", () => {
    const storage = memoryStorage();
    const { steps: _steps, ...withoutSteps } = saved.form.setup;
    storage.setItem(
      SAVED_SETUP_KEY,
      JSON.stringify({
        version: 1,
        form: { ...saved.form, setup: { ...withoutSteps, retired_field: 1 } },
        structure: null,
      }),
    );
    const setup = loadSavedSetup(storage)?.form.setup;
    expect(setup).not.toHaveProperty("retired_field");
    expect(setup?.steps).toBe(INITIAL_SETUP.steps);
    expect(setup?.runner).toBe("mace_off");
  });

  it("does not treat an untouched page as a restored setup", () => {
    expect(
      differsFromInitial({
        form: {
          setup: INITIAL_SETUP,
          equilibration: null,
          samplingRunCount: 1,
          setupFiles: [],
          baseStartFile: "water-example.rst",
          derivedRunName: INITIAL_SETUP.file_prefix,
        },
        structure: null,
      }),
    ).toBe(false);
  });

  it("clears the record on reset", () => {
    const storage = memoryStorage();
    saveSetup(storage, saved);
    clearSavedSetup(storage);
    expect(storage.values.size).toBe(0);
  });
});

const manifest = {
  schema_version: 3,
  project_name: "human-ethanol",
  plan: {
    setup: {
      ...INITIAL_SETUP,
      ensemble: "NVE",
      thermostat: null,
      runner: "mace_off",
      runner_script: null,
      steps: 10,
      random_seed: 4242,
      start_file: "ethanol.rst",
      file_prefix: "human-ethanol",
      future_field: true,
    },
    project_name: "human-ethanol",
    equilibration: { ...INITIAL_EQUILIBRATION, enabled: true, steps: 200 },
    sampling_run_count: 3,
    setup_files: [{ role: "moldescriptor", name: "moldescriptor.dat" }],
  },
  files: { structure: { name: "ethanol.rst", sha256: "0" } },
  structure: { atom_count: 9, cell_generated: true, cell_padding_angstrom: 5 },
  method: { id: "mace_off", label: "MACE-OFF" },
};

describe("run folder manifest", () => {
  it("restores calculator, ensemble, steps, runs, seed and name", () => {
    const imported = manifestImport(JSON.stringify(manifest));
    expect(imported).not.toBeNull();
    expect(imported?.setup).toMatchObject({
      runner: "mace_off",
      ensemble: "NVE",
      steps: 10,
      random_seed: 4242,
      file_prefix: "human-ethanol",
    });
    // A field stripped for NVE falls back to the form default.
    expect(imported?.setup.thermostat).toBe(INITIAL_SETUP.thermostat);
    expect(imported?.setup).not.toHaveProperty("future_field");
    expect(imported?.samplingRunCount).toBe(3);
    expect(imported?.equilibration?.steps).toBe(200);
    expect(imported?.structureName).toBe("ethanol.rst");
    expect(imported?.cellGenerated).toBe(true);
    expect(imported?.setupFiles).toEqual([
      { role: "moldescriptor", name: "moldescriptor.dat" },
    ]);
    expect(imported && manifestSummary(imported)).toBe(
      "MACE-OFF · NVE · 10 steps × 0.5 fs · 3 runs · equilibration on · seed 4242 · name human-ethanol",
    );
  });

  it("reads a single-input manifest without a plan", () => {
    const imported = manifestImport(
      JSON.stringify({
        schema_version: 1,
        setup: { ...INITIAL_SETUP, steps: 50 },
      }),
    );
    expect(imported?.setup.steps).toBe(50);
    expect(imported?.samplingRunCount).toBe(1);
    expect(imported?.equilibration).toBeNull();
  });

  it("rejects files that are not a manifest", () => {
    expect(manifestImport("[]")).toBeNull();
    expect(manifestImport("{")).toBeNull();
    expect(manifestImport(JSON.stringify({ plan: {} }))).toBeNull();
  });
});
