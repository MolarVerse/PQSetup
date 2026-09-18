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
        defaultOpen
      />,
    );

    expect(markup).not.toContain('class="cell-edge');
    expect(markup).toContain('title="Preview box"');
    expect(markup).not.toContain("No cell");
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
        defaultOpen
      />,
    );

    expect(
      [...markup.matchAll(new RegExp('class="cell-edge', "g"))],
    ).toHaveLength(12);
    expect(markup).not.toContain('title="Preview box"');
  });

  it("offers a box toggle for density-derived molecular-mechanics cells", () => {
    const markup = renderToStaticMarkup(
      <StructureViewer
        analysis={ANALYSIS}
        defaultOpen
      />,
    );

    expect(markup).toContain('title="Preview box"');
  });

  it("renders stage variant without collapse controls", () => {
    const markup = renderToStaticMarkup(
      <StructureViewer
        analysis={ANALYSIS}
        variant="stage"
        defaultOpen
      />,
    );

    expect(markup).toContain('class="viewer-stage');
    expect(markup).not.toContain("Show structure");
    expect(markup).not.toContain('class="viewer-resize');
    expect(markup).not.toContain('class="viewer-toggle');
  });

  it("stays collapsed by default and keeps the summary header", () => {
    const markup = renderToStaticMarkup(
      <StructureViewer
        analysis={ANALYSIS}
        defaultOpen={false}
      />,
    );

    expect(markup).toContain("Show structure");
    expect(markup).toContain("viewer-collapsed");
    expect(markup).not.toContain('class="viewer-stage');
    expect(markup).toContain("H2O");
  });
});
