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
  });
});
