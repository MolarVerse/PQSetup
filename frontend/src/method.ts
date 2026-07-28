import type {
  Ensemble,
  ExternalQMCapabilities,
  ExternalQMProgram,
  ExternalQMScript,
  MMForceFieldMode,
  SetupFile,
  SetupFileRole,
} from "./types";

export interface MMModeOption {
  value: MMForceFieldMode;
  label: string;
  description: string;
}

export interface SetupFileSpec {
  role: SetupFileRole;
  label: string;
  defaultName: string;
  optional: boolean;
}

export const MM_MODES: MMModeOption[] = [
  {
    value: "off",
    label: "GUFF",
    description: "Nonbonded interactions from a GUFF table.",
  },
  {
    value: "bonded",
    label: "Bonded + GUFF",
    description: "Bonded terms from topology and parameters; GUFF nonbonded terms.",
  },
  {
    value: "on",
    label: "Classical force field",
    description: "All interactions from topology and parameter files.",
  },
];

const FILE_SPECS: Record<SetupFileRole, Omit<SetupFileSpec, "optional">> = {
  moldescriptor: {
    role: "moldescriptor",
    label: "Molecule descriptor",
    defaultName: "moldescriptor.dat",
  },
  guff: {
    role: "guff",
    label: "GUFF table",
    defaultName: "guff.dat",
  },
  topology: {
    role: "topology",
    label: "Topology",
    defaultName: "topology.dat",
  },
  parameter: {
    role: "parameter",
    label: "Parameters",
    defaultName: "parameter.dat",
  },
  intra_nonbonded: {
    role: "intra_nonbonded",
    label: "Intramolecular nonbonded",
    defaultName: "intra-nonbonded.dat",
  },
  dftb_template: {
    role: "dftb_template",
    label: "DFTB+ template",
    defaultName: "dftb_in.template",
  },
  turbomole_define_template: {
    role: "turbomole_define_template",
    label: "Turbomole define template",
    defaultName: "tm_define.template",
  },
};

const FALLBACK_EXTERNAL_QM: ExternalQMCapabilities = {
  script_mode: "bundled_or_full_path",
  programs: {
    dftbplus: {
      recommended_script: "dftbplus_periodic_stress",
      scripts: [
        {
          name: "dftbplus_periodic_stress",
          label: "DFTB+ periodic stress",
          required_file_keywords: ["dftb_file"],
          required_working_files: [],
        },
      ],
    },
    pyscf: {
      recommended_script: "pyscf_hf.py",
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

const FILE_KEYWORD_ROLES: Record<string, SetupFileRole> = {
  dftb_file: "dftb_template",
};

const WORKING_FILE_ROLES: Record<string, SetupFileRole> = {
  "tm_define.template": "turbomole_define_template",
};

const FIXED_SETUP_FILE_NAMES: Partial<Record<SetupFileRole, string>> = {
  turbomole_define_template: "tm_define.template",
};

export function mmModeLabel(mode: MMForceFieldMode): string {
  return MM_MODES.find((option) => option.value === mode)?.label ?? "GUFF";
}

export function setupFileSpecs(mode: MMForceFieldMode): SetupFileSpec[] {
  const required: SetupFileRole[] =
    mode === "off"
      ? ["moldescriptor", "guff"]
      : mode === "bonded"
        ? ["moldescriptor", "guff", "topology", "parameter"]
        : ["moldescriptor", "topology", "parameter"];

  return [
    ...required.map((role) => ({ ...FILE_SPECS[role], optional: false })),
    ...(mode === "off"
      ? []
      : [{ ...FILE_SPECS.intra_nonbonded, optional: true }]),
  ];
}

export function qmSetupFileSpecs(
  runner: string | null,
  ensemble: Ensemble,
  runnerScript: string | null = null,
  externalQM: ExternalQMCapabilities | null = null,
): SetupFileSpec[] {
  const roles = new Set<SetupFileRole>();
  if (ensemble === "NPT") roles.add("moldescriptor");
  const script = selectedExternalQMScript(externalQM, runner, runnerScript);
  script?.required_file_keywords.forEach((dependency) => {
    const role = FILE_KEYWORD_ROLES[dependency];
    if (role) roles.add(role);
  });
  script?.required_working_files.forEach((dependency) => {
    const role = WORKING_FILE_ROLES[dependency];
    if (role) roles.add(role);
  });
  return [...roles].map((role) => ({ ...FILE_SPECS[role], optional: false }));
}

export function externalQMProgram(
  externalQM: ExternalQMCapabilities | null,
  runner: string | null,
): ExternalQMProgram | null {
  if (!runner) return null;
  const config = externalQM ?? FALLBACK_EXTERNAL_QM;
  return config.programs[runner] ?? null;
}

export function electronicMethodOptions(
  externalQM: ExternalQMCapabilities | null,
  runner: string | null,
): ExternalQMScript[] {
  return externalQMProgram(externalQM, runner)?.scripts ?? [];
}

export function recommendedRunnerScript(
  externalQM: ExternalQMCapabilities | null,
  runner: string | null,
): string | null {
  return externalQMProgram(externalQM, runner)?.recommended_script ?? null;
}

export function selectedExternalQMScript(
  externalQM: ExternalQMCapabilities | null,
  runner: string | null,
  runnerScript: string | null,
): ExternalQMScript | null {
  const program = externalQMProgram(externalQM, runner);
  const scriptName = runnerScript ?? program?.recommended_script;
  return (
    program?.scripts.find((script) => script.name === scriptName) ?? null
  );
}

export function activeSetupFiles(
  mode: MMForceFieldMode,
  files: SetupFile[],
): SetupFile[] {
  return activeFilesForSpecs(setupFileSpecs(mode), files);
}

export function activeFilesForSpecs(
  specs: SetupFileSpec[],
  files: SetupFile[],
): SetupFile[] {
  const roles = new Set(specs.map((spec) => spec.role));
  return files.filter((file) => roles.has(file.role));
}

export function missingSetupFileRoles(
  mode: MMForceFieldMode,
  files: SetupFile[],
): SetupFileRole[] {
  return missingFilesForSpecs(setupFileSpecs(mode), files);
}

export function missingFilesForSpecs(
  specs: SetupFileSpec[],
  files: SetupFile[],
): SetupFileRole[] {
  const populated = new Set(
    files
      .filter((file) => file.name.trim() && file.content.length > 0)
      .map((file) => file.role),
  );
  return specs
    .filter((spec) => !spec.optional && !populated.has(spec.role))
    .map((spec) => spec.role);
}

export function defaultSetupFileName(role: SetupFileRole): string {
  return FILE_SPECS[role].defaultName;
}

export function packagedSetupFileName(
  role: SetupFileRole,
  sourceName: string,
): string {
  return FIXED_SETUP_FILE_NAMES[role] ?? sourceName;
}
