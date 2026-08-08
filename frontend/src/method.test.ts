import { describe, expect, it } from "vitest";
import {
  activeSetupFiles,
  defaultSetupFileName,
  electronicMethodOptions,
  missingSetupFileRoles,
  mmModeLabel,
  packagedSetupFileName,
  preferredRunner,
  qmSetupFileSpecs,
  recommendedRunnerScript,
  selectedExternalQMScript,
  setupFileSpecs,
} from "./method";
import type {
  ExternalQMCapabilities,
  RunnerStatus,
  SetupFile,
} from "./types";

const files: SetupFile[] = [
  { role: "moldescriptor", name: "molecules.dat", content: "water" },
  { role: "guff", name: "guff.dat", content: "guff" },
  { role: "topology", name: "topology.dat", content: "topology" },
  { role: "parameter", name: "parameter.dat", content: "parameters" },
  { role: "intra_nonbonded", name: "intra.dat", content: "pairs" },
];

function runner(
  id: string,
  availableInPQ: boolean | null,
  ready = true,
): RunnerStatus {
  return {
    id,
    label: id,
    supported: true,
    installed: ready,
    ready,
    executable: null,
    version: null,
    available_in_pq: availableInPQ,
    detail: ready ? "Detected." : "Not detected.",
  };
}

describe("calculator preference", () => {
  it("does not default to a method missing from the selected PQ build", () => {
    expect(
      preferredRunner([
        runner("ase_xtb", false),
        runner("dftbplus", true),
      ])?.id,
    ).toBe("dftbplus");
    expect(
      preferredRunner([
        runner("ase_xtb", null),
        runner("dftbplus", null),
      ])?.id,
    ).toBe("ase_xtb");
  });
});

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

describe("QM companion files", () => {
  it("requests only files required by the selected setup", () => {
    expect(qmSetupFileSpecs("ase_xtb", "NVT")).toEqual([]);
    expect(qmSetupFileSpecs("ase_xtb", "NPT").map((file) => file.role)).toEqual(
      ["moldescriptor"],
    );
    expect(
      qmSetupFileSpecs("dftbplus", "NPT").map((file) => file.role),
    ).toEqual(["moldescriptor", "dftb_template"]);
    expect(defaultSetupFileName("dftb_template")).toBe("dftb_in.template");
  });

  it("requires an explicit PySCF method without installed capabilities", () => {
    expect(recommendedRunnerScript(null, "pyscf")).toBeNull();
    expect(selectedExternalQMScript(null, "pyscf", null)).toBeNull();
    expect(
      selectedExternalQMScript(null, "pyscf", "pyscf_hf.py")?.name,
    ).toBe("pyscf_hf.py");
  });

  it("uses advertised scripts, labels, and dependencies", () => {
    const capabilities: ExternalQMCapabilities = {
      script_mode: "bundled_or_full_path",
      programs: {
        pyscf: {
          recommended_script: null,
          scripts: [
            {
              name: "pyscf_hf.py",
              label: "UHF / STO-3G",
              required_file_keywords: [],
              required_working_files: [],
            },
            {
              name: "pyscf_mp2.py",
              label: "UMP2 / 6-311++G**",
              required_file_keywords: [],
              required_working_files: [],
            },
          ],
        },
        turbomole: {
          recommended_script: "turbomole_rimp2",
          scripts: [
            {
              name: "turbomole_rimp2",
              label: "RI-MP2",
              required_file_keywords: [],
              required_working_files: ["tm_define.template"],
            },
          ],
        },
      },
    };

    expect(
      electronicMethodOptions(capabilities, "pyscf").map(
        (method) => method.label,
      ),
    ).toEqual(["UHF / STO-3G", "UMP2 / 6-311++G**"]);
    expect(recommendedRunnerScript(capabilities, "pyscf")).toBeNull();
    expect(selectedExternalQMScript(capabilities, "pyscf", null)).toBeNull();
    expect(
      qmSetupFileSpecs(
        "turbomole",
        "NVT",
        "turbomole_rimp2",
        capabilities,
      ).map((file) => file.role),
    ).toEqual(["turbomole_define_template"]);
    expect(defaultSetupFileName("turbomole_define_template")).toBe(
      "tm_define.template",
    );
    expect(
      packagedSetupFileName(
        "turbomole_define_template",
        "custom-template.in",
      ),
    ).toBe("tm_define.template");
    expect(packagedSetupFileName("dftb_template", "custom-template.in")).toBe(
      "custom-template.in",
    );
  });
});
