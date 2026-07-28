import { describe, expect, it } from "vitest";
import { packageRunLauncher } from "./runCommand";
import type { PQStatus } from "./types";

function status(executable: string | null, found = true): PQStatus {
  return {
    found,
    executable,
    version: "v0.6.4",
    source: "development",
    detail: "PQ is ready.",
    external_qm: null,
    validation_available: true,
    validation_scopes: ["portable", "installed"],
  };
}

describe("package run command", () => {
  it("uses the detected PQ executable", () => {
    expect(packageRunLauncher(status("/opt/pq/bin/PQ"))).toEqual({
      command: "./run.sh /opt/pq/bin/PQ",
      detail: "Detected v0.6.4",
    });
  });

  it("quotes executable paths for the shell", () => {
    expect(packageRunLauncher(status("/Users/Ada's Tools/PQ")).command).toBe(
      "./run.sh '/Users/Ada'\"'\"'s Tools/PQ'",
    );
    expect(
      packageRunLauncher(status("/tmp/$(touch BAD);/PQ")).command,
    ).toBe("./run.sh '/tmp/$(touch BAD);/PQ'");
  });

  it("keeps the placeholder command and status aligned", () => {
    const unavailable = {
      command: "./run.sh /path/to/PQ",
      detail: "PQ not detected · replace the path below",
    };
    expect(packageRunLauncher(status(null, false))).toEqual(unavailable);
    expect(packageRunLauncher(status(null))).toEqual(unavailable);
    expect(packageRunLauncher(null)).toEqual(unavailable);
  });
});
