import {
  Box,
  Focus,
  Move3d,
  Rotate3d,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ChemicalFormula from "./ChemicalFormula";
import type { Atom, StructureAnalysis } from "./types";

interface StructureViewerProps {
  analysis: StructureAnalysis;
  example: boolean;
  generatedCellTreatment: "padding" | "density";
  densityGcm3: number | null;
}

type Point3 = [number, number, number];
type ViewPreset = "free" | "xy" | "xz" | "yz";

const ELEMENT_COLORS: Record<string, string> = {
  H: "#f7f7f4",
  C: "#4b5560",
  N: "#315fbc",
  O: "#d94a42",
  F: "#55a65c",
  P: "#de8d31",
  S: "#d7b52f",
  Cl: "#4c9a59",
  Zn: "#6d79a8",
};

const ELEMENT_RADII: Record<string, number> = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Zn: 1.22,
};

function rotate(point: Point3, rotationX: number, rotationY: number): Point3 {
  const [x, y, z] = point;
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  return [x1, y * cosX - z1 * sinX, y * sinX + z1 * cosX];
}

function distance(left: Atom, right: Atom): number {
  return Math.hypot(
    left.position[0] - right.position[0],
    left.position[1] - right.position[1],
    left.position[2] - right.position[2],
  );
}

function cellCorners(cell: Point3[]): Point3[] {
  const [a, b, c] = cell;
  const corners: Point3[] = [];
  for (const i of [-0.5, 0.5]) {
    for (const j of [-0.5, 0.5]) {
      for (const k of [-0.5, 0.5]) {
        corners.push([
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]);
      }
    }
  }
  return corners;
}

const CELL_EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 4],
  [1, 3],
  [1, 5],
  [2, 3],
  [2, 6],
  [3, 7],
  [4, 5],
  [4, 6],
  [5, 7],
  [6, 7],
];

