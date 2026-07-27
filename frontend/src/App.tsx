import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CircleDashed,
  Download,
  FileCode2,
  Keyboard,
  Link2,
  LoaderCircle,
  Plus,
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
  renderPlan,
} from "./api";
import CommandPalette, { type Command } from "./CommandPalette";
import ChemicalFormula from "./ChemicalFormula";
import {
  MANOSTATS,
  PRESSURE_ISOTROPIES,
  THERMOSTATS,
} from "./conditionOptions";
import StructureViewer from "./StructureViewer";
import type {
  Bootstrap,
  CalculatorSelection,
  Diagnostic,
  Ensemble,
  EquilibrationStage,
  PlanRenderResult,
  PreparationMetadata,
  SimulationSetup,
  StructureAnalysis,
} from "./types";

const STEPS = [
  { id: "system", label: "System", hint: "Structure" },
  { id: "method", label: "Method", hint: "Calculators" },
  { id: "conditions", label: "Conditions", hint: "Run plan" },
  { id: "prepare", label: "Prepare", hint: "Coordinates" },
  { id: "review", label: "Review", hint: "Inputs" },
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
  restart_file: null,
  file_prefix: "water-nvt",
  timestep_fs: 0.5,
  steps: 1000,
  temperature_k: 298.15,
  start_temperature_k: null,
  temperature_ramp_steps: null,
  temperature_ramp_frequency: 1,
  pressure_bar: null,
  thermostat: "velocity_rescaling",
  thermostat_relaxation_ps: 0.1,
  thermostat_friction_ps_inverse: 0.1,
  nh_chain_length: 3,
  coupling_frequency_cm_inverse: 1000,
  manostat: null,
  manostat_relaxation_ps: 1,
  compressibility_bar_inverse: 4.591e-5,
  pressure_isotropy: "isotropic",
  initialize_velocities: true,
  random_seed: 238917,
  runner: "ase_xtb",
  runner_script: null,
  overwrite_output: false,
  extra_settings: {},
};

const INITIAL_EQUILIBRATION: EquilibrationStage = {
  enabled: true,
  steps: 5000,
  timestep_fs: 0.5,
  temperature_k: 298.15,
  start_temperature_k: null,
  temperature_ramp_steps: null,
  temperature_ramp_frequency: 1,
  thermostat: "berendsen",
  thermostat_relaxation_ps: 0.1,
  thermostat_friction_ps_inverse: 0.1,
  nh_chain_length: 3,
  coupling_frequency_cm_inverse: 1000,
};

const DEFAULT_RUNNER_SCRIPTS: Record<string, string> = {
  dftbplus: "dftbplus_periodic_stress",
  pyscf: "pyscf_hf.py",
  turbomole: "turbomole_rimp2",
};

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function durationLabel(steps: number | null, timestep: number | null): string {
  if (!steps || !timestep) return "Duration incomplete";
  const femtoseconds = steps * timestep;
  if (femtoseconds >= 1000) {
    return `${(femtoseconds / 1000).toLocaleString(undefined, {
      maximumFractionDigits: 3,
    })} ps`;
  }
  return `${femtoseconds.toLocaleString()} fs`;
}

function thermostatDescription(value: string | null): string {
  return (
    THERMOSTATS.find((option) => option.value === value)?.description ??
    "Choose how temperature is coupled."
  );
}

