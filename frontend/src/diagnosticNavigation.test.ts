import { describe, expect, it } from "vitest";
import { diagnosticStep } from "./diagnosticNavigation";

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
});
