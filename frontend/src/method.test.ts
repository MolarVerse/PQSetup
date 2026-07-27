import { describe, expect, it } from "vitest";
import {
  activeSetupFiles,
  defaultSetupFileName,
  missingSetupFileRoles,
  mmModeLabel,
  setupFileSpecs,
} from "./method";
import type { SetupFile } from "./types";

const files: SetupFile[] = [
  { role: "moldescriptor", name: "molecules.dat", content: "water" },
  { role: "guff", name: "guff.dat", content: "guff" },
  { role: "topology", name: "topology.dat", content: "topology" },
  { role: "parameter", name: "parameter.dat", content: "parameters" },
  { role: "intra_nonbonded", name: "intra.dat", content: "pairs" },
];

describe("molecular mechanics method", () => {
  it("exposes only files used by each force-field mode", () => {
    expect(setupFileSpecs("off").map((file) => file.role)).toEqual([
      "moldescriptor",
      "guff",
    ]);
    expect(setupFileSpecs("bonded").map((file) => file.role)).toEqual([
      "moldescriptor",
      "guff",
      "topology",
      "parameter",
      "intra_nonbonded",
    ]);
    expect(setupFileSpecs("on").map((file) => file.role)).toEqual([
      "moldescriptor",
      "topology",
      "parameter",
      "intra_nonbonded",
    ]);
  });

  it("keeps optional intramolecular data out of readiness", () => {
    expect(missingSetupFileRoles("on", files.slice(0, 1))).toEqual([
      "topology",
      "parameter",
    ]);
    expect(missingSetupFileRoles("on", files)).toEqual([]);
  });

  it("filters stale files when a mode changes", () => {
    expect(activeSetupFiles("off", files).map((file) => file.role)).toEqual([
      "moldescriptor",
      "guff",
    ]);
  });

  it("provides stable scientific labels and filenames", () => {
    expect(mmModeLabel("bonded")).toBe("Bonded + GUFF");
    expect(defaultSetupFileName("moldescriptor")).toBe("moldescriptor.dat");
  });
});
