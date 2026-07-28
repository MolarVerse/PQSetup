import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CircleDashed,
  Download,
  FileCode2,
  Keyboard,
  Link2,
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
  renderPlan,
} from "./api";
import CommandPalette, { type Command } from "./CommandPalette";
import ChemicalFormula from "./ChemicalFormula";
import {
  MANOSTATS,
  PRESSURE_ISOTROPIES,
  THERMOSTATS,
} from "./conditionOptions";
import { diagnosticStep } from "./diagnosticNavigation";
import {
  activeSetupFiles,
  defaultSetupFileName,
  missingSetupFileRoles,
  MM_MODES,
  mmModeLabel,
  setupFileSpecs,
} from "./method";
import {
  commitContinuedSamplingRunCountDraft,
  compactRunFileNames,
  DEFAULT_CONTINUED_SAMPLING_RUNS,
  MAX_SAMPLING_RUNS,
  nextPlannedInputSelection,
  parseContinuedSamplingRunCountDraft,
  plannedInputOptionLabel,
  samplingLabel,
  samplingOutputMode,
  samplingRunCountForMode,
  samplingRunSummary,
  type SamplingOutputMode,
} from "./runPlan";
import StructureViewer from "./StructureViewer";
import type {
  Bootstrap,
  Diagnostic,
  Ensemble,
  EquilibrationStage,
  MMForceFieldMode,
  PlanRenderResult,
  PreparationMetadata,
  SetupFile,
  SetupFileRole,
  SimulationSetup,
  StructureAnalysis,
} from "./types";

