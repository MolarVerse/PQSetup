import type {
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

export function activeSetupFiles(
  mode: MMForceFieldMode,
  files: SetupFile[],
): SetupFile[] {
  const roles = new Set(setupFileSpecs(mode).map((spec) => spec.role));
  return files.filter((file) => roles.has(file.role));
}

export function missingSetupFileRoles(
  mode: MMForceFieldMode,
  files: SetupFile[],
): SetupFileRole[] {
  const populated = new Set(
    files
      .filter((file) => file.name.trim() && file.content.length > 0)
      .map((file) => file.role),
  );
  return setupFileSpecs(mode)
    .filter((spec) => !spec.optional && !populated.has(spec.role))
    .map((spec) => spec.role);
}

export function defaultSetupFileName(role: SetupFileRole): string {
  return FILE_SPECS[role].defaultName;
}
