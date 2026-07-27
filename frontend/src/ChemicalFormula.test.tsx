import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ChemicalFormula from "./ChemicalFormula";

describe("ChemicalFormula", () => {
  it("renders numeric counts as subscripts", () => {
    const markup = renderToStaticMarkup(<ChemicalFormula formula="C6H12O6" />);

    expect(markup).toContain("<sub");
    expect(markup).toContain(">12</sub>");
    expect(markup).toContain('aria-label="C6H12O6"');
  });

  it("uses the fallback for an empty formula", () => {
    expect(
      renderToStaticMarkup(<ChemicalFormula formula="" fallback="Unknown" />),
    ).toBe("Unknown");
  });
});
