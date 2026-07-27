import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CircleDashed,
  Download,
  FileCode2,
  FlaskConical,
  Keyboard,
  LoaderCircle,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  analyzeFile,
  exportProject,
  getBootstrap,
  perturbFile,
  renderInput,
} from "./api";
import CommandPalette, { type Command } from "./CommandPalette";
import ChemicalFormula from "./ChemicalFormula";
import { MANOSTATS, THERMOSTATS } from "./conditionOptions";
import StructureViewer from "./StructureViewer";
import type {
  Bootstrap,
  Diagnostic,
  PreparationMetadata,
  Preset,
  RenderResult,
  SimulationSetup,
  StructureAnalysis,
} from "./types";

const STEPS = [
  { id: "system", label: "System", hint: "Structure" },
  { id: "method", label: "Method", hint: "Calculator" },
  { id: "conditions", label: "Conditions", hint: "Ensemble" },
  { id: "prepare", label: "Prepare", hint: "Coordinates" },
  { id: "review", label: "Review", hint: "Input" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const EXAMPLE: StructureAnalysis = {
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
        position: [0.9572, 0, 0],
        molecule_type: 0,
        velocity: null,
        force: null,
      },
      {
        symbol: "H",
        position: [-0.239987, 0.927297, 0],
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
    source_name: "water-example.rst",
    source_format: "pq-restart",
    wrapped_centered: true,
    cell_generated: false,
    cell_padding_angstrom: null,
  },
  summary: {
    atom_count: 3,
    formula: "H2O",
    volume_angstrom3: 1728,
    density_g_cm3: 0.0173,
    minimum_distance_angstrom: 0.9572,
  },
  diagnostics: [],
  collisions: [],
  collisions_truncated: false,
  valid: true,
};

const INITIAL_SETUP: SimulationSetup = {
  preset_id: "ambient-nvt",
  job_type: "qm-md",
  ensemble: "NVT",
  start_file: "water-example.rst",
  file_prefix: "water-nvt",
  timestep_fs: 0.5,
  steps: 1000,
  temperature_k: 298.15,
  pressure_bar: null,
  thermostat: "velocity_rescaling",
  thermostat_relaxation_ps: 0.1,
  manostat: null,
  manostat_relaxation_ps: 1,
  initialize_velocities: true,
  random_seed: 238917,
  runner: "ase_xtb",
  runner_script: null,
  overwrite_output: false,
  extra_settings: {},
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function runNameForEnsemble(current: string, ensemble: string): string {
  if (!/-(npt|nvt|nve|opt)$/i.test(current)) return current;
  return current.replace(
    /-(npt|nvt|nve|opt)$/i,
    `-${ensemble.toLowerCase()}`,
  );
}

function Field({
  label,
  unit,
  help,
  info,
  children,
}: {
  label: ReactNode;
  unit?: string;
  help?: string;
  info?: string;
  children: ReactElement<{ id?: string }>;
}) {
  const fieldId = useId();
  const infoId = useId();

  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={fieldId}>{label}</label>
        <span className="field-label-tools">
          {unit && <span className="unit">{unit}</span>}
          {info && (
            <button
              type="button"
              className="info-affordance"
              aria-label={info}
              aria-describedby={infoId}
            >
              <CircleHelp size={14} aria-hidden="true" />
              <span className="info-tooltip" id={infoId} role="tooltip">
                {info}
              </span>
            </button>
          )}
        </span>
      </span>
      {cloneElement(children, { id: fieldId })}
      {help && <span className="field-help">{help}</span>}
    </div>
  );
}

function StepHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="step-heading">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function StatusDot({ status }: { status: "ok" | "warn" | "idle" }) {
  if (status === "ok") return <CheckCircle2 aria-hidden="true" />;
  if (status === "warn") return <CircleAlert aria-hidden="true" />;
  return <CircleDashed aria-hidden="true" />;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<StepId>("system");
  const [analysis, setAnalysis] = useState<StructureAnalysis>(EXAMPLE);
  const [originalAnalysis, setOriginalAnalysis] =
    useState<StructureAnalysis>(EXAMPLE);
  const [isExample, setIsExample] = useState(true);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [baseStartFile, setBaseStartFile] = useState("water-example.rst");
  const [preparation, setPreparation] =
    useState<PreparationMetadata | null>(null);
  const [setup, setSetup] = useState<SimulationSetup>(INITIAL_SETUP);
  const [rendered, setRendered] = useState<RenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [perturbing, setPerturbing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [jitter, setJitter] = useState(false);
  const [sigma, setSigma] = useState(0.01);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "success" | "info";
    message: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const renderSequence = useRef(0);
  const uploadSequence = useRef(0);
  const perturbSequence = useRef(0);

  useEffect(() => {
    let current = true;
    getBootstrap()
      .then((value) => {
        if (!current) return;
        setBootstrap(value);
        const preferred =
          value.runners.find((runner) => runner.id === "ase_xtb" && runner.ready) ??
          value.runners.find((runner) => runner.ready && runner.supported);
        if (preferred) {
          setSetup((existing) => ({ ...existing, runner: preferred.id }));
        }
      })
      .catch((error) => {
        if (current) setBootstrapError(formatError(error));
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const sequence = ++renderSequence.current;
    setRendering(true);
    const timeout = window.setTimeout(() => {
      renderInput(setup)
        .then((result) => {
          if (sequence === renderSequence.current) setRendered(result);
        })
        .catch((error) => {
          if (sequence === renderSequence.current) {
            setRendered({
              input_text: "",
              valid: false,
              diagnostics: [
                {
                  code: "api.render",
                  severity: "error",
                  message: formatError(error),
                  atom_indices: [],
                },
              ],
            });
          }
        })
        .finally(() => {
          if (sequence === renderSequence.current) setRendering(false);
        });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [setup]);

  const selectedRunner = useMemo(
    () =>
      bootstrap?.runners.find((runner) => runner.id === setup.runner) ?? null,
    [bootstrap, setup.runner],
  );

  const generatedCellNpt =
    analysis.structure.cell_generated && setup.ensemble === "NPT";

  const diagnostics = useMemo(
    () => [
      ...analysis.diagnostics,
      ...(rendered?.diagnostics ?? []),
      ...(generatedCellNpt
        ? [
            {
              code: "conditions.generated_cell_npt",
              severity: "error" as const,
              message:
                "NPT needs a physical periodic cell, not a generated vacuum cell.",
              atom_indices: [],
            },
          ]
        : []),
    ],
    [analysis.diagnostics, generatedCellNpt, rendered?.diagnostics],
  );

  const ready = Boolean(
    bootstrap?.pq.found &&
      analysis.valid &&
      !generatedCellNpt &&
      rendered?.valid &&
      (setup.ensemble === "OPT" || selectedRunner?.ready),
  );

  const stepState = useMemo<Record<StepId, "ok" | "warn" | "idle">>(
    () => ({
      system: analysis.valid ? "ok" : "warn",
      method:
        setup.ensemble === "OPT"
          ? "ok"
          : selectedRunner?.ready
            ? "ok"
            : selectedRunner
              ? "warn"
              : "idle",
      conditions: diagnostics.some((item) =>
        item.code.startsWith("conditions."),
      )
        ? "warn"
        : rendered
          ? "ok"
          : "idle",
      prepare: analysis.collisions.length ? "warn" : "ok",
      review: ready ? "ok" : rendered ? "warn" : "idle",
    }),
    [analysis, diagnostics, ready, rendered, selectedRunner, setup.ensemble],
  );

  const openFilePicker = useCallback(() => fileInput.current?.click(), []);

  const createRun = useCallback(async () => {
    if (!ready || exporting) {
      setActiveStep("review");
      return;
    }
    setExporting(true);
    setNotice(null);
    try {
      const blob = await exportProject(
        setup,
        analysis.structure,
        setup.file_prefix,
        preparation,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${setup.file_prefix}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({
        kind: "success",
        message: `${setup.file_prefix}.zip is ready.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: formatError(error) });
    } finally {
      setExporting(false);
    }
  }, [analysis.structure, exporting, preparation, ready, setup]);

  const commands = useMemo<Command[]>(
    () => [
      ...STEPS.map((step, index) => ({
        id: `step-${step.id}`,
        label: `Go to ${step.label}`,
        hint: `Alt ${index + 1}`,
        run: () => setActiveStep(step.id),
      })),
      {
        id: "import",
        label: "Import a structure",
        hint: "RST, CIF, XYZ, PDB",
        run: openFilePicker,
      },
      {
        id: "create",
        label: "Create run package",
        hint: ready ? "Ctrl Enter" : "Resolve preflight first",
        run: () => void createRun(),
      },
    ],
    [createRun, openFilePicker, ready],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.matches("input, textarea, select, [contenteditable=true]") ??
        false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter" &&
        !paletteOpen
      ) {
        event.preventDefault();
        void createRun();
        return;
      }
      if (event.altKey && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        setActiveStep(STEPS[Number(event.key) - 1].id);
        return;
      }
      if (!editing && event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createRun, paletteOpen]);

  async function useFile(file: File) {
    const sequence = ++uploadSequence.current;
    perturbSequence.current += 1;
    setUploading(true);
    setNotice(null);
    try {
      const result = await analyzeFile(file);
      if (sequence !== uploadSequence.current) return;
      setAnalysis(result);
      setOriginalAnalysis(result);
      setSourceFile(file);
      setIsExample(false);
      setJitter(false);
      setPreparation(null);
      const stem = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-");
      const restartName = `${stem || "structure"}.rst`;
      setBaseStartFile(restartName);
      setSetup((existing) => ({
        ...existing,
        start_file: restartName,
        file_prefix: `${stem || "pq"}-run`,
      }));
      setNotice({
        kind: result.valid ? "success" : "info",
        message: result.valid
          ? `${file.name} passed the structure checks.`
          : `${file.name} needs attention.`,
      });
    } catch (error) {
      if (sequence === uploadSequence.current) {
        setNotice({ kind: "error", message: formatError(error) });
      }
    } finally {
      if (sequence === uploadSequence.current) setUploading(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void useFile(file);
  }

  async function applyJitter() {
    if (!sourceFile) return;
    const sequence = ++perturbSequence.current;
    setPerturbing(true);
    setNotice(null);
    try {
      const result = await perturbFile(sourceFile, sigma, setup.random_seed);
      if (sequence !== perturbSequence.current) return;
      setAnalysis(result);
      setPreparation({
        kind: "gaussian-position-jitter",
        sigma_angstrom: result.sigma_angstrom,
        seed: result.seed,
        source_sha256: result.source_sha256,
        prepared_sha256: result.prepared_sha256,
      });
      setSetup((existing) => ({
        ...existing,
        start_file: result.restart_filename,
      }));
      setNotice({
        kind: result.valid ? "success" : "info",
        message: result.valid
          ? `Prepared with σ = ${sigma} Å and seed ${setup.random_seed}.`
          : "Prepared coordinates still need attention.",
      });
    } catch (error) {
      if (sequence === perturbSequence.current) {
        setNotice({ kind: "error", message: formatError(error) });
      }
    } finally {
      if (sequence === perturbSequence.current) setPerturbing(false);
    }
  }

  function clearAppliedPreparation() {
    perturbSequence.current += 1;
    setPerturbing(false);
    if (!preparation) return;
    setAnalysis(originalAnalysis);
    setPreparation(null);
    setNotice({
      kind: "info",
      message: "Original coordinates restored.",
    });
    setSetup((existing) => ({
      ...existing,
      start_file: baseStartFile,
    }));
  }

  function applyPreset(preset: Preset) {
    const preferredRunner =
      preset.runner ??
      setup.runner ??
      bootstrap?.runners.find(
        (runner) => runner.id === "ase_xtb" && runner.ready,
      )?.id ??
      null;
    setSetup((existing) => ({
      ...existing,
      preset_id: preset.id,
      job_type: preset.job_type,
      ensemble: preset.ensemble,
      temperature_k: preset.temperature_k,
      pressure_bar: preset.pressure_bar,
      timestep_fs: preset.timestep_fs,
      steps: preset.steps,
      file_prefix: runNameForEnsemble(
        existing.file_prefix,
        preset.ensemble,
      ),
      thermostat: preset.thermostat,
      manostat: preset.manostat,
      initialize_velocities: preset.ensemble !== "OPT",
      runner: preset.ensemble === "OPT" ? null : preferredRunner,
    }));
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <img src="/pq-logo.png" alt="PQ" />
          <div>
            <strong>PQSetup</strong>
            <span>Simulation input</span>
          </div>
        </div>
        <button
          type="button"
          className="command-trigger"
          aria-label="Search commands"
          onClick={() => setPaletteOpen(true)}
        >
          <Search size={16} aria-hidden="true" />
          <span>Search commands</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="header-status">
          {bootstrap ? (
            <>
              <span className={bootstrap.pq.found ? "status-ready" : "status-missing"}>
                <span aria-hidden="true" />
                PQ{" "}
                {bootstrap.pq.found
                  ? bootstrap.pq.version ?? "detected"
                  : "not found"}
              </span>
              <span className="version">
                Schema {bootstrap.target_pq_release}
              </span>
            </>
          ) : bootstrapError ? (
            <span className="status-missing">Backend unavailable</span>
          ) : (
            <span className="loading-label">
              <LoaderCircle size={15} className="spin" />
              Checking system
            </span>
          )}
        </div>
      </header>

      <div className="workspace">
        <nav className="workflow" aria-label="Setup workflow">
          <div className="workflow-title">
            <span>Workflow</span>
            <Keyboard size={16} aria-label="Keyboard accessible" />
          </div>
          <ol>
            {STEPS.map((step, index) => (
              <li key={step.id}>
                <button
                  type="button"
                  className={activeStep === step.id ? "active" : ""}
                  aria-current={activeStep === step.id ? "step" : undefined}
                  onClick={() => setActiveStep(step.id)}
                >
                  <span className={`step-marker ${stepState[step.id]}`}>
                    {stepState[step.id] === "ok" ? <Check size={13} /> : index + 1}
                  </span>
                  <span className="step-copy">
                    <strong>{step.label}</strong>
                    <small>{step.hint}</small>
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          <div className="workflow-tip">
            <span>Alt 1–5</span>
            Jump between steps
          </div>
        </nav>

        <main className="setup-main">
          {notice && (
            <div className={`notice ${notice.kind}`} role="status">
              {notice.kind === "error" ? (
                <CircleAlert size={17} />
              ) : (
                <CheckCircle2 size={17} />
              )}
              <span>{notice.message}</span>
              <button type="button" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}

          {activeStep === "system" && (
            <section className="step-panel">
              <StepHeading
                eyebrow="01 · System"
                title="Choose the structure"
                description="PQSetup checks coordinates, the periodic cell, elements, and close contacts before a run is created."
              />
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept=".rst,.xyz,.cif,.pdb,.mol,.sdf,.traj,.extxyz"
                onChange={onFileChange}
              />
              <button
                type="button"
                className="drop-zone"
                onClick={openFilePicker}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event: DragEvent<HTMLButtonElement>) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file) void useFile(file);
                }}
              >
                {uploading ? (
                  <LoaderCircle className="spin" size={25} />
                ) : (
                  <Upload size={25} />
                )}
                <span>
                  <strong>
                    {uploading ? "Checking structure…" : "Drop a structure here"}
                  </strong>
                  <small>or choose RST, CIF, XYZ, PDB, MOL, or trajectory</small>
                </span>
                <span className="choose-file">Choose file</span>
              </button>
              <div className="current-file">
                <div className="file-icon">
                  <FileCode2 size={20} />
                </div>
                <div>
                  <span className="eyebrow">{isExample ? "Example" : "Current"}</span>
                  <strong>{analysis.structure.source_name}</strong>
                  <small>
                    <ChemicalFormula formula={analysis.summary.formula} /> ·{" "}
                    {analysis.summary.atom_count.toLocaleString()} atoms
                  </small>
                </div>
                <span className={analysis.valid ? "file-valid" : "file-invalid"}>
                  {analysis.valid ? "Valid" : "Review"}
                </span>
              </div>
              <div className="inline-note">
                <strong>PQ cell convention</strong>
                <p>
                  Periodic coordinates are wrapped around the cell center, from
                  −L/2 to +L/2. The original file remains unchanged.
                </p>
              </div>
            </section>
          )}

          {activeStep === "method" && (
            <section className="step-panel">
              <StepHeading
                eyebrow="02 · Method"
                title="Select the calculator"
                description="Choose a guided method. Other PQ methods remain visible as read-only environment checks."
              />
              {bootstrap && (
                <div className="compatibility-line" aria-label="PQ compatibility">
                  <span>
                    Installed <strong>{bootstrap.pq.version ?? "unknown"}</strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Target schema <strong>{bootstrap.target_pq_release}</strong>
                  </span>
                </div>
              )}
              {setup.ensemble === "OPT" ? (
                <div className="empty-method">
                  <FlaskConical size={25} />
                  <div>
                    <strong>Molecular mechanics optimization</strong>
                    <p>
                      The selected workflow uses PQ force-field settings rather
                      than a QM calculator.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="runner-list"
                    role="radiogroup"
                    aria-label="Calculator"
                  >
                    {(bootstrap?.runners ?? [])
                      .filter((runner) => runner.id === "ase_xtb")
                      .map((runner) => (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={setup.runner === runner.id}
                          disabled={!runner.ready}
                          className={setup.runner === runner.id ? "selected" : ""}
                          key={runner.id}
                          onClick={() =>
                            setSetup((existing) => ({
                              ...existing,
                              runner: runner.id,
                              runner_script: null,
                            }))
                          }
                        >
                          <span className="radio-dot" />
                          <span className="runner-name">
                            <strong>
                              ASE · xTB (DFTB+)
                            </strong>
                            <small>{runner.detail}</small>
                          </span>
                          <span
                            className={`runner-state ${
                              runner.ready ? "ready" : "missing"
                            }`}
                          >
                            {runner.ready ? "Ready" : "Missing"}
                          </span>
                        </button>
                      ))}
                    {!bootstrap && (
                      <div className="runner-loading">
                        <LoaderCircle className="spin" size={18} />
                        Detecting calculators
                      </div>
                    )}
                  </div>
                  {bootstrap && (
                    <details className="detected-runners">
                      <summary>
                        <span>Other PQ methods</span>
                        <span>
                          {
                            bootstrap.runners.filter(
                              (runner) =>
                                runner.id !== "ase_xtb" && runner.installed,
                            ).length
                          }{" "}
                          detected
                        </span>
                      </summary>
                      <ul>
                        {bootstrap.runners
                          .filter((runner) => runner.id !== "ase_xtb")
                          .map((runner) => (
                            <li key={runner.id}>
                              <span>
                                <strong>{runner.label}</strong>
                                <small>
                                  {runner.supported
                                    ? "Guided setup is not available yet."
                                    : runner.detail}
                                </small>
                              </span>
                              <span
                                className={`runner-state ${
                                  !runner.supported
                                    ? "unsupported"
                                    : runner.installed
                                      ? "ready"
                                      : "missing"
                                }`}
                              >
                                {!runner.supported
                                  ? "Unsupported"
                                  : runner.installed
                                    ? "Detected"
                                    : "Missing"}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                  {selectedRunner && (
                    <div className="method-detail">
                      <div>
                        <span className="eyebrow">Selected method</span>
                        <strong>{selectedRunner.label}</strong>
                        <small>
                          {selectedRunner.executable ??
                            "Python or PQ build integration"}
                          {selectedRunner.version
                            ? ` · ${selectedRunner.version}`
                            : ""}
                        </small>
                      </div>
                      {selectedRunner.id === "ase_xtb" && (
                        <p className="method-explanation">
                          Uses ASE with DFTB+’s xTB Hamiltonian. GFN2-xTB is
                          selected by default.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {activeStep === "conditions" && (
            <section className="step-panel">
              <StepHeading
                eyebrow="03 · Conditions"
                title="Set the simulation"
                description="Start from a conservative scientific preset, then change only what the run needs."
              />
              <div className="preset-tabs" role="radiogroup" aria-label="Preset">
                {(bootstrap?.presets ?? []).map((preset) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={setup.preset_id === preset.id}
                    className={setup.preset_id === preset.id ? "selected" : ""}
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                  >
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
              </div>
              <div className="form-grid">
                {setup.ensemble !== "OPT" && (
                  <>
                    <Field label="Temperature" unit="K">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={setup.temperature_k ?? ""}
                        onChange={(event) =>
                          setSetup((existing) => ({
                            ...existing,
                            temperature_k: event.target.value
                              ? Number(event.target.value)
                              : null,
                          }))
                        }
                      />
                    </Field>
                    {setup.ensemble === "NPT" && (
                      <Field
                        label="Pressure"
                        unit="bar"
                        help="1 atm is serialized as 1.01325 bar."
                      >
                        <input
                          type="number"
                          min="0"
                          step="0.00001"
                          value={setup.pressure_bar ?? ""}
                          onChange={(event) =>
                            setSetup((existing) => ({
                              ...existing,
                              pressure_bar: event.target.value
                                ? Number(event.target.value)
                                : null,
                            }))
                          }
                        />
                      </Field>
                    )}
                    <Field label="Timestep" unit="fs">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={setup.timestep_fs ?? ""}
                        onChange={(event) =>
                          setSetup((existing) => ({
                            ...existing,
                            timestep_fs: event.target.value
                              ? Number(event.target.value)
                              : null,
                          }))
                        }
                      />
                    </Field>
                    <Field label="Steps">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={setup.steps ?? ""}
                        onChange={(event) =>
                          setSetup((existing) => ({
                            ...existing,
                            steps: event.target.value
                              ? Number(event.target.value)
                              : null,
                          }))
                        }
                      />
                    </Field>
                    {(setup.ensemble === "NVT" ||
                      setup.ensemble === "NPT") && (
                      <Field
                        label="Thermostat"
                        help="Controls how the system exchanges heat with the target temperature."
                      >
                        <select
                          value={setup.thermostat ?? "velocity_rescaling"}
                          onChange={(event) =>
                            setSetup((existing) => ({
                              ...existing,
                              preset_id: null,
                              thermostat: event.target.value,
                            }))
                          }
                        >
                          {THERMOSTATS.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {setup.ensemble === "NPT" && (
                      <Field
                        label="Manostat"
                        info="“Manostat” is an older name for a pressure regulator: mano- refers to pressure measurement and -stat to holding steady. Most MD software says “barostat”; PQ’s input keyword is manostat."
                        help="Controls how the periodic cell responds to the target pressure."
                      >
                        <select
                          value={setup.manostat ?? "stochastic_rescaling"}
                          onChange={(event) =>
                            setSetup((existing) => ({
                              ...existing,
                              preset_id: null,
                              manostat: event.target.value,
                            }))
                          }
                        >
                          {MANOSTATS.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </>
                )}
              </div>
              {setup.ensemble !== "OPT" && (
                <p className="simulated-time">
                  {setup.ensemble} run ·{" "}
                  <strong>
                    {setup.steps && setup.timestep_fs
                      ? `${(setup.steps * setup.timestep_fs).toLocaleString()} fs`
                      : "duration incomplete"}
                  </strong>
                </p>
              )}
            </section>
          )}

          {activeStep === "prepare" && (
            <section className="step-panel">
              <StepHeading
                eyebrow="04 · Prepare"
                title="Prepare the coordinates"
                description="Optional perturbation can break perfect crystal symmetry. Every prepared structure is revalidated."
              />
              <div className="prepare-row locked">
                <div className="prepare-icon">
                  <Check size={18} />
                </div>
                <div>
                  <strong>Wrap into the centered cell</strong>
                  <p>Periodic atoms use PQ’s −L/2 to +L/2 convention.</p>
                </div>
                <span>Applied</span>
              </div>
              <div className={`prepare-option ${jitter ? "enabled" : ""}`}>
                <label className="switch-row">
                  <span className="prepare-icon">
                    <Sparkles size={18} />
                  </span>
                  <span>
                    <strong>Break perfect symmetry</strong>
                    <small>Add a small seeded Gaussian position offset.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={jitter}
                    disabled={!sourceFile}
                    onChange={(event) => {
                      setJitter(event.target.checked);
                      if (!event.target.checked) clearAppliedPreparation();
                    }}
                  />
                  <span className="switch" aria-hidden="true" />
                </label>
                {jitter && (
                  <div className="prepare-fields">
                    <Field
                      label="Position σ"
                      unit="Å"
                      help="0.01 Å is a conservative starting point."
                    >
                      <input
                        type="number"
                        min="0"
                        max="0.2"
                        step="0.001"
                        value={sigma}
                        onChange={(event) => {
                          clearAppliedPreparation();
                          setSigma(Number(event.target.value));
                        }}
                      />
                    </Field>
                    <Field
                      label="Random seed"
                      help="The same seed reproduces the same coordinates."
                    >
                      <input
                        type="number"
                        min="0"
                        max="4294967295"
                        step="1"
                        value={setup.random_seed}
                        onChange={(event) => {
                          clearAppliedPreparation();
                          setSetup((existing) => ({
                            ...existing,
                            random_seed: Number(event.target.value),
                          }));
                        }}
                      />
                    </Field>
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={perturbing || !sourceFile}
                      onClick={() => void applyJitter()}
                    >
                      {perturbing ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Sparkles size={16} />
                      )}
                      Apply to original
                    </button>
                  </div>
                )}
                {preparation && (
                  <div className="preparation-applied">
                    <CheckCircle2 size={15} />
                    Applied · σ {preparation.sigma_angstrom} Å · seed{" "}
                    {preparation.seed}
                  </div>
                )}
                {!sourceFile && (
                  <p className="example-limit">
                    Import a structure to enable reproducible preparation.
                  </p>
                )}
              </div>
              <div className="velocity-note">
                <div>
                  <strong>Velocities are generated by PQ</strong>
                  <p>
                    PQ samples the mass-dependent Maxwell–Boltzmann distribution
                    at {setup.temperature_k ?? "the target"} K and removes net
                    motion. PQSetup writes the temperature and seed.
                  </p>
                </div>
                <span>Recommended</span>
              </div>
            </section>
          )}

          {activeStep === "review" && (
            <section className="step-panel review-panel">
              <StepHeading
                eyebrow="05 · Review"
                title="Review the run"
                description="The package contains the PQ input, prepared restart, and a reproducibility manifest."
              />
              <div className="form-grid review-fields">
                <Field label="Run name">
                  <input
                    value={setup.file_prefix}
                    onChange={(event) =>
                      setSetup((existing) => ({
                        ...existing,
                        file_prefix: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field label="Start file">
                  <input
                    value={setup.start_file}
                    onChange={(event) =>
                      setSetup((existing) => ({
                        ...existing,
                        start_file: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="input-preview">
                <div className="preview-title">
                  <span>
                    <FileCode2 size={16} />
                    {setup.file_prefix || "run"}.in
                  </span>
                  {rendering && <LoaderCircle className="spin" size={15} />}
                </div>
                <pre>
                  <code>
                    {rendered?.input_text ||
                      rendered?.diagnostics[0]?.message ||
                      "Preparing input…"}
                  </code>
                </pre>
              </div>
              <button
                type="button"
                className="create-run large"
                disabled={!ready || exporting}
                onClick={() => void createRun()}
              >
                {exporting ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Download size={18} />
                )}
                {exporting ? "Creating package…" : "Create run package"}
                <span>Ctrl Enter</span>
              </button>
            </section>
          )}

          <footer className="step-footer">
            <span>
              Step {STEPS.findIndex((step) => step.id === activeStep) + 1} of{" "}
              {STEPS.length}
            </span>
            {activeStep !== "review" && (
              <button
                type="button"
                onClick={() => {
                  const index = STEPS.findIndex(
                    (step) => step.id === activeStep,
                  );
                  setActiveStep(STEPS[Math.min(index + 1, STEPS.length - 1)].id);
                }}
              >
                Continue
                <ArrowRight size={16} />
              </button>
            )}
          </footer>
        </main>

        <aside className="inspector">
          <StructureViewer analysis={analysis} example={isExample} />
          <section className="preflight" aria-labelledby="preflight-title">
            <div className="preflight-heading">
              <div>
                <span className="eyebrow">Preflight</span>
                <h2 id="preflight-title">
                  {ready ? "Ready to create" : "Check the run"}
                </h2>
              </div>
              <span className={`preflight-score ${ready ? "ready" : ""}`}>
                {diagnostics.filter((item) => item.severity === "error").length}
              </span>
            </div>
            <ul className="preflight-list">
              <li className={bootstrap?.pq.found ? "ok" : "warn"}>
                <StatusDot status={bootstrap?.pq.found ? "ok" : "warn"} />
                <span>
                  <strong>PQ executable</strong>
                  <small>{bootstrap?.pq.detail ?? "Checking…"}</small>
                </span>
              </li>
              <li className={analysis.valid ? "ok" : "warn"}>
                <StatusDot status={analysis.valid ? "ok" : "warn"} />
                <span>
                  <strong>Structure</strong>
                  <small>
                    {analysis.valid
                      ? "Coordinates and cell are valid."
                      : "Structure errors need attention."}
                  </small>
                </span>
              </li>
              <li
                className={
                  setup.ensemble === "OPT" || selectedRunner?.ready
                    ? "ok"
                    : "warn"
                }
              >
                <StatusDot
                  status={
                    setup.ensemble === "OPT" || selectedRunner?.ready
                      ? "ok"
                      : selectedRunner
                        ? "warn"
                        : "idle"
                  }
                />
                <span>
                  <strong>Method</strong>
                  <small>
                    {setup.ensemble === "OPT"
                      ? "Molecular mechanics optimization."
                      : selectedRunner?.detail ?? "Choose a calculator."}
                  </small>
                </span>
              </li>
              <li className={rendered?.valid ? "ok" : "warn"}>
                <StatusDot
                  status={rendered?.valid ? "ok" : rendered ? "warn" : "idle"}
                />
                <span>
                  <strong>PQ input</strong>
                  <small>
                    {rendered?.valid
                      ? "All required settings are present."
                      : rendering
                        ? "Validating…"
                        : "Input settings need attention."}
                  </small>
                </span>
              </li>
            </ul>
            {diagnostics.length > 0 && (
              <div className="diagnostics">
                {diagnostics.slice(0, 4).map((item: Diagnostic, index) => (
                  <button
                    type="button"
                    key={`${item.code}-${index}`}
                    className={item.severity}
                    onClick={() =>
                      setActiveStep(
                        item.code.startsWith("structure")
                          ? "system"
                          : item.code.startsWith("runner")
                            ? "method"
                            : "conditions",
                      )
                    }
                  >
                    <CircleAlert size={14} />
                    <span>{item.message}</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="create-run"
              disabled={!ready || exporting}
              onClick={() => void createRun()}
            >
              {exporting ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Download size={17} />
              )}
              Create run
            </button>
          </section>
        </aside>
      </div>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
