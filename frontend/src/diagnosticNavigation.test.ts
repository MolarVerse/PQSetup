import { describe, expect, it } from "vitest";
import { diagnosticControl, diagnosticStep } from "./diagnosticNavigation";

describe("diagnostic navigation", () => {
  it("routes structure and cell checks to System", () => {
    expect(diagnosticStep("structure.short_contacts")).toBe("system");
    expect(diagnosticStep("cell.singular")).toBe("system");
  });

  it("routes method checks to Method and run checks to Conditions", () => {
    expect(diagnosticStep("mm.density")).toBe("method");
    expect(diagnosticStep("qm.file_missing.turbomole_define_template")).toBe(
      "method",
    );
    expect(diagnosticStep("runner.missing")).toBe("method");
    expect(diagnosticStep("environment.pq_method_unavailable")).toBe("method");
    expect(diagnosticStep("conditions.generated_cell_npt")).toBe("conditions");
  });

  it("sends run-name and seed problems to where those fields live", () => {
    expect(diagnosticStep("input.file_prefix")).toBe("review");
    expect(diagnosticControl("input.file_prefix")).toBe("run-name");
    expect(diagnosticStep("input.start_file")).toBe("system");
    expect(diagnosticStep("run.random_seed")).toBe("system");
    expect(diagnosticControl("run.random_seed")).toBe("position-seed");
  });

  it("sends companion files and advanced keywords to Method", () => {
    expect(diagnosticStep("qm.file_missing.moldescriptor")).toBe("method");
    expect(diagnosticStep("qm.moldescriptor_file")).toBe("method");
    expect(diagnosticStep("qm.file_missing.dftb_template")).toBe("method");
    expect(diagnosticStep("mm.mshake_file")).toBe("method");
    expect(diagnosticStep("input.extra_value")).toBe("method");
    expect(diagnosticStep("input.extra_scope")).toBe("method");
    expect(diagnosticStep("input.syntax")).toBe("review");
  });
});
