import { describe, expect, it } from "vitest";
import { compactInputPreview } from "./inputPreview";

describe("compactInputPreview", () => {
  it("opens generated inputs at the first setting without renumbering it", () => {
    const input = [
      "# decorative title",
      "# run details",
      "",
      "# dynamics",
      "jobtype = qm-md;",
      "nstep = 1000;",
    ].join("\n");
    expect(compactInputPreview(input, false)).toEqual({
      text: "# dynamics\njobtype = qm-md;\nnstep = 1000;",
      firstLine: 4,
      headerHidden: true,
    });
    expect(compactInputPreview(input, true)).toEqual({
      text: input,
      firstLine: 1,
      headerHidden: false,
    });
  });

  it("preserves diagnostic text without a generated input", () => {
    expect(compactInputPreview("A QM calculator must be selected.", false)).toEqual({
      text: "A QM calculator must be selected.",
      firstLine: 1,
      headerHidden: false,
    });
  });
});
