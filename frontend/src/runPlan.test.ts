import { describe, expect, it } from "vitest";
import {
  clampSamplingRunCount,
  commitSamplingRunCountDraft,
  compactRunFileNames,
  parseSamplingRunCountDraft,
  samplingLabel,
  samplingRunSummary,
} from "./runPlan";

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
    expect(clampSamplingRunCount(120)).toBe(99);
    expect(samplingLabel(7)).toBe("07");
  });

  it("allows an empty draft while a sampling count is edited", () => {
    expect(parseSamplingRunCountDraft("")).toBeNull();
    expect(parseSamplingRunCountDraft("12")).toBe(12);
    expect(parseSamplingRunCountDraft("100")).toBeNull();
    expect(commitSamplingRunCountDraft("", 12)).toBe(12);
    expect(commitSamplingRunCountDraft("100", 12)).toBe(99);
  });

  it("describes which sampling inputs are continuations", () => {
    expect(samplingRunSummary(1, false)).toBe("1 sampling file");
    expect(samplingRunSummary(3, false)).toBe(
      "3 sampling files · 02–03 continued",
    );
    expect(samplingRunSummary(1, true)).toBe("1 sampling file · from eq");
  });
});
