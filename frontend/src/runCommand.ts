import type { PQStatus } from "./types";

export interface PackageRunLauncher {
  command: string;
  detail: string;
}

function shellArgument(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function packageRunLauncher(
  status: PQStatus | null,
): PackageRunLauncher {
  if (status?.found && status.executable) {
    return {
      command: `./run.sh ${shellArgument(status.executable)}`,
      detail: `Detected ${status.version ?? "PQ"}`,
    };
  }
  return {
    command: "./run.sh /path/to/PQ",
    detail: "PQ not detected · replace the path below",
  };
}
