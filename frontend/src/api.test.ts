import { describe, expect, it } from "vitest";
import { errorDetail } from "./api";

describe("API error details", () => {
  it("reads validation and scientific diagnostic messages", () => {
    expect(errorDetail([{ msg: "Invalid value." }], "Fallback")).toBe(
      "Invalid value.",
    );
    expect(
      errorDetail(
        [{ message: "Coulomb cutoff exceeds half the box length." }],
        "Fallback",
      ),
    ).toBe("Coulomb cutoff exceeds half the box length.");
    expect(
      errorDetail(
        [
          {
            message: "nstep must be at least 1",
            file: "run-01.in",
            line: 17,
          },
        ],
        "Fallback",
      ),
    ).toBe("nstep must be at least 1 · run-01.in:17");
  });
});
