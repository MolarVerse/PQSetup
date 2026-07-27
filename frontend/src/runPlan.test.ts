import { describe, expect, it } from "vitest";
import {
  clampSamplingRunCount,
  commitContinuedSamplingRunCountDraft,
  compactRunFileNames,
  parseContinuedSamplingRunCountDraft,
  samplingLabel,
  samplingOutputMode,
  samplingRunCountForMode,
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

  it("keeps continued input counts between 2 and 99", () => {
    expect(parseContinuedSamplingRunCountDraft("")).toBeNull();
    expect(parseContinuedSamplingRunCountDraft("1")).toBeNull();
    expect(parseContinuedSamplingRunCountDraft("12")).toBe(12);
    expect(parseContinuedSamplingRunCountDraft("100")).toBeNull();
    expect(commitContinuedSamplingRunCountDraft("", 12)).toBe(12);
    expect(commitContinuedSamplingRunCountDraft("1", 12)).toBe(2);
    expect(commitContinuedSamplingRunCountDraft("100", 12)).toBe(99);
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
});