const STEPS = [
  { id: "system", label: "System", hint: "Structure" },
  { id: "method", label: "Method", hint: "Interaction" },
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
  mm_force_field: "off",
  density_g_cm3: null,
  coulomb_cutoff_angstrom: 12.5,
  moldescriptor_file: null,
  guff_file: null,
  topology_file: null,
  parameter_file: null,
  intra_nonbonded_file: null,
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

function isMolecularMechanics(setup: SimulationSetup): boolean {
  return setup.job_type === "mm-md" || setup.job_type === "mm-opt";
}

function withMMFileNames(
  setup: SimulationSetup,
  mode: MMForceFieldMode,
): SimulationSetup {
  return {
    ...setup,
    mm_force_field: mode,
    moldescriptor_file:
      setup.moldescriptor_file ?? defaultSetupFileName("moldescriptor"),
    guff_file:
      mode === "off" || mode === "bonded"
        ? setup.guff_file ?? defaultSetupFileName("guff")
        : setup.guff_file,
    topology_file:
      mode === "on" || mode === "bonded"
        ? setup.topology_file ?? defaultSetupFileName("topology")
        : setup.topology_file,
    parameter_file:
      mode === "on" || mode === "bonded"
        ? setup.parameter_file ?? defaultSetupFileName("parameter")
        : setup.parameter_file,
  };
}

function withSetupFileName(
  setup: SimulationSetup,
  role: SetupFileRole,
  name: string,
): SimulationSetup {
  if (role === "moldescriptor") {
    return { ...setup, moldescriptor_file: name };
  }
  if (role === "guff") return { ...setup, guff_file: name };
  if (role === "topology") return { ...setup, topology_file: name };
  if (role === "parameter") return { ...setup, parameter_file: name };
  return { ...setup, intra_nonbonded_file: name };
}

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
  controlId,
  children,
}: {
  label: ReactNode;
  unit?: string;
  help?: string;
  info?: string;
  controlId?: string;
  children: ReactElement<{ id?: string }>;
}) {
  const generatedFieldId = useId();
  const fieldId = controlId ?? generatedFieldId;
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
  controlId,
}: {
  value: ThermostatSettings;
  onChange: (patch: Partial<ThermostatSettings>) => void;
  controlId?: string;
}) {
  return (
    <section className="coupling-section" aria-label="Temperature coupling">
      <div className="section-rule-heading">
        <strong>Temperature coupling</strong>
        <span>Thermostat</span>
      </div>
      <div className="form-grid coupling-grid">
        <Field label="Thermostat" controlId={controlId}>
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
          <Field
            label="Relaxation time"
            unit="ps"
            help="PQ default: 0.1 ps."
          >
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
          <Field label="Friction" unit="ps⁻¹" help="PQ default: 0.1 ps⁻¹.">
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
            <Field label="Chain length" help="PQ default: 3.">
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
            <Field
              label="Coupling frequency"
              unit="cm⁻¹"
              help="PQ default: 1000 cm⁻¹."
            >
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
  controlId,
}: {
  value: ManostatSettings;
  onChange: (patch: Partial<ManostatSettings>) => void;
  controlId?: string;
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
          controlId={controlId}
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
        <Field
          label="Relaxation time"
          unit="ps"
          help="PQ default: 1 ps."
        >
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
        <Field
          label="Compressibility"
          unit="bar⁻¹"
          help="PQ water default: 4.591 × 10⁻⁵ bar⁻¹; adjust for the material."
        >
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
        <Field label="Cell response" help="PQ default: isotropic.">
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
  const [setupFiles, setSetupFiles] = useState<SetupFile[]>([]);
  const [equilibration, setEquilibration] =
    useState<EquilibrationStage | null>(null);
  const [samplingRunCount, setSamplingRunCount] = useState(1);
  const [samplingRunCountDraft, setSamplingRunCountDraft] = useState("1");
  const [rendered, setRendered] = useState<PlanRenderResult | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [perturbing, setPerturbing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [jitter, setJitter] = useState(false);
  const [sigma, setSigma] = useState(0.01);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const searchShortcut =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? "⌘ K"
      : "Ctrl K";
  const runShortcut = searchShortcut.startsWith("⌘") ? "⌘ Enter" : "Ctrl Enter";
  const [notice, setNotice] = useState<{
    kind: "error" | "success" | "info";
    message: string;
  } | null>(null);
  const generatedInputSelectId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const workflowNav = useRef<HTMLElement>(null);
  const workflowStepButtons = useRef<
    Partial<Record<StepId, HTMLButtonElement | null>>
  >({});
  const setupMain = useRef<HTMLElement>(null);
  const renderSequence = useRef(0);
  const uploadSequence = useRef(0);
  const perturbSequence = useRef(0);
  const firstGeneratedFileName = useRef<string | null>(null);
  const lastContinuedSamplingRunCount = useRef(
    DEFAULT_CONTINUED_SAMPLING_RUNS,
  );
  const molecularMechanics = isMolecularMechanics(setup);
  const methodSetupFiles = useMemo(
    () =>
      molecularMechanics
        ? activeSetupFiles(setup.mm_force_field, setupFiles)
        : [],
    [molecularMechanics, setup.mm_force_field, setupFiles],
  );
  const setupFileReferences = useMemo(
    () =>
      methodSetupFiles.map(({ role, name, content }) => ({
        role,
        name,
        content: role === "moldescriptor" ? content : null,
      })),
    [methodSetupFiles],
  );

  useEffect(() => {
    setupMain.current?.scrollTo({ top: 0, left: 0 });
  }, [activeStep]);

  useEffect(() => {
    function revealActiveStep() {
      if (!window.matchMedia("(max-width: 720px)").matches) return;
      window.requestAnimationFrame(() => {
        const navigation = workflowNav.current;
        const button = workflowStepButtons.current[activeStep];
        if (!navigation || !button) return;
        const left =
          button.offsetLeft +
          button.offsetWidth / 2 -
          navigation.clientWidth / 2;
        navigation.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
      });
    }

    revealActiveStep();
    window.addEventListener("resize", revealActiveStep);
    return () => window.removeEventListener("resize", revealActiveStep);
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
          setSetup((existing) =>
            isMolecularMechanics(existing) || existing.runner
              ? existing
              : { ...existing, runner: preferred.id },
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
      renderPlan(
        setup,
        equilibration,
        samplingRunCount,
        setupFileReferences,
        analysis.structure,
        )
        .then((result) => {
          if (sequence !== renderSequence.current) return;
          const previousFirstName = firstGeneratedFileName.current;
          firstGeneratedFileName.current = result.files[0]?.name ?? null;
          setRendered(result);
          setSelectedFileKey((current) =>
            nextPlannedInputSelection(
              current,
              previousFirstName,
              result.files,
            ),
          );
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
  }, [
    analysis.structure,
    equilibration,
    samplingRunCount,
    setup,
    setupFileReferences,
  ]);

  const selectedRunnerStatus = useMemo(
    () =>
      bootstrap?.runners.find((runner) => runner.id === setup.runner) ?? null,
    [bootstrap, setup.runner],
  );
  const selectedFile = useMemo(
    () =>
      rendered?.files.find((file) => file.name === selectedFileKey) ??
      rendered?.files[0] ??
      null,
    [rendered, selectedFileKey],
  );
  const selectedFileIndex =
    rendered?.files.findIndex((file) => file.name === selectedFile?.name) ?? -1;
  const equilibrationFiles = useMemo(
    () =>
      rendered?.files.filter((file) => file.stage_id === "equilibration") ?? [],
    [rendered],
  );
  const samplingFiles = useMemo(
    () => rendered?.files.filter((file) => file.stage_id === "sampling") ?? [],
    [rendered],
  );
  const selectedMethodLabel = molecularMechanics
    ? `Molecular mechanics · ${mmModeLabel(setup.mm_force_field)}`
    : selectedRunnerStatus?.label ?? setup.runner ?? "Not selected";
  const mmFileSpecs = useMemo(
    () => setupFileSpecs(setup.mm_force_field),
    [setup.mm_force_field],
  );
  const missingMMFiles = useMemo(
    () => missingSetupFileRoles(setup.mm_force_field, methodSetupFiles),
    [methodSetupFiles, setup.mm_force_field],
  );
  const hasTypedMolecules = analysis.structure.atoms.some(
    (atom) => atom.molecule_type > 0,
  );
  const mmDensityReady =
    !analysis.structure.cell_generated ||
    Boolean(setup.density_g_cm3 && setup.density_g_cm3 > 0);
  const calculatorMissing = Boolean(
    !molecularMechanics &&
      bootstrap &&
      setup.runner &&
      !selectedRunnerStatus?.ready,
  );
  const methodReady = molecularMechanics
    ? hasTypedMolecules && mmDensityReady && missingMMFiles.length === 0
    : Boolean(setup.runner);
  const samplingTotalSteps =
    setup.steps == null ? null : setup.steps * samplingRunCount;
  const samplingMode = samplingOutputMode(samplingRunCount);
  const runFileNames = useMemo(
    () => compactRunFileNames(Boolean(equilibration), samplingRunCount),
    [equilibration, samplingRunCount],
  );

  const generatedCellNpt =
    !molecularMechanics &&
    analysis.structure.cell_generated &&
    setup.ensemble === "NPT";

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
    [
      analysis.diagnostics,
      generatedCellNpt,
      rendered?.diagnostics,
    ],
  );
  const displayedDiagnostics = useMemo(
    () =>
      diagnostics.filter((item) => item.code !== "structure.cell_generated"),
    [diagnostics],
  );

  const errorCount = diagnostics.filter(
    (item) => item.severity === "error",
  ).length;
  const ready = Boolean(
    analysis.valid &&
      !generatedCellNpt &&
      rendered?.valid &&
      methodReady &&
      errorCount === 0,
  );

  const stepState = useMemo<Record<StepId, "ok" | "warn" | "idle">>(
    () => ({
      system: analysis.valid ? "ok" : "warn",
      method: !methodReady || calculatorMissing ? "warn" : "ok",
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
      calculatorMissing,
      diagnostics,
      methodReady,
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
        equilibration,
        samplingRunCount,
        methodSetupFiles,
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
    equilibration,
    exporting,
    methodSetupFiles,
    preparation,
    ready,
    samplingRunCount,
    setup,
  ]);

  const commands = useMemo<Command[]>(() => {
    const activeIndex = STEPS.findIndex((step) => step.id === activeStep);
    const nextStep =
      activeIndex < STEPS.length - 1 ? STEPS[activeIndex + 1] : null;
    const seenDiagnostics = new Set<string>();
    const problemCommands = displayedDiagnostics
      .filter((item) => item.severity !== "info")
      .filter((item) => {
        const key = `${item.code}:${item.message}`;
        if (seenDiagnostics.has(key)) return false;
        seenDiagnostics.add(key);
        return true;
      })
      .map(
        (item, index): Command => ({
          id: `problem-${item.code}-${index}`,
          group: "Problems",
          label: item.severity === "error" ? "Fix input error" : "Review warning",
          detail: item.message,
          keywords: [item.code, item.message, "preflight", "diagnostic"],
          featured: index < 2,
          run: () => goToControl(diagnosticStep(item.code)),
        }),
      );

    return [
      ...(nextStep
        ? [
            {
              id: "continue",
              group: "Suggested" as const,
              label: `Continue to ${nextStep.label}`,
              detail: nextStep.hint,
              keywords: ["next", "continue", "workflow"],
              featured: true,
              run: () => goToControl(nextStep.id),
            },
          ]
        : []),
      ...problemCommands,
      ...STEPS.map(
        (step, index): Command => ({
          id: `step-${step.id}`,
          group: "Workflow",
          label: step.label,
          detail: step.hint,
          hint: `Alt ${index + 1}`,
          keywords: [
            "go",
            "open",
            step.id === "system" ? "structure atoms cell" : "",
            step.id === "method" ? "calculator engine force field" : "",
            step.id === "conditions"
              ? "protocol ensemble sampling thermostat manostat"
              : "",
            step.id === "prepare" ? "coordinates jitter perturb symmetry" : "",
            step.id === "review" ? "inputs files preview package" : "",
          ],
          current: activeStep === step.id,
          run: () => goToControl(step.id),
        }),
      ),
      {
        id: "model-qm",
        group: "Scientific setup",
        label: "Use quantum mechanics",
        detail: "External electronic-structure calculator",
        keywords: ["qm", "quantum", "electronic structure", "calculator"],
        current: !molecularMechanics,
        run: () => {
          chooseInteractionModel("qm");
          goToControl("method");
          setNotice({ kind: "success", message: "Quantum mechanics selected." });
        },
      },
      {
        id: "model-mm",
        group: "Scientific setup",
        label: "Use molecular mechanics",
        detail: "GUFF or classical force field",
        keywords: ["mm", "molecular mechanics", "force field", "classical"],
        current: molecularMechanics,
        run: () => {
          chooseInteractionModel("mm");
          goToControl("method");
          setNotice({
            kind: "success",
            message: "Molecular mechanics selected.",
          });
        },
      },
      ...(bootstrap?.runners ?? [])
        .filter((runner) => runner.supported)
        .map(
          (runner): Command => ({
            id: `calculator-${runner.id}`,
            group: "Scientific setup",
            label: runner.label,
            detail: runner.ready
              ? "Calculator ready"
              : `${runner.detail} Inputs can still be created.`,
            keywords: [
              "calculator",
              "runner",
              "engine",
              runner.id,
              runner.label,
            ],
            current: !molecularMechanics && setup.runner === runner.id,
            run: () => {
              chooseCalculator(runner.id);
              goToControl("method");
              setNotice({
                kind: runner.ready ? "success" : "info",
                message: runner.ready
                  ? `${runner.label} selected.`
                  : `${runner.label} selected but was not detected.`,
              });
            },
          }),
        ),
      ...MM_MODES.map(
        (option): Command => ({
          id: `mm-mode-${option.value}`,
          group: "Scientific setup",
          label: option.label,
          detail: option.description,
          keywords: ["molecular mechanics", "force field", "guff"],
          current:
            molecularMechanics && setup.mm_force_field === option.value,
          run: () => {
            chooseMMMode(option.value);
            goToControl("method");
            setNotice({
              kind: "success",
              message: `${option.label} selected.`,
            });
          },
        }),
      ),
      ...(["NVE", "NVT", "NPT"] as const).map(
        (ensemble): Command => ({
          id: `ensemble-${ensemble.toLowerCase()}`,
          group: "Scientific setup",
          label: `Use ${ensemble} sampling`,
          detail:
            ensemble === "NVE"
              ? "Fixed energy and volume"
              : ensemble === "NVT"
                ? "Fixed temperature and volume"
                : "Fixed temperature and pressure",
          keywords:
            ensemble === "NVE"
              ? ["microcanonical", "energy", "fixed volume"]
              : ensemble === "NVT"
                ? ["canonical", "temperature", "fixed volume"]
                : [
                    "isobaric",
                    "pressure",
                    "barostat",
                    "manostat",
                    "pressure coupling",
                  ],
          current: setup.ensemble === ensemble,
          disabledReason:
            ensemble === "NPT" &&
            !molecularMechanics &&
            analysis.structure.cell_generated
              ? "NPT needs a physical periodic cell."
              : undefined,
          run: () => {
            chooseSamplingEnsemble(ensemble);
            goToControl("conditions");
            setNotice({
              kind: "success",
              message: `Sampling ensemble set to ${ensemble}.`,
            });
          },
        }),
      ),
      {
        id: "protocol-equilibration",
        group: "Scientific setup",
        label: "Include NVT equilibration",
        detail: "Write run-eq.in before sampling",
        keywords: ["eq", "equilibrate", "warmup", "prepare"],
        current: Boolean(equilibration),
        run: () => {
          chooseProtocol(true);
          goToControl("conditions");
          setNotice({ kind: "success", message: "Equilibration included." });
        },
      },
      {
        id: "protocol-no-equilibration",
        group: "Scientific setup",
        label: "Skip equilibration",
        detail: "Start directly with sampling",
        keywords: ["no eq", "sampling only"],
        current: !equilibration,
        run: () => {
          chooseProtocol(false);
          goToControl("conditions");
          setNotice({ kind: "success", message: "Equilibration skipped." });
        },
      },
      {
        id: "sampling-single",
        group: "Scientific setup",
        label: "Use one sampling input",
        detail: "Write a single run-01.in",
        keywords: ["single", "one file", "sampling output"],
        current: samplingMode === "single",
        run: () => {
          chooseSamplingOutputMode("single");
          goToControl("conditions", "sampling-steps");
          setNotice({ kind: "success", message: "One sampling input selected." });
        },
      },
      {
        id: "sampling-continued",
        group: "Scientific setup",
        label: "Split into continued inputs",
        detail: "Write linked 01, 02, 03… inputs",
        keywords: [
          "multiple",
          "continued",
          "continuation",
          "split",
          "segments",
          "number of inputs",
        ],
        current: samplingMode === "continued",
        run: () => {
          chooseSamplingOutputMode("continued");
          goToControl("conditions", "sampling-run-count");
          setNotice({
            kind: "success",
            message: "Continued sampling inputs selected.",
          });
        },
      },
      ...THERMOSTATS.map(
        (option): Command => ({
          id: `thermostat-${option.value}`,
          group: "Scientific setup",
          label: option.label,
          detail: option.description,
          keywords: [
            "thermostat",
            "temperature coupling",
            option.value,
            option.value === "nh-chain" ? "nose hoover" : "",
            option.value === "velocity_rescaling"
              ? "svr stochastic velocity rescaling"
              : "",
          ],
          current:
            setup.ensemble !== "NVE" && setup.thermostat === option.value,
          run: () => {
            chooseThermostat(option.value);
            goToControl("conditions", "sampling-thermostat");
            setNotice({
              kind: "success",
              message: `${option.label} thermostat selected.`,
            });
          },
        }),
      ),
      ...MANOSTATS.map(
        (option): Command => ({
          id: `manostat-${option.value}`,
          group: "Scientific setup",
          label: `${option.label} manostat`,
          detail: option.description,
          keywords: [
            "manostat",
            "barostat",
            "pressure coupling",
            option.value,
          ],
          current:
            setup.ensemble === "NPT" && setup.manostat === option.value,
          disabledReason:
            !molecularMechanics && analysis.structure.cell_generated
              ? "Pressure coupling needs a physical periodic cell."
              : undefined,
          run: () => {
            chooseManostat(option.value);
            goToControl("conditions", "sampling-manostat");
            setNotice({
              kind: "success",
              message: `${option.label} manostat selected.`,
            });
          },
        }),
      ),
      {
        id: "parameter-temperature",
        group: "Parameters",
        label: "Target temperature",
        detail: `${setup.temperature_k ?? "Not set"} K`,
        keywords: ["temperature", "kelvin", "heat", "initial temperature"],
        run: () => goToControl("conditions", "sampling-temperature"),
      },
      {
        id: "parameter-pressure",
        group: "Parameters",
        label: "Target pressure",
        detail: `${setup.pressure_bar ?? 1.01325} bar`,
        keywords: ["pressure", "atm", "bar", "isobaric"],
        disabledReason:
          !molecularMechanics && analysis.structure.cell_generated
            ? "Pressure needs a physical periodic cell."
            : undefined,
        run: () => {
          chooseSamplingEnsemble("NPT");
          goToControl("conditions", "sampling-pressure");
        },
      },
      {
        id: "parameter-timestep",
        group: "Parameters",
        label: "Sampling timestep",
        detail: `${setup.timestep_fs ?? "Not set"} fs`,
        keywords: ["time step", "dt", "integration"],
        run: () => goToControl("conditions", "sampling-timestep"),
      },
      {
        id: "parameter-steps",
        group: "Parameters",
        label: samplingMode === "single" ? "Sampling steps" : "Steps per input",
        detail: `${setup.steps?.toLocaleString() ?? "Not set"} steps`,
        keywords: ["length", "duration", "sampling", "steps per input"],
        run: () => goToControl("conditions", "sampling-steps"),
      },
      ...(samplingMode === "continued"
        ? [
            {
              id: "parameter-input-count",
              group: "Parameters" as const,
              label: "Number of sampling inputs",
              detail: `${samplingRunCount} linked inputs · maximum ${MAX_SAMPLING_RUNS}`,
              keywords: ["segments", "files", "split", "continued", "count"],
              run: () =>
                goToControl("conditions", "sampling-run-count"),
            },
          ]
        : []),
      {
        id: "parameter-thermostat",
        group: "Parameters",
        label: "Thermostat settings",
        detail: thermostatDescription(setup.thermostat),
        keywords: [
          "temperature coupling",
          "relaxation",
          "friction",
          "nose hoover",
          "svr",
        ],
        run: () => {
          if (setup.ensemble === "NVE") chooseSamplingEnsemble("NVT");
          goToControl("conditions", "sampling-thermostat");
        },
      },
      {
        id: "parameter-manostat",
        group: "Parameters",
        label: "Manostat settings",
        detail: "Pressure coupling, also called a barostat",
        keywords: [
          "barostat",
          "pressure coupling",
          "compressibility",
          "cell response",
        ],
        disabledReason:
          !molecularMechanics && analysis.structure.cell_generated
            ? "Pressure coupling needs a physical periodic cell."
            : undefined,
        run: () => {
          chooseSamplingEnsemble("NPT");
          goToControl("conditions", "sampling-manostat");
        },
      },
      {
        id: "parameter-density",
        group: "Parameters",
        label: "System density",
        detail: "Molecular mechanics cell construction",
        keywords: ["density", "g cm", "box", "volume"],
        disabledReason: !molecularMechanics
          ? "Available for molecular mechanics."
          : !analysis.structure.cell_generated
            ? "The imported structure already has a physical cell."
            : undefined,
        run: () => goToControl("method", "mm-density"),
      },
      {
        id: "parameter-cutoff",
        group: "Parameters",
        label: "Coulomb cutoff",
        detail: `${setup.coulomb_cutoff_angstrom} Å`,
        keywords: ["electrostatic", "nonbonded", "angstrom"],
        disabledReason: !molecularMechanics
          ? "Available for molecular mechanics."
          : undefined,
        run: () => goToControl("method", "mm-cutoff"),
      },
      {
        id: "parameter-jitter",
        group: "Parameters",
        label: "Position perturbation",
        detail: "Seeded Gaussian symmetry breaking",
        keywords: ["jitter", "sigma", "gaussian", "crystal", "symmetry", "random"],
        disabledReason: !sourceFile
          ? "Import a structure before perturbing coordinates."
          : undefined,
        run: () => {
          setJitter(true);
          goToControl("prepare", "position-sigma");
        },
      },
      ...(rendered?.files ?? []).map(
        (file): Command => ({
          id: `input-${file.name}`,
          group: "Inputs",
          label: file.name,
          detail:
            file.stage_id === "equilibration"
              ? "Equilibration input"
              : `Sampling input ${file.segment_index}`,
          keywords: [
            "generated input",
            "preview",
            file.stage_id === "equilibration" ? "eq equilibrium" : "sampling",
          ],
          run: () => {
            setSelectedFileKey(file.name);
            goToControl("review", "generated-input-preview");
          },
        }),
      ),
      {
        id: "import",
        group: "Actions",
        label: "Import a structure",
        detail: "RST, CIF, XYZ, PDB, MOL, SDF, TRAJ",
        keywords: [
          "open",
          "upload",
          "file",
          "rst",
          "cif",
          "xyz",
          "pdb",
          "mol",
          "sdf",
          "traj",
          "extxyz",
        ],
        featured: true,
        run: openFilePicker,
      },
      {
        id: "create",
        group: "Actions",
        label: "Create run package",
        detail: "Export inputs, run script, structure, and manifest",
        hint: runShortcut,
        keywords: ["export", "zip", "download", "inputs", "run script"],
        featured: true,
        disabledReason: rendering
          ? "Inputs are still validating."
          : !ready
            ? "Resolve preflight issues first."
            : undefined,
        run: () => void createRun(),
      },
    ];
  }, [
    activeStep,
    analysis.structure.cell_generated,
    bootstrap,
    createRun,
    displayedDiagnostics,
    equilibration,
    molecularMechanics,
    openFilePicker,
    ready,
    rendered?.files,
    rendering,
    runShortcut,
    samplingMode,
    samplingRunCount,
    setup,
    sourceFile,
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.matches("input, textarea, select, [contenteditable=true]") ??
        false;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
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
        density_g_cm3:
          isMolecularMechanics(existing) && result.structure.cell_generated
            ? existing.density_g_cm3 ?? 1
            : existing.density_g_cm3,
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

  function chooseCalculator(runnerId: string) {
    setSetup((existing) => ({
      ...existing,
      job_type: "qm-md",
      runner: runnerId,
    }));
  }

  function chooseInteractionModel(model: "qm" | "mm") {
    if (model === "mm") {
      setSetup((existing) => ({
        ...withMMFileNames(existing, existing.mm_force_field),
        preset_id: null,
        job_type: "mm-md",
        runner: null,
        density_g_cm3:
          analysis.structure.cell_generated
            ? existing.density_g_cm3 ?? 1
            : existing.density_g_cm3,
      }));
      return;
    }

    const preferred =
      bootstrap?.runners.find((runner) => runner.id === "ase_xtb") ??
      bootstrap?.runners.find((runner) => runner.supported);
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      job_type: "qm-md",
      runner: existing.runner ?? preferred?.id ?? null,
    }));
  }

  function chooseMMMode(mode: MMForceFieldMode) {
    setSetup((existing) => ({
      ...withMMFileNames(existing, mode),
      preset_id: null,
      job_type: "mm-md",
      runner: null,
    }));
  }

  async function chooseSetupFile(
    role: SetupFileRole,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const content = await file.text();
      setSetupFiles((existing) => [
        ...existing.filter((item) => item.role !== role),
        { role, name: file.name, content },
      ]);
      setSetup((existing) => withSetupFileName(existing, role, file.name));
    } catch (error) {
      setNotice({ kind: "error", message: formatError(error) });
    }
  }

  function commitSamplingRunCount() {
    const count = commitContinuedSamplingRunCountDraft(
      samplingRunCountDraft,
      samplingRunCount,
    );
    lastContinuedSamplingRunCount.current = count;
    setSamplingRunCount(count);
    setSamplingRunCountDraft(String(count));
  }

  function chooseSamplingOutputMode(mode: SamplingOutputMode) {
    if (mode === samplingMode) return;
    if (samplingRunCount > 1) {
      lastContinuedSamplingRunCount.current = samplingRunCount;
    }
    const count = samplingRunCountForMode(
      mode,
      lastContinuedSamplingRunCount.current,
    );
    setSamplingRunCount(count);
    setSamplingRunCountDraft(String(count));
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

  function chooseThermostat(
    thermostat: (typeof THERMOSTATS)[number]["value"],
  ) {
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      ensemble: existing.ensemble === "NVE" ? "NVT" : existing.ensemble,
      thermostat,
    }));
  }

  function chooseManostat(manostat: (typeof MANOSTATS)[number]["value"]) {
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      ensemble: "NPT",
      thermostat: existing.thermostat ?? "velocity_rescaling",
      manostat,
      pressure_bar: existing.pressure_bar ?? 1.01325,
    }));
  }

  function goToControl(step: StepId, controlId?: string) {
    setActiveStep(step);
    if (!controlId) return;
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        const control = document.getElementById(controlId);
        const details = control?.closest("details");
        if (details instanceof HTMLDetailsElement) details.open = true;
        control?.scrollIntoView({ block: "center", behavior: "smooth" });
        if (
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLButtonElement ||
          control instanceof HTMLTextAreaElement
        ) {
          control.focus({ preventScroll: true });
        }
      });
    }, 0);
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
          aria-label={`Search setup, ${searchShortcut}`}
          onClick={() => setPaletteOpen(true)}
        >
          <Search size={16} aria-hidden="true" />
          <span>Search setup</span>
          <kbd>{searchShortcut}</kbd>
        </button>
        <div className="header-status">
          {bootstrap ? (
            <>
              <span
                className={
                  bootstrap.pq.found ? "status-ready" : "status-missing"
                }
                aria-label={`PQ ${
                  bootstrap.pq.found
                    ? bootstrap.pq.version ?? "detected"
                    : "not found"
                }`}
                title={`PQ ${
                  bootstrap.pq.found
                    ? bootstrap.pq.version ?? "detected"
                    : "not found"
                }`}
              >
                <span className="status-dot" aria-hidden="true" />
                <span className="status-text">
                  PQ{" "}
                  {bootstrap.pq.found
                    ? bootstrap.pq.version ?? "detected"
                    : "not found"}
                </span>
              </span>
              <span className="version">
                Schema {bootstrap.target_pq_release}
              </span>
            </>
          ) : bootstrapError ? (
            <span
              className="status-missing"
              aria-label="Backend unavailable"
              title="Backend unavailable"
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="status-text">Backend unavailable</span>
            </span>
          ) : (
            <span
              className="loading-label"
              aria-label="Checking system"
              title="Checking system"
            >
              <LoaderCircle size={15} className="spin" />
              <span className="status-text">Checking system</span>
            </span>
          )}
        </div>
      </header>

      <div className="workspace">
        <nav
          ref={workflowNav}
          className="workflow"
          aria-label="Setup workflow"
        >
          <div className="workflow-title">
            <span>Workflow</span>
            <Keyboard size={16} aria-label="Keyboard accessible" />
          </div>
          <ol>
            {STEPS.map((step, index) => (
              <li key={step.id}>
                <button
                  ref={(node) => {
                    workflowStepButtons.current[step.id] = node;
                  }}
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
                title="Choose the interaction model"
                description="Use one electronic-structure calculator or one molecular-mechanics model for the run sequence."
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
              <fieldset className="interaction-model-fieldset">
                <legend>Interaction model</legend>
                <div className="interaction-model-options">
                  <label className={!molecularMechanics ? "selected" : ""}>
                    <input
                      type="radio"
                      name="interaction-model"
                      checked={!molecularMechanics}
                      onChange={() => chooseInteractionModel("qm")}
                    />
                    <span>
                      <strong>Quantum mechanics</strong>
                      <small>External electronic-structure calculator</small>
                    </span>
                  </label>
                  <label className={molecularMechanics ? "selected" : ""}>
                    <input
                      type="radio"
                      name="interaction-model"
                      checked={molecularMechanics}
                      onChange={() => chooseInteractionModel("mm")}
                    />
                    <span>
                      <strong>Molecular mechanics</strong>
                      <small>GUFF or a classical force field</small>
                    </span>
                  </label>
                </div>
              </fieldset>

              {!molecularMechanics ? (
                <div className="method-content">
                  <div className="method-principle">
                    <strong>Calculator</strong>
                    <span>
                      Select the calculator required by the study. Missing local
                      software is reported but does not prevent setup.
                    </span>
                  </div>
                  <div
                    className="calculator-list"
                    role="radiogroup"
                    aria-label="Calculator"
                  >
                    {(bootstrap?.runners ?? [])
                      .filter((runner) => runner.supported)
                      .map((runner) => {
                        const selected = setup.runner === runner.id;
                        const runnerState = runner.ready
                          ? "ready"
                          : runner.installed
                            ? "incomplete"
                            : "missing";
                        return (
                          <div
                            className={`calculator-option ${
                              selected ? "selected" : ""
                            }`}
                            key={runner.id}
                          >
                            <label>
                              <input
                                type="radio"
                                name="calculator"
                                checked={selected}
                                onChange={() => chooseCalculator(runner.id)}
                              />
                              <span
                                className="calculator-radio"
                                aria-hidden="true"
                              >
                                {selected && <span />}
                              </span>
                              <span className="runner-name">
                                <strong>{runner.label}</strong>
                                <small>
                                  {runner.version
                                    ? `Version ${runner.version}`
                                    : runner.detail}
                                </small>
                              </span>
                              <span
                                className={`runner-state ${runnerState}`}
                              >
                                {runner.ready
                                  ? "Ready"
                                  : runner.installed
                                    ? "Setup incomplete"
                                    : "Not detected"}
                              </span>
                            </label>
                            {selected && !runner.ready && (
                              <div
                                className="calculator-warning"
                                role="status"
                              >
                                <CircleAlert size={14} aria-hidden="true" />
                                <span>
                                  {runner.detail} Inputs can still be created.
                                </span>
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
                  {!setup.runner && (
                    <div className="inline-warning" role="alert">
                      <CircleAlert size={15} aria-hidden="true" />
                      Select a calculator.
                    </div>
                  )}
                </div>
              ) : (
                <div className="method-content">
                  <div className="method-principle">
                    <strong>Force-field model</strong>
                    <span>
                      PQSetup packages supplied parameters unchanged. It does
                      not infer a force field from coordinates.
                    </span>
                  </div>
                  <fieldset className="mm-mode-fieldset">
                    <legend>Interaction terms</legend>
                    <div className="mm-mode-list">
                      {MM_MODES.map((option) => (
                        <label
                          className={
                            setup.mm_force_field === option.value
                              ? "selected"
                              : ""
                          }
                          key={option.value}
                        >
                          <input
                            type="radio"
                            name="mm-force-field"
                            checked={setup.mm_force_field === option.value}
                            onChange={() => chooseMMMode(option.value)}
                          />
                          <span>
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="form-grid mm-settings">
                    {analysis.structure.cell_generated && (
                      <Field
                        label="System density"
                        unit="g cm⁻³"
                        controlId="mm-density"
                        help="Required because the imported structure has no physical periodic cell. PQ uses the equivalent kg L⁻¹ value."
                      >
                        <input
                          type="number"
                          min="0.000001"
                          step="0.01"
                          value={setup.density_g_cm3 ?? ""}
                          onChange={(event) =>
                            setSetup((existing) => ({
                              ...existing,
                              density_g_cm3: event.target.value
                                ? Number(event.target.value)
                                : null,
                            }))
                          }
                        />
                      </Field>
                    )}
                    <Field
                      label="Coulomb cutoff"
                      unit="Å"
                      controlId="mm-cutoff"
                      help={
                        analysis.structure.cell_generated
                          ? "Must be below half the box length derived from the density."
                          : "Must fit inside half the shortest periodic box length."
                      }
                    >
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={setup.coulomb_cutoff_angstrom}
                        onChange={(event) =>
                          setSetup((existing) => ({
                            ...existing,
                            coulomb_cutoff_angstrom: Number(event.target.value),
                          }))
                        }
                      />
                    </Field>
                  </div>

                  {!hasTypedMolecules && (
                    <div className="inline-warning" role="alert">
                      <CircleAlert size={15} aria-hidden="true" />
                      Import a PQ restart with molecule type IDs for molecular
                      mechanics.
                    </div>
                  )}

                  <section
                    className="setup-files"
                    aria-labelledby="setup-files-title"
                  >
                    <div className="section-rule-heading">
                      <strong id="setup-files-title">Force-field files</strong>
                      <span>Included in the package</span>
                    </div>
                    <div className="setup-file-list">
                      {mmFileSpecs.map((spec) => {
                        const selected = setupFiles.find(
                          (file) => file.role === spec.role,
                        );
                        return (
                          <label
                            className={selected ? "selected" : ""}
                            key={spec.role}
                          >
                            <input
                              className="setup-file-input"
                              type="file"
                              onChange={(event) =>
                                void chooseSetupFile(spec.role, event)
                              }
                            />
                            <Upload size={16} aria-hidden="true" />
                            <span>
                              <strong>{spec.label}</strong>
                              <small>
                                {selected?.name ?? spec.defaultName}
                              </small>
                            </span>
                            <span
                              className={
                                selected
                                  ? "file-added"
                                  : spec.optional
                                    ? "file-optional"
                                    : "file-required"
                              }
                            >
                              {selected
                                ? "Added"
                                : spec.optional
                                  ? "Optional"
                                  : "Required"}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
            </section>
          )}

          {activeStep === "conditions" && (
            <section className="step-panel">
              <StepHeading
                eyebrow="03 · Conditions"
                title="Build the run protocol"
                description="Optionally equilibrate, then create one or more linked sampling files."
              />
              <div className="stage-timeline">
                <section
                  className={`optional-stage ${
                    equilibration ? "enabled" : ""
                  }`}
                  aria-label="Equilibration"
                >
                  <header className="optional-stage-heading">
                    <span className="stage-number stage-code">eq</span>
                    <span className="stage-summary">
                      <strong>Equilibration</strong>
                      <small>Optional NVT preparation</small>
                    </span>
                    <label className="stage-toggle">
                      <span>{equilibration ? "Included" : "Skip"}</span>
                        <input
                          type="checkbox"
                          aria-label="Include equilibration stage"
                          checked={Boolean(equilibration)}
                        onChange={(event) => chooseProtocol(event.target.checked)}
                      />
                      <span className="stage-toggle-track" aria-hidden="true">
                        <span />
                      </span>
                    </label>
                  </header>
                  {equilibration && (
                    <details className="stage-settings">
                      <summary>
                        <span>
                          <strong>Equilibration settings</strong>
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
                  )}
                </section>
                {equilibration && (
                  <>
                    <div className="stage-connection">
                      <Link2 size={14} aria-hidden="true" />
                      eq restart continues into sampling 01
                    </div>
                  </>
                )}

                <section className="protocol-stage sampling-stage">
                  <header className="sampling-heading">
                    <span
                      className={`stage-number ${
                        samplingRunCount > 1 ? "stage-range" : ""
                      }`}
                    >
                      {samplingRunCount > 1
                        ? `01–${samplingLabel(samplingRunCount)}`
                        : "01"}
                    </span>
                    <span className="stage-summary">
                      <strong>Sampling</strong>
                      <small>
                        {samplingRunSummary(
                          samplingRunCount,
                          Boolean(equilibration),
                        )}{" "}
                        · {setup.ensemble}
                      </small>
                    </span>
                    <span className="stage-duration">
                      {durationLabel(samplingTotalSteps, setup.timestep_fs)}
                    </span>
                  </header>
                  <div className="stage-body">
                    <section
                      className="sampling-plan"
                      aria-labelledby="sampling-files-title"
                    >
                      <div className="section-rule-heading">
                        <strong id="sampling-files-title">
                          Sampling files
                        </strong>
                        <span>Run layout</span>
                      </div>
                      <fieldset className="sampling-output-fieldset">
                        <legend>Write sampling as</legend>
                        <div className="sampling-output-modes">
                          <label
                            className={
                              samplingMode === "single" ? "selected" : ""
                            }
                          >
                            <input
                              type="radio"
                              name="sampling-output-mode"
                              value="single"
                              checked={samplingMode === "single"}
                              onChange={() =>
                                chooseSamplingOutputMode("single")
                              }
                            />
                            <span>
                              <strong>Single input</strong>
                              <small>One run-01.in</small>
                            </span>
                          </label>
                          <label
                            className={
                              samplingMode === "continued" ? "selected" : ""
                            }
                          >
                            <input
                              type="radio"
                              name="sampling-output-mode"
                              value="continued"
                              checked={samplingMode === "continued"}
                              onChange={() =>
                                chooseSamplingOutputMode("continued")
                              }
                            />
                            <span>
                              <strong>Split into continued inputs</strong>
                              <small>Numbered 01, 02, 03…</small>
                            </span>
                          </label>
                        </div>
                      </fieldset>
                      <p
                        className="sampling-output-description"
                        aria-live="polite"
                      >
                        {samplingMode === "single"
                          ? "Create one sampling input."
                          : `Create ${samplingRunCount} linked inputs. Each later input reads the previous restart.`}
                      </p>

                      <div
                        className={`form-grid sampling-length-grid ${samplingMode}`}
                      >
                        <Field
                          label={
                            samplingMode === "single"
                              ? "Steps"
                              : "Steps per input"
                          }
                          controlId="sampling-steps"
                        >
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
                        {samplingMode === "continued" && (
                          <Field
                            label="Number of inputs"
                            controlId="sampling-run-count"
                            help={`Linked inputs are numbered automatically. Maximum ${MAX_SAMPLING_RUNS}.`}
                          >
                            <input
                              type="number"
                              min="2"
                              max={MAX_SAMPLING_RUNS}
                              step="1"
                              inputMode="numeric"
                              value={samplingRunCountDraft}
                              onChange={(event) => {
                                const draft = event.target.value;
                                setSamplingRunCountDraft(draft);
                                const count =
                                  parseContinuedSamplingRunCountDraft(draft);
                                if (count !== null) {
                                  lastContinuedSamplingRunCount.current = count;
                                  setSamplingRunCount(count);
                                }
                              }}
                              onBlur={commitSamplingRunCount}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </Field>
                        )}
                      </div>

                      <div className="sampling-total" aria-live="polite">
                        <span>
                          <strong>{samplingRunCount}</strong>
                          {samplingRunCount === 1
                            ? "input file"
                            : "input files"}
                        </span>
                        <span>
                          <strong>
                            {setup.steps?.toLocaleString() ?? "—"}
                          </strong>
                          {samplingMode === "single"
                            ? "steps"
                            : "steps per input"}
                        </span>
                        <span>
                          <strong>
                            {durationLabel(
                              samplingTotalSteps,
                              setup.timestep_fs,
                            )}
                          </strong>
                          total sampling time
                        </span>
                      </div>

                      <div
                        className="filename-chain"
                        aria-label={`Run order: ${runFileNames.join(" then ")}`}
                      >
                        <span>Run order</span>
                        <div>
                          {runFileNames.map((name, index) => (
                            <span key={`${name}-${index}`}>
                              {index > 0 && (
                                <ArrowRight size={12} aria-hidden="true" />
                              )}
                              {name === "…" ? (
                                <b>…</b>
                              ) : (
                                <code>{name}</code>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </section>

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

                    <div className="form-grid sampling-condition-grid">
                      <Field
                        label={
                          setup.ensemble === "NVE"
                            ? "Initial temperature"
                            : "Target temperature"
                        }
                        unit="K"
                        controlId="sampling-temperature"
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
                          controlId="sampling-pressure"
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
                      <Field
                        label="Timestep"
                        unit="fs"
                        controlId="sampling-timestep"
                      >
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
                    </div>

                    {(setup.ensemble === "NVT" ||
                      setup.ensemble === "NPT") && (
                      <>
                        <TemperatureCoupling
                          value={setup}
                          controlId="sampling-thermostat"
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
                        controlId="sampling-manostat"
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
                      controlId="position-sigma"
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
                      controlId="position-seed"
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
                description="Check the input sequence before creating the run package."
              />
              <div className="form-grid review-fields">
                <Field label="Run name" controlId="run-name">
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
                <Field label="Start file" controlId="start-file">
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
                  <strong>{selectedMethodLabel}</strong> method
                </span>
                <span>
                  <strong>{samplingRunCount}</strong> sampling{" "}
                  {samplingRunCount === 1 ? "file" : "files"}
                  {equilibration ? " + eq" : ""}
                </span>
              </div>
              <section
                className="run-launcher"
                aria-labelledby="run-launcher-title"
              >
                <div>
                  <strong id="run-launcher-title">Run the package</strong>
                  <span>run.sh follows the generated input sequence.</span>
                </div>
                <pre>
                  <code>
                    {"./run.sh\nPQ_EXECUTABLE=/path/to/PQ ./run.sh"}
                  </code>
                </pre>
                <p>
                  Stops at the first failed input or when PQ does not report{" "}
                  <code>PQ ended normally</code>.
                </p>
              </section>
              {rendered && rendered.files.length > 0 && (
                <section
                  className="generated-inputs"
                  aria-labelledby="generated-inputs-title"
                >
                  <header>
                    <span>
                      <strong id="generated-inputs-title">
                        Generated inputs
                      </strong>
                      <small>{selectedMethodLabel}</small>
                    </span>
                    <span>
                      {rendered.files.length}{" "}
                      {rendered.files.length === 1 ? "file" : "files"}
                    </span>
                  </header>
                  {rendered.files.length === 1 ? (
                    <div className="single-input-file">
                      <FileCode2 size={16} aria-hidden="true" />
                      <span>
                        <strong>{selectedFile?.name}</strong>
                        <small>{selectedFile?.stage_label}</small>
                      </span>
                    </div>
                  ) : (
                    <div className="input-navigator">
                      <button
                        type="button"
                        aria-label="Previous input"
                        aria-controls="generated-input-preview"
                        disabled={selectedFileIndex <= 0}
                        onClick={() => {
                          if (selectedFileIndex <= 0) return;
                          setSelectedFileKey(
                            rendered.files[selectedFileIndex - 1].name,
                          );
                        }}
                      >
                        <ChevronLeft size={16} aria-hidden="true" />
                      </button>
                      <label htmlFor={generatedInputSelectId}>
                        <span className="visually-hidden">Generated input</span>
                        <select
                          id={generatedInputSelectId}
                          aria-label="Generated input"
                          aria-controls="generated-input-preview"
                          value={selectedFile?.name ?? ""}
                          onChange={(event) =>
                            setSelectedFileKey(event.target.value)
                          }
                        >
                          {equilibrationFiles.length > 0 && (
                            <optgroup label="Equilibration">
                              {equilibrationFiles.map((file) => (
                                <option key={file.name} value={file.name}>
                                  {plannedInputOptionLabel(
                                    file,
                                    rendered.files.length,
                                  )}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {samplingFiles.length > 0 && (
                            <optgroup label="Sampling">
                              {samplingFiles.map((file) => (
                                <option key={file.name} value={file.name}>
                                  {plannedInputOptionLabel(
                                    file,
                                    rendered.files.length,
                                  )}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </label>
                      <output aria-live="polite">
                        {selectedFileIndex + 1} of {rendered.files.length}
                      </output>
                      <button
                        type="button"
                        aria-label="Next input"
                        aria-controls="generated-input-preview"
                        disabled={
                          selectedFileIndex < 0 ||
                          selectedFileIndex >= rendered.files.length - 1
                        }
                        onClick={() => {
                          if (
                            selectedFileIndex < 0 ||
                            selectedFileIndex >= rendered.files.length - 1
                          ) {
                            return;
                          }
                          setSelectedFileKey(
                            rendered.files[selectedFileIndex + 1].name,
                          );
                        }}
                      >
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </section>
              )}
              <div
                className="input-preview"
                id="generated-input-preview"
                role="region"
                aria-label={`Input preview: ${
                  selectedFile?.name ?? "preparing inputs"
                }`}
              >
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
          <StructureViewer
            analysis={analysis}
            example={isExample}
            generatedCellTreatment={
              molecularMechanics ? "density" : "padding"
            }
            densityGcm3={setup.density_g_cm3}
          />
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
              <li className={methodReady && !calculatorMissing ? "ok" : "warn"}>
                <StatusDot
                  status={
                    methodReady && !calculatorMissing
                      ? "ok"
                      : methodReady || molecularMechanics
                        ? "warn"
                        : "idle"
                  }
                />
                <span>
                  <strong>Method</strong>
                  <small>
                    {molecularMechanics
                      ? !hasTypedMolecules
                        ? "Import a PQ restart with molecule type IDs."
                        : missingMMFiles.length
                          ? `Add ${missingMMFiles.length} required force-field ${
                              missingMMFiles.length === 1 ? "file" : "files"
                            }.`
                          : !mmDensityReady
                            ? "Set the system density."
                            : `${selectedMethodLabel} is ready.`
                      : !setup.runner
                        ? "Choose a calculator."
                        : calculatorMissing
                          ? `${selectedMethodLabel} was not detected.`
                          : `${selectedMethodLabel} is ready.`}
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
            {displayedDiagnostics.length > 0 && (
              <div className="diagnostics">
                {displayedDiagnostics
                  .slice(0, 4)
                  .map((item: Diagnostic, index) =>
                    item.severity === "info" ? (
                      <div
                        className="diagnostic-row info"
                        key={`${item.code}-${index}`}
                      >
                        <CircleHelp size={14} aria-hidden="true" />
                        <span>{item.message}</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        key={`${item.code}-${index}`}
                        className={item.severity}
                        onClick={() => setActiveStep(diagnosticStep(item.code))}
                      >
                        <CircleAlert size={14} aria-hidden="true" />
                        <span>{item.message}</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    ),
                  )}
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