function manostatDescription(value: string | null): string {
  return (
    MANOSTATS.find((option) => option.value === value)?.description ??
    "Choose how pressure is coupled."
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

type ThermostatSettings = Pick<
  SimulationSetup,
  | "thermostat"
  | "thermostat_relaxation_ps"
  | "thermostat_friction_ps_inverse"
  | "nh_chain_length"
  | "coupling_frequency_cm_inverse"
>;

type TemperatureScheduleSettings = Pick<
  SimulationSetup,
  | "start_temperature_k"
  | "temperature_ramp_steps"
  | "temperature_ramp_frequency"
>;

function TemperatureCoupling({
  value,
  onChange,
}: {
  value: ThermostatSettings;
  onChange: (patch: Partial<ThermostatSettings>) => void;
}) {
  return (
    <section className="coupling-section" aria-label="Temperature coupling">
      <div className="section-rule-heading">
        <strong>Temperature coupling</strong>
        <span>Thermostat</span>
      </div>
      <div className="form-grid coupling-grid">
        <Field label="Thermostat">
          <select
            value={value.thermostat ?? "velocity_rescaling"}
            onChange={(event) => onChange({ thermostat: event.target.value })}
          >
            {THERMOSTATS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        {(value.thermostat === "berendsen" ||
          value.thermostat === "velocity_rescaling") && (
          <Field label="Relaxation time" unit="ps">
            <input
              type="number"
              min="0.000001"
              step="0.01"
              value={value.thermostat_relaxation_ps ?? ""}
              onChange={(event) =>
                onChange({
                  thermostat_relaxation_ps: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </Field>
        )}
        {value.thermostat === "langevin" && (
          <Field label="Friction" unit="ps⁻¹">
            <input
              type="number"
              min="0"
              step="0.01"
              value={value.thermostat_friction_ps_inverse}
              onChange={(event) =>
                onChange({
                  thermostat_friction_ps_inverse: Number(event.target.value),
                })
              }
            />
          </Field>
        )}
        {value.thermostat === "nh-chain" && (
          <>
            <Field label="Chain length">
              <input
                type="number"
                min="1"
                step="1"
                value={value.nh_chain_length}
                onChange={(event) =>
                  onChange({ nh_chain_length: Number(event.target.value) })
                }
              />
            </Field>
            <Field label="Coupling frequency" unit="cm⁻¹">
              <input
                type="number"
                min="0"
                step="1"
                value={value.coupling_frequency_cm_inverse}
                onChange={(event) =>
                  onChange({
                    coupling_frequency_cm_inverse: Number(event.target.value),
                  })
                }
              />
            </Field>
          </>
        )}
      </div>
      <p className="coupling-description">
        {thermostatDescription(value.thermostat)}
      </p>
    </section>
  );
}

function TemperatureSchedule({
  value,
  onChange,
}: {
  value: TemperatureScheduleSettings;
  onChange: (patch: Partial<TemperatureScheduleSettings>) => void;
}) {
  return (
    <details className="schedule-settings">
      <summary>
        <span>
          <strong>Temperature schedule</strong>
          <small>
            {value.start_temperature_k == null
              ? "Constant target temperature"
              : `${value.start_temperature_k} K → target`}
          </small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="form-grid schedule-grid">
        <Field
          label="Start temperature"
          unit="K"
          help="Leave blank to start at the target temperature."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={value.start_temperature_k ?? ""}
            onChange={(event) =>
              onChange({
                start_temperature_k: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          />
        </Field>
        <Field label="Ramp steps" help="0 uses the full stage.">
          <input
            type="number"
            min="0"
            step="1"
            value={value.temperature_ramp_steps ?? ""}
            onChange={(event) =>
              onChange({
                temperature_ramp_steps: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          />
        </Field>
        <Field label="Ramp frequency" unit="steps">
          <input
            type="number"
            min="1"
            step="1"
            value={value.temperature_ramp_frequency}
            onChange={(event) =>
              onChange({
                temperature_ramp_frequency: Number(event.target.value),
              })
            }
          />
        </Field>
      </div>
    </details>
  );
}

type ManostatSettings = Pick<
  SimulationSetup,
  | "manostat"
  | "manostat_relaxation_ps"
  | "compressibility_bar_inverse"
  | "pressure_isotropy"
>;

function PressureCoupling({
  value,
  onChange,
}: {
  value: ManostatSettings;
  onChange: (patch: Partial<ManostatSettings>) => void;
}) {
  return (
    <section className="coupling-section" aria-label="Pressure coupling">
      <div className="section-rule-heading">
        <strong>Pressure coupling</strong>
        <span>Manostat</span>
      </div>
      <div className="form-grid coupling-grid pressure-grid">
        <Field
          label="Manostat"
          info="PQ calls this a manostat. It is essentially a barostat: the pressure-coupling method that adjusts the simulation cell."
        >
          <select
            value={value.manostat ?? "stochastic_rescaling"}
            onChange={(event) => onChange({ manostat: event.target.value })}
          >
            {MANOSTATS.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Relaxation time" unit="ps">
          <input
            type="number"
            min="0.000001"
            step="0.01"
            value={value.manostat_relaxation_ps ?? ""}
            onChange={(event) =>
              onChange({
                manostat_relaxation_ps: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          />
        </Field>
        <Field label="Compressibility" unit="bar⁻¹">
          <input
            type="number"
            min="0"
            step="0.000001"
            value={value.compressibility_bar_inverse}
            onChange={(event) =>
              onChange({
                compressibility_bar_inverse: Number(event.target.value),
              })
            }
          />
        </Field>
        <Field label="Cell response">
          <select
            value={value.pressure_isotropy}
            onChange={(event) =>
              onChange({
                pressure_isotropy:
                  event.target.value as SimulationSetup["pressure_isotropy"],
              })
            }
          >
            {PRESSURE_ISOTROPIES.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="coupling-description">
        {manostatDescription(value.manostat)}
      </p>
    </section>
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
  const [calculators, setCalculators] = useState<CalculatorSelection[]>([
    { runner_id: "ase_xtb", runner_script: null },
  ]);
  const [equilibration, setEquilibration] =
    useState<EquilibrationStage | null>(null);
  const [rendered, setRendered] = useState<PlanRenderResult | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
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
  const setupMain = useRef<HTMLElement>(null);
  const renderSequence = useRef(0);
  const uploadSequence = useRef(0);
  const perturbSequence = useRef(0);

  useEffect(() => {
    setupMain.current?.scrollTo({ top: 0, left: 0 });
  }, [activeStep]);

  useEffect(() => {
    let current = true;
    getBootstrap()
      .then((value) => {
        if (!current) return;
        setBootstrap(value);
        const preferred =
          value.runners.find((runner) => runner.id === "ase_xtb") ??
          value.runners.find((runner) => runner.supported);
        if (preferred) {
          setSetup((existing) => ({ ...existing, runner: preferred.id }));
          setCalculators((existing) =>
            existing.some((item) => item.runner_id === preferred.id)
              ? existing
              : [{ runner_id: preferred.id, runner_script: null }],
          );
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
      renderPlan(setup, calculators, equilibration)
        .then((result) => {
          if (sequence !== renderSequence.current) return;
          setRendered(result);
          setSelectedFileKey((current) => {
            if (
              current &&
              result.files.some(
                (file) => `${file.calculator_id}:${file.name}` === current,
              )
            ) {
              return current;
            }
            const first = result.files[0];
            return first ? `${first.calculator_id}:${first.name}` : null;
          });
        })
        .catch((error) => {
          if (sequence === renderSequence.current) {
            setRendered({
              files: [],
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
  }, [calculators, equilibration, setup]);

  const selectedRunnerStatuses = useMemo(
    () =>
      calculators.map((calculator) => ({
        selection: calculator,
        status:
          bootstrap?.runners.find(
            (runner) => runner.id === calculator.runner_id,
          ) ?? null,
      })),
    [bootstrap, calculators],
  );
  const selectedFile = useMemo(
    () =>
      rendered?.files.find(
        (file) => `${file.calculator_id}:${file.name}` === selectedFileKey,
      ) ??
      rendered?.files[0] ??
      null,
    [rendered, selectedFileKey],
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

  const errorCount = diagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const missingCalculatorCount = selectedRunnerStatuses.filter(
    ({ status }) => status && !status.ready,
  ).length;
  const ready = Boolean(
    analysis.valid &&
      !generatedCellNpt &&
      rendered?.valid &&
      calculators.length > 0 &&
      errorCount === 0,
  );

  const stepState = useMemo<Record<StepId, "ok" | "warn" | "idle">>(
    () => ({
      system: analysis.valid ? "ok" : "warn",
      method:
        calculators.length === 0
          ? "warn"
          : missingCalculatorCount
            ? "warn"
            : "ok",
      conditions: diagnostics.some(
        (item) =>
          item.severity === "error" &&
          (item.code.startsWith("conditions.") ||
            item.code.startsWith("run.") ||
            item.code.startsWith("plan.")),
      )
        ? "warn"
        : rendered
          ? "ok"
          : "idle",
      prepare: analysis.collisions.length ? "warn" : "ok",
      review: ready ? "ok" : rendered ? "warn" : "idle",
    }),
    [
      analysis,
      calculators.length,
      diagnostics,
      missingCalculatorCount,
      ready,
      rendered,
    ],
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
        calculators,
        equilibration,
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
  }, [
    analysis.structure,
    calculators,
    equilibration,
    exporting,
    preparation,
    ready,
    setup,
  ]);

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

  function toggleCalculator(runnerId: string) {
    const selected = calculators.some((item) => item.runner_id === runnerId);
    const next = selected
      ? calculators.filter((item) => item.runner_id !== runnerId)
      : [...calculators, { runner_id: runnerId, runner_script: null }];
    setCalculators(next);
    setSetup((existing) => ({
      ...existing,
      runner: next[0]?.runner_id ?? null,
      runner_script: next[0]?.runner_script ?? null,
    }));
  }

  function updateCalculatorScript(runnerId: string, script: string) {
    setCalculators((existing) =>
      existing.map((item) =>
        item.runner_id === runnerId
          ? { ...item, runner_script: script || null }
          : item,
      ),
    );
    if (setup.runner === runnerId) {
      setSetup((existing) => ({
        ...existing,
        runner_script: script || null,
      }));
    }
  }

  function chooseProtocol(withEquilibration: boolean) {
    setEquilibration(
      withEquilibration
        ? {
            ...INITIAL_EQUILIBRATION,
            timestep_fs: setup.timestep_fs ?? INITIAL_EQUILIBRATION.timestep_fs,
            temperature_k:
              setup.temperature_k ?? INITIAL_EQUILIBRATION.temperature_k,
          }
        : null,
    );
  }

  function updateEquilibration(patch: Partial<EquilibrationStage>) {
    setEquilibration((existing) =>
      existing ? { ...existing, ...patch } : existing,
    );
  }

  function chooseSamplingEnsemble(ensemble: Exclude<Ensemble, "OPT">) {
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      ensemble,
      thermostat:
        ensemble === "NVE"
          ? null
          : existing.thermostat ?? "velocity_rescaling",
      manostat:
        ensemble === "NPT"
          ? existing.manostat ?? "stochastic_rescaling"
          : null,
      pressure_bar:
        ensemble === "NPT" ? existing.pressure_bar ?? 1.01325 : null,
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

        <main className="setup-main" ref={setupMain}>
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
                title="Choose calculators"
                description="Select one or more PQ methods. Each calculator creates its own input sequence."
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
              <div className="method-principle">
                <strong>One calculator per input</strong>
                <span>
                  Multiple selections create parallel variants of the same run
                  protocol.
                </span>
              </div>
              <div
                className="calculator-list"
                role="group"
                aria-label="Calculators"
              >
                {(bootstrap?.runners ?? [])
                  .filter((runner) => runner.supported)
                  .map((runner) => {
                    const selection = calculators.find(
                      (item) => item.runner_id === runner.id,
                    );
                    const selected = Boolean(selection);
                    const needsScript = [
                      "dftbplus",
                      "pyscf",
                      "turbomole",
                    ].includes(runner.id);
                    return (
                      <div
                        className={`calculator-option ${
                          selected ? "selected" : ""
                        }`}
                        key={runner.id}
                      >
                        <label>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleCalculator(runner.id)}
                          />
                          <span className="calculator-check" aria-hidden="true">
                            {selected && <Check size={12} />}
                          </span>
                          <span className="runner-name">
                            <strong>{runner.label}</strong>
                            <small>
                              {runner.detail}
                              {runner.version ? ` · ${runner.version}` : ""}
                            </small>
                          </span>
                          <span
                            className={`runner-state ${
                              runner.ready ? "ready" : "missing"
                            }`}
                          >
                            {runner.ready ? "Ready" : "Not detected"}
                          </span>
                        </label>
                        {selected && !runner.ready && (
                          <div className="calculator-warning" role="status">
                            <CircleAlert size={14} aria-hidden="true" />
                            <span>
                              Not detected on this system. PQSetup will still
                              create the inputs; configure this calculator
                              before running.
                            </span>
                          </div>
                        )}
                        {selected && needsScript && (
                          <div className="calculator-config">
                            <Field
                              label="Runner script"
                              help={`Leave blank to use ${DEFAULT_RUNNER_SCRIPTS[runner.id]}.`}
                            >
                              <input
                                value={selection?.runner_script ?? ""}
                                placeholder={DEFAULT_RUNNER_SCRIPTS[runner.id]}
                                onChange={(event) =>
                                  updateCalculatorScript(
                                    runner.id,
                                    event.target.value,
                                  )
                                }
                              />
                            </Field>
                          </div>
                        )}
                      </div>
                    );
                  })}
                {!bootstrap && (
                  <div className="runner-loading">
                    <LoaderCircle className="spin" size={18} />
                    Detecting calculators
                  </div>
                )}
              </div>
              <div className="batch-summary" aria-live="polite">
                <strong>{calculators.length}</strong>{" "}
                {calculators.length === 1 ? "calculator" : "calculators"}
                <span aria-hidden="true">·</span>
                <strong>{equilibration ? 2 : 1}</strong>{" "}
                {equilibration ? "stages" : "stage"}
                <span aria-hidden="true">·</span>
                <strong>{calculators.length * (equilibration ? 2 : 1)}</strong>{" "}
                input files
              </div>
              {calculators.length === 0 && (
                <div className="inline-warning" role="alert">
                  <CircleAlert size={15} aria-hidden="true" />
                  Select at least one calculator.
                </div>
              )}
            </section>
          )}

          {activeStep === "conditions" && (
            <section className="step-panel">
              <StepHeading
                eyebrow="03 · Conditions"
                title="Build the run protocol"
                description="Create one sampling run or continue from an NVT equilibration."
              />
              <div
                className="protocol-choice"
                role="radiogroup"
                aria-label="Run protocol"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!equilibration}
                  className={!equilibration ? "selected" : ""}
                  onClick={() => chooseProtocol(false)}
                >
                  <strong>Single sampling run</strong>
                  <small>One input from the prepared structure.</small>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={Boolean(equilibration)}
                  className={equilibration ? "selected" : ""}
                  onClick={() => chooseProtocol(true)}
                >
                  <strong>Equilibrate, then sample</strong>
                  <small>Two continued inputs with an NVT first stage.</small>
                </button>
              </div>
              <div className="stage-timeline">
                {equilibration && (
                  <>
                    <details className="protocol-stage equilibration-stage">
                      <summary>
                        <span className="stage-number">01</span>
                        <span className="stage-summary">
                          <strong>Equilibration</strong>
                          <small>NVT · fixed cell</small>
                        </span>
                        <span className="stage-duration">
                          {durationLabel(
                            equilibration.steps,
                            equilibration.timestep_fs,
                          )}
                        </span>
                        <ChevronDown size={17} aria-hidden="true" />
                      </summary>
                      <div className="stage-body">
                        <div className="form-grid stage-primary-grid">
                          <Field label="Target temperature" unit="K">
                            <input
                              type="number"
                              min="0.000001"
                              step="0.01"
                              value={equilibration.temperature_k}
                              onChange={(event) =>
                                updateEquilibration({
                                  temperature_k: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label="Timestep" unit="fs">
                            <input
                              type="number"
                              min="0.000001"
                              step="0.1"
                              value={equilibration.timestep_fs}
                              onChange={(event) =>
                                updateEquilibration({
                                  timestep_fs: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label="Steps">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={equilibration.steps}
                              onChange={(event) =>
                                updateEquilibration({
                                  steps: Number(event.target.value),
                                })
                              }
                            />
                          </Field>
                        </div>
                        <TemperatureCoupling
                          value={equilibration}
                          onChange={(patch) =>
                            updateEquilibration({
                              ...patch,
                              thermostat:
                                patch.thermostat ??
                                equilibration.thermostat,
                              thermostat_relaxation_ps:
                                patch.thermostat_relaxation_ps ??
                                equilibration.thermostat_relaxation_ps,
                            })
                          }
                        />
                        <TemperatureSchedule
                          value={equilibration}
                          onChange={updateEquilibration}
                        />
                      </div>
                    </details>
                    <div className="stage-connection">
                      <Link2 size={14} aria-hidden="true" />
                      Sampling starts from the equilibration restart
                    </div>
                  </>
                )}

                <section className="protocol-stage sampling-stage">
                  <header className="sampling-heading">
                    <span className="stage-number">
                      {equilibration ? "02" : "01"}
                    </span>
                    <span className="stage-summary">
                      <strong>Sampling</strong>
                      <small>{setup.ensemble} ensemble</small>
                    </span>
                    <span className="stage-duration">
                      {durationLabel(setup.steps, setup.timestep_fs)}
                    </span>
                  </header>
                  <div className="stage-body">
                    <fieldset className="ensemble-fieldset">
                      <legend>Sampling ensemble</legend>
                      <div role="radiogroup" aria-label="Sampling ensemble">
                        {(
                          [
                            ["NVE", "Energy"],
                            ["NVT", "Temperature"],
                            ["NPT", "Temperature + pressure"],
                          ] as const
                        ).map(([ensemble, controlled]) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={setup.ensemble === ensemble}
                            className={
                              setup.ensemble === ensemble ? "selected" : ""
                            }
                            key={ensemble}
                            onClick={() => chooseSamplingEnsemble(ensemble)}
                          >
                            <strong>{ensemble}</strong>
                            <small>{controlled}</small>
                          </button>
                        ))}
                      </div>
                      <p>
                        {setup.ensemble === "NVE"
                          ? "Fixed particle number, volume, and total energy."
                          : setup.ensemble === "NVT"
                            ? "Fixed particle number and volume with temperature coupling."
                            : "Fixed particle number with temperature and pressure coupling."}
                      </p>
                    </fieldset>

                    <div className="form-grid stage-primary-grid">
                      <Field
                        label={
                          setup.ensemble === "NVE"
                            ? "Initial temperature"
                            : "Target temperature"
                        }
                        unit="K"
                      >
                        <input
                          type="number"
                          min="0.000001"
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
                          label="Target pressure"
                          unit="bar"
                          help="1 atm = 1.01325 bar; negative values model tension."
                        >
                          <input
                            type="number"
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
                          min="0.000001"
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
                    </div>

                    {(setup.ensemble === "NVT" ||
                      setup.ensemble === "NPT") && (
                      <>
                        <TemperatureCoupling
                          value={setup}
                          onChange={(patch) =>
                            setSetup((existing) => ({
                              ...existing,
                              preset_id: null,
                              ...patch,
                            }))
                          }
                        />
                        <TemperatureSchedule
                          value={setup}
                          onChange={(patch) =>
                            setSetup((existing) => ({
                              ...existing,
                              preset_id: null,
                              ...patch,
                            }))
                          }
                        />
                      </>
                    )}
                    {setup.ensemble === "NPT" && (
                      <PressureCoupling
                        value={setup}
                        onChange={(patch) =>
                          setSetup((existing) => ({
                            ...existing,
                            preset_id: null,
                            ...patch,
                          }))
                        }
                      />
                    )}
                  </div>
                </section>
                <button
                  type="button"
                  className="add-stage"
                  onClick={() => chooseProtocol(!equilibration)}
                >
                  {equilibration ? (
                    "Remove equilibration"
                  ) : (
                    <>
                      <Plus size={15} aria-hidden="true" />
                      Add NVT equilibration
                    </>
                  )}
                </button>
              </div>
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
                title="Review the inputs"
                description="Check every calculator and continued stage before creating the run package."
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
              <div className="review-summary" aria-live="polite">
                <span>
                  <strong>{rendered?.files.length ?? 0}</strong>{" "}
                  {rendered?.files.length === 1 ? "input file" : "input files"}
                </span>
                <span>
                  <strong>{calculators.length}</strong>{" "}
                  {calculators.length === 1 ? "calculator" : "calculators"}
                </span>
                <span>
                  <strong>{equilibration ? 2 : 1}</strong>{" "}
                  {equilibration ? "stages" : "stage"}
                </span>
              </div>
              {rendered && rendered.files.length > 0 && (
                <div className="generated-files" aria-label="Generated inputs">
                  {Array.from(
                    new Map(
                      rendered.files.map((file) => [
                        file.calculator_id,
                        file.calculator_label,
                      ]),
                    ),
                  ).map(([calculatorId, calculatorLabel]) => (
                    <section key={calculatorId}>
                      <header>{calculatorLabel}</header>
                      <div role="tablist" aria-label={`${calculatorLabel} files`}>
                        {rendered.files
                          .filter(
                            (file) => file.calculator_id === calculatorId,
                          )
                          .map((file) => {
                            const key = `${file.calculator_id}:${file.name}`;
                            const active = selectedFileKey === key;
                            return (
                              <button
                                type="button"
                                role="tab"
                                aria-selected={active}
                                className={active ? "selected" : ""}
                                key={key}
                                onClick={() => setSelectedFileKey(key)}
                              >
                                <span className="file-sequence">
                                  {file.stage_index > 1 ? (
                                    <Link2 size={13} aria-hidden="true" />
                                  ) : (
                                    <span>{String(file.stage_index).padStart(2, "0")}</span>
                                  )}
                                </span>
                                <span>
                                  <strong>{file.name}</strong>
                                  <small>{file.stage_label}</small>
                                </span>
                                <CheckCircle2 size={15} aria-hidden="true" />
                              </button>
                            );
                          })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
              <div className="input-preview">
                <div className="preview-title">
                  <span>
                    <FileCode2 size={16} />
                    {selectedFile?.name ?? "Preparing inputs…"}
                  </span>
                  {rendering && <LoaderCircle className="spin" size={15} />}
                </div>
                {selectedFile && (
                  <div className="preview-continuation">
                    <span>
                      Starts from <strong>{selectedFile.start_file}</strong>
                    </span>
                    <ArrowRight size={13} aria-hidden="true" />
                    <span>
                      writes <strong>{selectedFile.restart_file}</strong>
                    </span>
                  </div>
                )}
                <pre>
                  <code>
                    {selectedFile?.input_text ||
                      rendered?.diagnostics[0]?.message ||
                      "Preparing inputs…"}
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
                {exporting
                  ? "Creating package…"
                  : `Create package · ${rendered?.files.length ?? 0} ${
                      rendered?.files.length === 1 ? "input" : "inputs"
                    }`}
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
                {errorCount}
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
                  calculators.length > 0 && missingCalculatorCount === 0
                    ? "ok"
                    : "warn"
                }
              >
                <StatusDot
                  status={
                    calculators.length > 0 && missingCalculatorCount === 0
                      ? "ok"
                      : calculators.length
                        ? "warn"
                        : "idle"
                  }
                />
                <span>
                  <strong>Calculators</strong>
                  <small>
                    {calculators.length === 0
                      ? "Choose at least one calculator."
                      : missingCalculatorCount
                        ? `${calculators.length} selected · ${missingCalculatorCount} not detected.`
                        : `${calculators.length} selected and ready.`}
                  </small>
                </span>
              </li>
              <li className={rendered?.valid ? "ok" : "warn"}>
                <StatusDot
                  status={rendered?.valid ? "ok" : rendered ? "warn" : "idle"}
                />
                <span>
                  <strong>PQ inputs</strong>
                  <small>
                    {rendered?.valid
                      ? `${rendered.files.length} input ${
                          rendered.files.length === 1 ? "file" : "files"
                        } ready.`
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
                          : item.code.startsWith("runner") ||
                              item.code.startsWith("calculator") ||
                              item.code.startsWith("pq.")
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
              Create package
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
