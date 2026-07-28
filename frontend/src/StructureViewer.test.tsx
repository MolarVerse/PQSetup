import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StructureViewer from "./StructureViewer";
import type { StructureAnalysis } from "./types";

const ANALYSIS: StructureAnalysis = {
  structure: {
    atoms: [
      {
        symbol: "O",
        position: [0, 0, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
      {
        symbol: "H",
        position: [0.96, 0, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
      {
        symbol: "H",
        position: [-0.24, 0.93, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
    ],
    cell: [
      [12, 0, 0],
      [0, 12, 0],
      [0, 0, 12],
    ],
    periodic: [true, true, true],
    source_name: "water.xyz",
    source_format: "xyz",
    wrapped_centered: true,
    cell_generated: true,
    cell_padding_angstrom: 6,
  },
  summary: {
    atom_count: 3,
    formula: "H2O",
    volume_angstrom3: 1728,
    density_g_cm3: null,
    minimum_distance_angstrom: 0.96,
  },
  diagnostics: [],
  collisions: [],
  collisions_truncated: false,
  valid: true,
};

describe("StructureViewer cell presentation", () => {
  it("keeps a generated run cell hidden until requested", () => {
    const markup = renderToStaticMarkup(
      <StructureViewer
        analysis={ANALYSIS}
        example={false}
        generatedCellTreatment="padding"
        densityGcm3={null}
      />,
    );

    expect(markup).not.toContain('class="cell-edge');
    expect(markup).toContain("No periodic cell in source");
    expect(markup).toContain(
      "PQSetup adds a centered run cell with 6 Å padding.",
    );
    expect(markup).toContain("Show box");
    expect(markup).toContain("Generated");
  });

  it("shows an imported physical cell without an extra control", () => {
    const physicalAnalysis: StructureAnalysis = {
      ...ANALYSIS,
      structure: {
        ...ANALYSIS.structure,
        source_name: "water.rst",
        source_format: "pq-restart",
        cell_generated: false,
        cell_padding_angstrom: null,
      },
    };
    const markup = renderToStaticMarkup(
      <StructureViewer
        analysis={physicalAnalysis}
        example={false}
        generatedCellTreatment="padding"
        densityGcm3={null}
      />,
    );

    expect(markup.match(/class="cell-edge/g)).toHaveLength(12);
    expect(markup).toContain("Imported");
    expect(markup).not.toContain("Show box");
  });

  it("explains density-derived molecular-mechanics cells", () => {
    const markup = renderToStaticMarkup(
      <StructureViewer
        analysis={ANALYSIS}
        example={false}
        generatedCellTreatment="density"
        densityGcm3={1}
      />,
    );

    expect(markup).toContain("PQ derives the run cell from 1 g cm⁻³.");
    expect(markup).toContain("Density-derived");
  });
});
