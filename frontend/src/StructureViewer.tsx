import {
  Box,
  ChevronDown,
  ChevronRight,
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

const SHOW_STRUCTURE_KEY = "pqsetup.showStructure";
const VIEWER_HEIGHT_KEY = "pqsetup.viewerHeight";
const VIEWER_HEIGHT_DEFAULT = 280;
const VIEWER_HEIGHT_MIN = 140;
const VIEWER_HEIGHT_MAX = 640;

function readStoredShowStructure(): boolean {
  try {
    return window.localStorage.getItem(SHOW_STRUCTURE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredShowStructure(open: boolean) {
  try {
    window.localStorage.setItem(SHOW_STRUCTURE_KEY, open ? "1" : "0");
  } catch {
    /* private mode / blocked storage */
  }
}

function readStoredViewerHeight(): number {
  try {
    const raw = window.localStorage.getItem(VIEWER_HEIGHT_KEY);
    if (raw == null) return VIEWER_HEIGHT_DEFAULT;
    const value = Number(raw);
    if (!Number.isFinite(value)) return VIEWER_HEIGHT_DEFAULT;
    return Math.min(VIEWER_HEIGHT_MAX, Math.max(VIEWER_HEIGHT_MIN, value));
  } catch {
    return VIEWER_HEIGHT_DEFAULT;
  }
}

function writeStoredViewerHeight(height: number) {
  try {
    window.localStorage.setItem(VIEWER_HEIGHT_KEY, String(Math.round(height)));
  } catch {
    /* private mode / blocked storage */
  }
}

interface StructureViewerProps {
  analysis: StructureAnalysis;
  /** Bump after a successful import to auto-expand once per session. */
  importNonce?: number;
  /** Initial open state override (tests). */
  defaultOpen?: boolean;
  variant?: "inline" | "stage";
  /** Always-open inline canvas without its own heading (page embeds). */
  chromeless?: boolean;
}

type Point3 = [number, number, number];
type ViewPreset = "free" | "xy" | "xz" | "yz";

const ATOM_RADIUS_MIN = 3;
// viewBox units; small molecules fill the stage, so a tighter cap left
// them as dots on long sticks.
const ATOM_RADIUS_MAX = 34;
const VIEW_FIT_PADDING = 1.12;
const CELL_FIT_FRACTION = 0.44;

const ELEMENT_COLORS: Record<string, string> = {
  H: "#d8ddd9",
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

/**
 * The x/y/z gizmo, rotated exactly like the atoms so it always shows where
 * the structure's axes point. Sorted back to front; `front` dims axes that
 * point away from the viewer.
 */
function axisTriad(rotation: [number, number]) {
  const length = 28;
  return (["x", "y", "z"] as const)
    .map((name, index) => {
      const unit: Point3 = [0, 0, 0];
      unit[index] = 1;
      const [x, y, z] = rotate(unit, rotation[0], rotation[1]);
      return { name, x: x * length, y: -y * length, z, front: z >= 0 };
    })
    .sort((left, right) => left.z - right.z);
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
  importNonce = 0,
  defaultOpen,
  variant = "inline",
  chromeless = false,
}: StructureViewerProps) {
  const isStage = variant === "stage";
  const [open, setOpen] = useState(
    () => defaultOpen ?? readStoredShowStructure(),
  );
  const showViewer = isStage || chromeless || open;
  const [stageHeight, setStageHeight] = useState(readStoredViewerHeight);
  const [optimizing, setOptimizing] = useState(false);
  const stageHeightRef = useRef(stageHeight);
  stageHeightRef.current = stageHeight;
  const [rotation, setRotation] = useState<[number, number]>([-0.42, 0.58]);
  const [zoom, setZoom] = useState(1);
  const [showGeneratedCell, setShowGeneratedCell] = useState(false);
  const stage = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; rx: number; ry: number } | null>(
    null,
  );
  const heightDrag = useRef<{ startY: number; startHeight: number } | null>(
    null,
  );
  const importNudged = useRef(false);

  useEffect(() => {
    if (!open || isStage || chromeless) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) {
        return;
      }
      event.preventDefault();
      setOpen(false);
      writeStoredShowStructure(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isStage, chromeless]);

  useEffect(() => {
    if (!importNonce || importNudged.current) return;
    importNudged.current = true;
    setOpen(true);
  }, [importNonce]);

  useEffect(() => {
    if (!showViewer) return;
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
  }, [showViewer]);

  useEffect(() => {
    setShowGeneratedCell(false);
  }, [analysis.structure]);

  const generatedCell = analysis.structure.cell_generated;
  const displayCell = Boolean(
    analysis.structure.cell && (!generatedCell || showGeneratedCell),
  );

  const scene = useMemo(() => {
    if (!showViewer) {
      return {
        atoms: [] as {
          atom: Atom;
          index: number;
          x: number;
          y: number;
          z: number;
          baseRadius: number;
        }[],
        bonds: [] as { left: number; right: number }[],
        positionMap: new Map<
          number,
          { x: number; y: number; z: number; baseRadius: number }
        >(),
        cell: [] as { x: number; y: number; z: number }[],
        sampled: false,
      };
    }
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
    let fitRadius = 1;
    if (centeredPoints.length > 0) {
      const atomExtent = Math.max(
        ...centeredPoints.map((point) =>
          Math.hypot(point[0], point[1], point[2]),
        ),
        0.01,
      );
      fitRadius = atomExtent * VIEW_FIT_PADDING;
      if (centeredCorners.length > 0) {
        const cellExtent = Math.max(
          ...centeredCorners.map((point) =>
            Math.hypot(point[0], point[1], point[2]),
          ),
        );
        fitRadius = Math.max(fitRadius, cellExtent * CELL_FIT_FRACTION);
      }
    } else if (centeredCorners.length > 0) {
      fitRadius = Math.max(
        ...centeredCorners.map((point) =>
          Math.hypot(point[0], point[1], point[2]),
        ),
      );
    }
    fitRadius = Math.max(fitRadius, 0.75);
    const scale = (155 / fitRadius) * zoom;
    const maxElementDrawRadius = Math.max(
      ...atoms.map(
        ({ atom }) => (ELEMENT_RADII[atom.symbol] ?? 0.8) * scale,
      ),
      0.001,
    );
    const atomDrawScale =
      maxElementDrawRadius > ATOM_RADIUS_MAX
        ? ATOM_RADIUS_MAX / maxElementDrawRadius
        : 1;
    const project = (point: Point3) => {
      const rotated = rotate(point, rotation[0], rotation[1]);
      return {
        x: 300 + rotated[0] * scale,
        y: 205 - rotated[1] * scale,
        z: rotated[2],
      };
    };
    const projectedAtoms = atoms
      .map(({ atom, index }, atomIndex) => {
        const projected = project(centeredPoints[atomIndex]);
        const baseRadius =
          (ELEMENT_RADII[atom.symbol] ?? 0.8) * scale * atomDrawScale;
        return {
          atom,
          index,
          ...projected,
          baseRadius: Math.max(ATOM_RADIUS_MIN, baseRadius),
        };
      })
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
  }, [showViewer, analysis, displayCell, rotation, zoom]);

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

  function toggleOpen() {
    setOpen((value) => {
      const next = !value;
      writeStoredShowStructure(next);
      return next;
    });
  }

  function onHeightPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    heightDrag.current = {
      startY: event.clientY,
      startHeight: stageHeight,
    };
  }

  function onHeightPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!heightDrag.current) return;
    const next = Math.min(
      VIEWER_HEIGHT_MAX,
      Math.max(
        VIEWER_HEIGHT_MIN,
        heightDrag.current.startHeight +
          (event.clientY - heightDrag.current.startY),
      ),
    );
    setStageHeight(next);
  }

  function onHeightPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (heightDrag.current) {
      writeStoredViewerHeight(stageHeightRef.current);
      heightDrag.current = null;
    }
  }

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
    setOptimizing(true);
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
    setOptimizing(false);
  }

  return (
    <section
      className={`viewer${showViewer ? "" : " viewer-collapsed"}${
        isStage ? " viewer-stage-mode" : ""
      }${chromeless ? " viewer-chromeless" : ""}`}
      aria-labelledby={chromeless ? undefined : "viewer-title"}
      aria-label={chromeless ? "Structure preview" : undefined}
    >
      {!chromeless && (
      <div className="viewer-heading">
        <div className="viewer-heading-text">
          <h2 id="viewer-title">
            <ChemicalFormula formula={analysis.summary.formula} fallback="Structure" />
            {" · "}
            {analysis.summary.atom_count}{" "}
            {analysis.summary.atom_count === 1 ? "atom" : "atoms"}
          </h2>
          {analysis.structure.source_name && (
            <small>{analysis.structure.source_name}</small>
          )}
        </div>
        {!isStage && (
          <div className="viewer-heading-actions">
            <button
              type="button"
              className="viewer-toggle"
              aria-expanded={open}
              aria-controls="viewer-stage"
              onClick={toggleOpen}
            >
              {open ? (
                <ChevronDown size={16} aria-hidden="true" />
              ) : (
                <ChevronRight size={16} aria-hidden="true" />
              )}
              {open ? "Hide structure" : "Show structure"}
            </button>
          </div>
        )}
      </div>
      )}

      {showViewer && (
      <>
      <div
        className={`viewer-stage${optimizing ? " optimize-speed" : ""}`}
        id={isStage ? undefined : "viewer-stage"}
        style={isStage ? undefined : { height: stageHeight }}
      >
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
          {scene.atoms.map(({ atom, index, x, y, z, baseRadius }) => {
            const depth = Math.max(0.72, Math.min(1.22, 1 + z * 0.012));
            const radius = baseRadius * depth;
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
          <g className="axis" transform="translate(42 368)" aria-hidden="true">
            {axisTriad(rotation).map(({ name, x, y, front }) => (
              <g key={name} className={front ? "" : "axis-back"}>
                <line x1="0" y1="0" x2={x} y2={y} className={`axis-${name}`} />
                <text x={x * 1.25} y={y * 1.25}>
                  {name}
                </text>
              </g>
            ))}
          </g>
        </svg>
        <div
          className="viewer-help"
          title="Drag to rotate · Scroll to zoom"
          aria-label="Drag to rotate · Scroll to zoom"
        >
          <Move3d size={14} aria-hidden="true" />
        </div>
        {scene.sampled && (
          <div className="sample-label">Sampled</div>
        )}
        {generatedCell && showGeneratedCell && (
          <div className="generated-cell-label">Preview box</div>
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
        {generatedCell && (
          <button
            type="button"
            aria-pressed={showGeneratedCell}
            title="Preview box"
            onClick={() => setShowGeneratedCell((value) => !value)}
          >
            <Box size={14} aria-hidden="true" />
            box
          </button>
        )}
      </div>
      {!isStage && (
        <button
          type="button"
          className="viewer-resize"
          aria-label="Resize structure view"
          title="Drag to resize structure"
          onPointerDown={onHeightPointerDown}
          onPointerMove={onHeightPointerMove}
          onPointerUp={onHeightPointerUp}
          onPointerCancel={onHeightPointerUp}
          onDoubleClick={() => {
            setStageHeight(VIEWER_HEIGHT_DEFAULT);
            writeStoredViewerHeight(VIEWER_HEIGHT_DEFAULT);
          }}
        />
      )}
      </>
      )}
    </section>
  );
}
