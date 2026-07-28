import { describe, expect, it } from "vitest";
import {
  clampSamplingRunCount,
  commitContinuedSamplingRunCountDraft,
  compactRunFileNames,
  nextPlannedInputSelection,
  parseContinuedSamplingRunCountDraft,
  plannedInputOptionLabel,
  samplingLabel,
  samplingOutputMode,
  samplingRunCountForMode,
  samplingRunSummary,
} from "./runPlan";
import type { PlannedInput } from "./types";

describe("run plan labels", () => {
  it("keeps sampling numbering independent from equilibration", () => {
    expect(compactRunFileNames(true, 2)).toEqual([
      "run-eq.in",
      "run-01.in",
      "run-02.in",
    ]);
  });

  it("compacts long continued runs", () => {
    expect(compactRunFileNames(false, 12)).toEqual([
      "run-01.in",
      "run-02.in",
      "…",
      "run-12.in",
    ]);
  });

  it("clamps counts and pads labels", () => {
    expect(clampSamplingRunCount(0)).toBe(1);
    expect(clampSamplingRunCount(120)).toBe(120);
    expect(clampSamplingRunCount(1000)).toBe(999);
    expect(samplingLabel(7)).toBe("07");
    expect(samplingLabel(100)).toBe("100");
  });

  it("keeps continued input counts between 2 and 999", () => {
    expect(parseContinuedSamplingRunCountDraft("")).toBeNull();
    expect(parseContinuedSamplingRunCountDraft("1")).toBeNull();
    expect(parseContinuedSamplingRunCountDraft("12")).toBe(12);
    expect(parseContinuedSamplingRunCountDraft("100")).toBe(100);
    expect(parseContinuedSamplingRunCountDraft("1000")).toBeNull();
    expect(commitContinuedSamplingRunCountDraft("", 12)).toBe(12);
    expect(commitContinuedSamplingRunCountDraft("1", 12)).toBe(2);
    expect(commitContinuedSamplingRunCountDraft("1000", 12)).toBe(999);
  });

  it("maps the visible output choice to the backend file count", () => {
    expect(samplingOutputMode(1)).toBe("single");
    expect(samplingOutputMode(3)).toBe("continued");
    expect(samplingRunCountForMode("single", 8)).toBe(1);
    expect(samplingRunCountForMode("continued")).toBe(3);
    expect(samplingRunCountForMode("continued", 8)).toBe(8);
  });

  it("describes which sampling inputs are continuations", () => {
    expect(samplingRunSummary(1, false)).toBe("1 sampling file");
    expect(samplingRunSummary(3, false)).toBe(
      "3 sampling files · 02–03 continued",
    );
    expect(samplingRunSummary(1, true)).toBe("1 sampling file · from eq");
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
