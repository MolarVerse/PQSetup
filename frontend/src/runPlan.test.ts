import { describe, expect, it } from "vitest";
import {
  clampSamplingRunCount,
  commitSamplingRunCountDraft,
  nextPlannedInputSelection,
  parseSamplingRunCountDraft,
  plannedInputOptionLabel,
  samplingLabel,
} from "./runPlan";
import type { PlannedInput } from "./types";

describe("run plan labels", () => {
  it("clamps counts and pads labels", () => {
    expect(clampSamplingRunCount(0)).toBe(1);
    expect(clampSamplingRunCount(120)).toBe(120);
    expect(clampSamplingRunCount(1000)).toBe(999);
    expect(samplingLabel(7)).toBe("07");
    expect(samplingLabel(100)).toBe("100");
  });

  it("parses and commits the sampling count used by the editor", () => {
    expect(parseSamplingRunCountDraft("")).toBeNull();
    expect(parseSamplingRunCountDraft("12")).toBe(12);
    expect(parseSamplingRunCountDraft("1000")).toBeNull();
    expect(commitSamplingRunCountDraft("", 12)).toBe(12);
    expect(commitSamplingRunCountDraft("1", 12)).toBe(1);
    expect(commitSamplingRunCountDraft("1000", 12)).toBe(999);
  });

  it("labels equilibration and large sampling plans for a file selector", () => {
    const shared = {
      stage_index: 1,
      stage_count: 100,
      calculator_id: "molecular_mechanics",
      calculator_label: "Molecular mechanics · GUFF",
      input_text: "",
      start_file: "structure.rst",
      restart_file: "run.rst",
    };
    const equilibration = {
      ...shared,
      name: "run-eq.in",
      stage_id: "equilibration",
      stage_label: "NVT equilibration",
      segment_index: null,
      segment_count: null,
    } satisfies PlannedInput;
    const sampling = {
      ...shared,
      name: "run-100.in",
      stage_id: "sampling",
      stage_label: "Sampling 100",
      segment_index: 100,
      segment_count: 100,
    } satisfies PlannedInput;

    expect(plannedInputOptionLabel(equilibration, 100)).toBe(
      "eq · run-eq.in — Equilibration",
    );
    expect(plannedInputOptionLabel(sampling, 100)).toBe(
      "100 · run-100.in — Sampling 100 of 100",
    );

    expect(
      nextPlannedInputSelection(
        "run-01.in",
        "run-01.in",
        [equilibration, sampling],
      ),
    ).toBe("run-eq.in");
    expect(
      nextPlannedInputSelection(
        "run-100.in",
        "run-eq.in",
        [equilibration, sampling],
      ),
    ).toBe("run-100.in");
    expect(
      nextPlannedInputSelection(
        "run-98.in",
        "run-eq.in",
        [equilibration, sampling],
      ),
    ).toBe("run-eq.in");
  });
});