export default function StructureViewer({
  analysis,
  example,
  generatedCellTreatment,
  densityGcm3,
}: StructureViewerProps) {
  const [rotation, setRotation] = useState<[number, number]>([-0.42, 0.58]);
  const [zoom, setZoom] = useState(1);
  const [showGeneratedCell, setShowGeneratedCell] = useState(false);
  const stage = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; rx: number; ry: number } | null>(
    null,
  );

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      setZoom((value) =>
        Math.min(
          2.5,
          Math.max(0.45, value * (event.deltaY > 0 ? 0.9 : 1.1)),
        ),
      );
    }
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    setShowGeneratedCell(false);
  }, [analysis.structure, generatedCellTreatment]);

  const generatedCell = analysis.structure.cell_generated;
  const displayCell = Boolean(
    analysis.structure.cell && (!generatedCell || showGeneratedCell),
  );
  const padding = analysis.structure.cell_padding_angstrom ?? 6;

  const scene = useMemo(() => {
    const allAtoms = analysis.structure.atoms;
    const stride = Math.max(1, Math.ceil(allAtoms.length / 1200));
    const atoms = allAtoms
      .map((atom, index) => ({ atom, index }))
      .filter((_, index) => index % stride === 0);
    const points: Point3[] = atoms.map(({ atom }) => atom.position);
    const corners = displayCell && analysis.structure.cell
      ? cellCorners(analysis.structure.cell as Point3[])
      : [];
    const center: Point3 = displayCell && analysis.structure.cell
      ? [0, 0, 0]
      : points.length
        ? ([0, 1, 2].map((axis) => {
            const values = points.map((point) => point[axis]);
            return (Math.min(...values) + Math.max(...values)) / 2;
          }) as Point3)
        : [0, 0, 0];
    const centeredPoints = points.map(
      (point) =>
        point.map((value, axis) => value - center[axis]) as Point3,
    );
    const centeredCorners = corners.map(
      (point) =>
        point.map((value, axis) => value - center[axis]) as Point3,
    );
    const bounds = [...centeredPoints, ...centeredCorners];
    const radius = Math.max(
      1,
      ...bounds.map((point) => Math.hypot(point[0], point[1], point[2])),
    );
    const scale = (155 / radius) * zoom;
    const project = (point: Point3) => {
      const rotated = rotate(point, rotation[0], rotation[1]);
      return {
        x: 300 + rotated[0] * scale,
        y: 205 - rotated[1] * scale,
        z: rotated[2],
      };
    };
    const projectedAtoms = atoms
      .map(({ atom, index }, atomIndex) => ({
        atom,
        index,
        ...project(centeredPoints[atomIndex]),
      }))
      .sort((left, right) => left.z - right.z);
    const projectedCell = centeredCorners.map(project);
    const bonds: { left: number; right: number }[] = [];
    if (allAtoms.length <= 280) {
      for (let i = 0; i < allAtoms.length; i += 1) {
        for (let j = i + 1; j < allAtoms.length; j += 1) {
          const cutoff =
            1.2 *
            ((ELEMENT_RADII[allAtoms[i].symbol] ?? 0.8) +
              (ELEMENT_RADII[allAtoms[j].symbol] ?? 0.8));
          const separation = distance(allAtoms[i], allAtoms[j]);
          if (separation > 0.2 && separation <= cutoff) {
            bonds.push({ left: i, right: j });
          }
        }
      }
    }
    const positionMap = new Map(
      projectedAtoms.map((atom) => [atom.index, atom]),
    );
    return {
      atoms: projectedAtoms,
      bonds,
      positionMap,
      cell: projectedCell,
      sampled: stride > 1,
    };
  }, [analysis, displayCell, rotation, zoom]);

  const collisionAtoms = useMemo(
    () =>
      new Set(
        analysis.collisions.flatMap((collision) => [
          collision.atom_i,
          collision.atom_j,
        ]),
      ),
    [analysis.collisions],
  );

  function setPreset(preset: ViewPreset) {
    const rotations: Record<ViewPreset, [number, number]> = {
      free: [-0.42, 0.58],
      xy: [0, 0],
      xz: [Math.PI / 2, 0],
      yz: [0, Math.PI / 2],
    };
    setRotation(rotations[preset]);
    setZoom(1);
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      rx: rotation[0],
      ry: rotation[1],
    };
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    setRotation([
      drag.current.rx + (event.clientY - drag.current.y) * 0.008,
      drag.current.ry + (event.clientX - drag.current.x) * 0.008,
    ]);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
  }

  return (
    <section className="viewer" aria-labelledby="viewer-title">
      <div className="viewer-heading">
        <div>
          <div className="eyebrow">
            {example ? "Example" : analysis.structure.source_format ?? "Structure"}
          </div>
          <h2 id="viewer-title">
            {analysis.structure.source_name ?? "Untitled structure"}
          </h2>
        </div>
        <div className="viewer-count">
          {analysis.summary.atom_count.toLocaleString()} atoms
        </div>
      </div>

      <div className="viewer-stage">
        <svg
          ref={stage}
          viewBox="0 0 600 420"
          role="img"
          aria-label={`Interactive view of ${
            analysis.summary.formula || "the structure"
          }${
            generatedCell
              ? `. Generated cell ${showGeneratedCell ? "shown" : "hidden"}`
              : ""
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <rect width="600" height="420" className="viewer-background" />
          {scene.cell.length === 8 &&
            CELL_EDGES.map(([left, right]) => (
              <line
                key={`cell-${left}-${right}`}
                x1={scene.cell[left].x}
                y1={scene.cell[left].y}
                x2={scene.cell[right].x}
                y2={scene.cell[right].y}
                className={`cell-edge ${
                  generatedCell ? "generated-cell-edge" : ""
                }`}
              />
            ))}
          {scene.bonds.map(({ left, right }) => {
            const start = scene.positionMap.get(left);
            const end = scene.positionMap.get(right);
            if (!start || !end) return null;
            return (
              <line
                key={`bond-${left}-${right}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                className="bond"
              />
            );
          })}
          {analysis.collisions.map((collision) => {
            const start = scene.positionMap.get(collision.atom_i);
            const end = scene.positionMap.get(collision.atom_j);
            if (!start || !end) return null;
            return (
              <line
                key={`collision-${collision.atom_i}-${collision.atom_j}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                className="collision-link"
              />
            );
          })}
          {scene.atoms.map(({ atom, index, x, y, z }) => {
            const depth = Math.max(0.72, Math.min(1.22, 1 + z * 0.012));
            const radius =
              Math.max(
                8,
                Math.min(18, (ELEMENT_RADII[atom.symbol] ?? 0.8) * 14),
              ) *
              depth;
            return (
              <g key={`atom-${index}`}>
                {collisionAtoms.has(index) && (
                  <circle
                    cx={x}
                    cy={y}
                    r={radius + 5}
                    className="collision-halo"
                  />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={ELEMENT_COLORS[atom.symbol] ?? "#8c6db0"}
                  className={`atom ${atom.symbol === "H" ? "atom-light" : ""}`}
                />
              </g>
            );
          })}
          <g className="axis" transform="translate(42 368)">
            <line x1="0" y1="0" x2="28" y2="0" className="axis-x" />
            <line x1="0" y1="0" x2="0" y2="-28" className="axis-y" />
            <line x1="0" y1="0" x2="16" y2="16" className="axis-z" />
            <text x="33" y="4">x</text>
            <text x="-4" y="-34">y</text>
            <text x="19" y="25">z</text>
          </g>
        </svg>
        <div className="viewer-help">
          <Move3d size={14} aria-hidden="true" />
          Drag to rotate · Scroll to zoom
        </div>
        {scene.sampled && (
          <div className="sample-label">Preview sampled for speed</div>
        )}
        {generatedCell && showGeneratedCell && (
          <div className="generated-cell-label">Generated preview box</div>
        )}
      </div>

      <div className="view-controls" aria-label="View orientation">
        <button type="button" onClick={() => setPreset("free")}>
          <Rotate3d size={15} aria-hidden="true" />
          3D
        </button>
        <button type="button" onClick={() => setPreset("xy")}>XY</button>
        <button type="button" onClick={() => setPreset("xz")}>XZ</button>
        <button type="button" onClick={() => setPreset("yz")}>YZ</button>
        <button
          type="button"
          className="fit-view"
          onClick={() => {
            setZoom(1);
            setRotation((value) => [...value]);
          }}
        >
          <Focus size={15} aria-hidden="true" />
          Fit
        </button>
      </div>

      {generatedCell && (
        <div className="generated-cell-note">
          <span>
            <strong>No periodic cell in source</strong>
            <small>
              {generatedCellTreatment === "density"
                ? densityGcm3
                  ? `PQ derives the run cell from ${densityGcm3} g cm⁻³. The optional box is a ${padding} Å preview envelope.`
                  : `PQ derives the run cell from density. The optional box is a ${padding} Å preview envelope.`
                : `PQSetup adds a centered run cell with ${padding} Å padding. The uploaded file is unchanged.`}
            </small>
          </span>
          <button
            type="button"
            aria-pressed={showGeneratedCell}
            onClick={() => setShowGeneratedCell((value) => !value)}
          >
            <Box size={14} aria-hidden="true" />
            {showGeneratedCell ? "Hide box" : "Show box"}
          </button>
        </div>
      )}

      <dl className="structure-facts">
        <div>
          <dt>Formula</dt>
          <dd>
            <ChemicalFormula formula={analysis.summary.formula} />
          </dd>
        </div>
        <div>
          <dt>Cell</dt>
          <dd>
            {analysis.structure.cell ? (
              <>
                <Box size={14} aria-hidden="true" />
                {generatedCell
                  ? generatedCellTreatment === "density"
                    ? "Density-derived"
                    : "Generated"
                  : "Imported"}
              </>
            ) : (
              "None"
            )}
          </dd>
        </div>
        <div>
          <dt>Min. distance</dt>
          <dd>
            {analysis.summary.minimum_distance_angstrom == null
              ? "—"
              : `${analysis.summary.minimum_distance_angstrom.toFixed(3)} Å`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
