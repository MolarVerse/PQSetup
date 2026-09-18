import {
  ArrowRight,
  Atom,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CircleDashed,
  Copy,
  File as FileIcon,
  FileCode2,
  Files,
  Flame,
  Gauge,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Package as PackageIcon,
  Search,
  Sparkles,
  Terminal,
  Thermometer,
  TrendingUp,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  cloneElement,
  startTransition,
  useCallback,
  useDeferredValue,
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
import InputSource from "./InputSource";
import {
  MANOSTATS,
  PRESSURE_ISOTROPIES,
  THERMOSTATS,
} from "./conditionOptions";
import { diagnosticStep } from "./diagnosticNavigation";
import {
  activeFilesForSpecs,
  defaultSetupFileName,
  electronicMethodOptions,
  externalQMProgram,
  missingFilesForSpecs,
  MM_MODES,
  packagedSetupFileName,
  preferredRunner,
  qmSetupFileSpecs,
  recommendedRunnerScript,
  selectedExternalQMScript,
  setupFileSpecs,
} from "./method";
import {
  commitContinuedSamplingRunCountDraft,
  DEFAULT_CONTINUED_SAMPLING_RUNS,
  MAX_SAMPLING_RUNS,
  nextPlannedInputSelection,
  parseContinuedSamplingRunCountDraft,
  plannedInputOptionLabel,
  samplingOutputMode,
  samplingRunCountForMode,
  type SamplingOutputMode,
} from "./runPlan";
import { packageRunLauncher } from "./runCommand";
import StructureViewer from "./StructureViewer";
import type {
  Bootstrap,
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

const DOCUMENTATION_URL = "https://molarverse.github.io/PQSetup/";

const RUNNER_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Tight-binding", ids: ["dftbplus", "ase_dftbplus"] },
  { label: "Semi-empirical", ids: ["ase_xtb"] },
  { label: "Ab initio", ids: ["pyscf", "turbomole"] },
  { label: "ML", ids: ["mace_mp", "mace_off"] },
  { label: "Plane-wave", ids: ["vasp"] },
];

function runnerAvailability(
  runner: {
    available_in_pq?: boolean | null;
    ready?: boolean;
    installed?: boolean;
  },
): "ready" | "incomplete" | "missing" | "unavailable" {
  if (runner.available_in_pq === false) return "unavailable";
  if (runner.ready) return "ready";
  if (runner.installed) return "incomplete";
  return "missing";
}

function runnerAvailabilityLabel(
  state: ReturnType<typeof runnerAvailability>,
): string {
  switch (state) {
    case "unavailable":
      return "not in this PQ build";
    case "incomplete":
      return "setup incomplete";
    case "missing":
      return "not detected";
    default:
      return "";
  }
}

// Scroll targets on the single setup page. "review" points at the generated
// input preview in the output pane.
const SECTIONS = [
  {
    id: "system",
    label: "Structure",
    anchor: "section-structure",
    keywords: "structure atoms cell jitter coordinates perturb symmetry import",
  },
  {
    id: "method",
    label: "Method",
    anchor: "section-method",
    keywords: "calculator engine force field qm mm",
  },
  {
    id: "conditions",
    label: "Run",
    anchor: "section-run",
    keywords: "protocol ensemble sampling thermostat manostat options",
  },
  {
    id: "review",
    label: "Inputs",
    anchor: "generated-input-preview",
    keywords: "inputs files preview package output",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

interface BlockingIssue {
  message: string;
  section: SectionId;
  controlId?: string;
}

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
  mm_force_field: "off",
  density_g_cm3: null,
  coulomb_cutoff_angstrom: 12.5,
  moldescriptor_file: null,
  guff_file: null,
  topology_file: null,
  parameter_file: null,
  intra_nonbonded_file: null,
  dftb_template_file: null,
  turbomole_define_template_file: null,
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
  if (role === "intra_nonbonded") {
    return { ...setup, intra_nonbonded_file: name };
  }
  if (role === "dftb_template") {
    return { ...setup, dftb_template_file: name };
  }
  return { ...setup, turbomole_define_template_file: name };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function thermostatDescription(value: string | null): string {
  return (
    THERMOSTATS.find((option) => option.value === value)?.description ??
    "Choose how temperature is coupled."
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
    </section>
  );
}

function temperatureRampSummary(value: TemperatureScheduleSettings): string {
  if (
    value.start_temperature_k != null &&
    value.temperature_ramp_steps != null &&
    value.temperature_ramp_steps > 0
  ) {
    return `${value.start_temperature_k} → … · ${value.temperature_ramp_steps} steps`;
  }
  return "off";
}

function TemperatureRampContent({
  value,
  onChange,
}: {
  value: TemperatureScheduleSettings;
  onChange: (patch: Partial<TemperatureScheduleSettings>) => void;
}) {
  return (
    <div className="form-grid schedule-grid">
      <Field label="Start temperature" unit="K">
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
      <Field label="Ramp steps">
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
  );
}

type RunOpenOption =
  | "equilibration"
  | "output"
  | "thermostat"
  | "ramp"
  | "manostat";

function runOptionForControl(controlId: string): RunOpenOption | null {
  switch (controlId) {
    case "sampling-thermostat":
      return "thermostat";
    case "sampling-manostat":
      return "manostat";
    case "sampling-run-count":
      return "output";
    case "sampling-temperature":
    case "sampling-pressure":
    case "sampling-timestep":
    case "sampling-steps":
      return null;
    default:
      return null;
  }
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
      <div className="form-grid coupling-grid">
        <Field
          label="Manostat"
          controlId={controlId}
          info="Pressure coupling for the simulation cell."
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
    </section>
  );
}

function InputNavigator({
  rendered,
  selectedFile,
  selectedFileIndex,
  selectId,
  equilibrationFiles,
  samplingFiles,
  onSelect,
}: {
  rendered: PlanRenderResult;
  selectedFile: PlanRenderResult["files"][number] | null;
  selectedFileIndex: number;
  selectId: string;
  equilibrationFiles: PlanRenderResult["files"];
  samplingFiles: PlanRenderResult["files"];
  onSelect: (name: string) => void;
}) {
  if (rendered.files.length <= 1) {
    return (
      <span>
        <FileCode2 size={16} aria-hidden="true" />
        {selectedFile?.name ?? "…"}
      </span>
    );
  }

  return (
    <div className="input-navigator preview-navigator">
      <button
        type="button"
        aria-label="Previous input"
        aria-controls="generated-input-preview"
        disabled={selectedFileIndex <= 0}
        onClick={() => {
          if (selectedFileIndex <= 0) return;
          onSelect(rendered.files[selectedFileIndex - 1].name);
        }}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <label htmlFor={selectId}>
        <span className="visually-hidden">Generated input</span>
        <select
          id={selectId}
          aria-label="Generated input"
          aria-controls="generated-input-preview"
          value={selectedFile?.name ?? ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {equilibrationFiles.length > 0 && (
            <optgroup label="Equilibration">
              {equilibrationFiles.map((file) => (
                <option key={file.name} value={file.name}>
                  {plannedInputOptionLabel(file, rendered.files.length)}
                </option>
              ))}
            </optgroup>
          )}
          {samplingFiles.length > 0 && (
            <optgroup label="Sampling">
              {samplingFiles.map((file) => (
                <option key={file.name} value={file.name}>
                  {plannedInputOptionLabel(file, rendered.files.length)}
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
          onSelect(rendered.files[selectedFileIndex + 1].name);
        }}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function SetupFileStatus({
  selected,
  optional,
}: {
  selected: boolean;
  optional?: boolean;
}) {
  if (selected) {
    return (
      <span className="file-added" title="Added">
        <Check size={14} aria-hidden="true" />
        Added
      </span>
    );
  }
  if (optional) {
    return (
      <span className="file-optional" title="Optional file">
        <CircleDashed size={14} aria-hidden="true" />
        Optional
      </span>
    );
  }
  return (
    <span className="file-required" title="Required file">
      <CircleAlert size={14} aria-hidden="true" />
      Add file
    </span>
  );
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<StructureAnalysis>(EXAMPLE);
  const [originalAnalysis, setOriginalAnalysis] =
    useState<StructureAnalysis>(EXAMPLE);
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
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [openOption, setOpenOption] = useState<RunOpenOption | null>(null);
  const generatedInputSelectId = useId();
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
  const fileInput = useRef<HTMLInputElement>(null);
  const renderSequence = useRef(0);
  const uploadSequence = useRef(0);
  const perturbSequence = useRef(0);
  const firstGeneratedFileName = useRef<string | null>(null);
  const lastContinuedSamplingRunCount = useRef(
    DEFAULT_CONTINUED_SAMPLING_RUNS,
  );
  const molecularMechanics = isMolecularMechanics(setup);
  const externalQM = bootstrap?.pq.external_qm ?? null;
  const electronicMethods = useMemo(
    () => electronicMethodOptions(externalQM, setup.runner),
    [externalQM, setup.runner],
  );
  const electronicProgram = useMemo(
    () => externalQMProgram(externalQM, setup.runner),
    [externalQM, setup.runner],
  );
  const selectedElectronicMethod = useMemo(
    () =>
      selectedExternalQMScript(
        externalQM,
        setup.runner,
        setup.runner_script,
      ),
    [externalQM, setup.runner, setup.runner_script],
  );
  const methodFileSpecs = useMemo(
    () =>
      molecularMechanics
        ? setupFileSpecs(setup.mm_force_field)
        : qmSetupFileSpecs(
            setup.runner,
            setup.ensemble,
            setup.runner_script,
            externalQM,
          ),
    [
      externalQM,
      molecularMechanics,
      setup.ensemble,
      setup.mm_force_field,
      setup.runner,
      setup.runner_script,
    ],
  );
  const methodSetupFiles = useMemo(
    () => activeFilesForSpecs(methodFileSpecs, setupFiles),
    [methodFileSpecs, setupFiles],
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
    let current = true;
    getBootstrap()
      .then((value) => {
        if (!current) return;
        setBootstrap(value);
        const preferred = preferredRunner(value.runners);
        if (preferred) {
          setSetup((existing) => {
            if (isMolecularMechanics(existing)) {
              return existing;
            }
            const selected = value.runners.find(
              (runner) => runner.id === existing.runner,
            );
            // Keep a ready selection; otherwise take the preferred runner
            // (ready first, then the usual fallback).
            if (selected?.ready && selected.available_in_pq !== false) {
              return existing;
            }
            return {
              ...existing,
              runner: preferred.id,
              runner_script: recommendedRunnerScript(
                value.pq.external_qm,
                preferred.id,
              ),
            };
          });
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
          startTransition(() => {
            setRendered(result);
            setSelectedFileKey((current) =>
              nextPlannedInputSelection(
                current,
                previousFirstName,
                result.files,
              ),
            );
          });
        })
        .catch((error) => {
          if (sequence === renderSequence.current) {
            startTransition(() => {
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
  const stageInputText =
    selectedFile?.input_text ||
    rendered?.diagnostics[0]?.message ||
    "…";
  const deferredStageInputText = useDeferredValue(stageInputText);
  const equilibrationFiles = useMemo(
    () =>
      rendered?.files.filter((file) => file.stage_id === "equilibration") ?? [],
    [rendered],
  );
  const samplingFiles = useMemo(
    () => rendered?.files.filter((file) => file.stage_id === "sampling") ?? [],
    [rendered],
  );
  const missingMethodFiles = useMemo(
    () => missingFilesForSpecs(methodFileSpecs, methodSetupFiles),
    [methodFileSpecs, methodSetupFiles],
  );
  const hasTypedMolecules = analysis.structure.atoms.some(
    (atom) => atom.molecule_type > 0,
  );
  const mmDensityReady =
    !analysis.structure.cell_generated ||
    Boolean(setup.density_g_cm3 && setup.density_g_cm3 > 0);
  const methodReady = molecularMechanics
    ? hasTypedMolecules && mmDensityReady && missingMethodFiles.length === 0
    : Boolean(setup.runner) &&
      (!electronicProgram || Boolean(selectedElectronicMethod)) &&
      missingMethodFiles.length === 0;
  const samplingMode = samplingOutputMode(samplingRunCount);

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

  // Ordered list of what still blocks packaging; the first entry drives the
  // footer status and the "not ready" Package click.
  const blockingIssues = useMemo<BlockingIssue[]>(() => {
    const issues: BlockingIssue[] = [];
    if (!analysis.valid) {
      issues.push({ message: "Structure needs review", section: "system" });
    }
    if (!methodReady) {
      if (!molecularMechanics && !setup.runner) {
        issues.push({ message: "Choose a calculator", section: "method" });
      } else if (
        !molecularMechanics &&
        electronicProgram &&
        !selectedElectronicMethod
      ) {
        issues.push({
          message: "Choose an electronic method",
          section: "method",
        });
      } else if (molecularMechanics && !hasTypedMolecules) {
        issues.push({
          message: "Structure needs molecule type IDs",
          section: "method",
        });
      } else if (molecularMechanics && !mmDensityReady) {
        issues.push({
          message: "Set the system density",
          section: "method",
          controlId: "mm-density",
        });
      } else if (missingMethodFiles.length > 0) {
        const missingLabel = methodFileSpecs.find(
          (spec) => spec.role === missingMethodFiles[0],
        )?.label;
        issues.push({
          message:
            missingMethodFiles.length === 1 && missingLabel
              ? `Add ${missingLabel} file`
              : `Add ${missingMethodFiles.length} method files`,
          section: "method",
        });
      } else {
        issues.push({ message: "Review method", section: "method" });
      }
    }
    for (const item of diagnostics) {
      if (item.severity !== "error") continue;
      if (issues.some((issue) => issue.message === item.message)) continue;
      issues.push({
        message: item.message,
        section: diagnosticStep(item.code),
      });
    }
    if (issues.length === 0 && rendered && !rendered.valid) {
      issues.push({ message: "Review generated inputs", section: "review" });
    }
    return issues;
  }, [
    analysis.valid,
    diagnostics,
    electronicProgram,
    hasTypedMolecules,
    methodFileSpecs,
    methodReady,
    missingMethodFiles,
    mmDensityReady,
    molecularMechanics,
    rendered,
    selectedElectronicMethod,
    setup.runner,
  ]);
  const firstBlockingIssue = blockingIssues[0] ?? null;

  const openFilePicker = useCallback(() => fileInput.current?.click(), []);

  // Scroll the page to a section and, when given, focus a specific control.
  const goToControl = useCallback(
    (section: SectionId, controlId?: string) => {
      if (controlId) {
        const runOption = runOptionForControl(controlId);
        if (runOption) setOpenOption(runOption);
      }
      const anchor =
        SECTIONS.find((item) => item.id === section)?.anchor ?? section;
      window.requestAnimationFrame(() => {
        const control = controlId
          ? document.getElementById(controlId)
          : null;
        const target = control ?? document.getElementById(anchor);
        target?.scrollIntoView({
          block: control ? "center" : "start",
          behavior: "smooth",
        });
        if (
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLButtonElement ||
          control instanceof HTMLTextAreaElement
        ) {
          control.focus({ preventScroll: true });
        }
      });
    },
    [],
  );

  const createRun = useCallback(async () => {
    if (!ready || exporting) {
      if (firstBlockingIssue) {
        goToControl(firstBlockingIssue.section, firstBlockingIssue.controlId);
      }
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
    firstBlockingIssue,
    goToControl,
    methodSetupFiles,
    preparation,
    ready,
    samplingRunCount,
    setup,
  ]);

  const commands = useMemo<Command[]>(() => {
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
      ...problemCommands,
      ...SECTIONS.map(
        (section, index): Command => ({
          id: `section-${section.id}`,
          group: "Workflow",
          label: `Go to ${section.label}`,
          detail: section.label,
          hint: `Alt ${index + 1}`,
          keywords: ["go", "open", "jump", "scroll", section.keywords],
          run: () => goToControl(section.id),
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
        },
      },
      ...(bootstrap?.runners ?? [])
        .filter((runner) => runner.supported)
        .map(
          (runner): Command => ({
            id: `calculator-${runner.id}`,
            group: "Scientific setup",
            label: runner.label,
            detail:
              runner.available_in_pq === false
                ? "Selected PQ build does not include this method. Inputs can still be created."
                : runner.ready
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
            },
          }),
        ),
      ...electronicMethods.map(
        (method): Command => ({
          id: `electronic-method-${method.name}`,
          group: "Scientific setup",
          label: method.label,
          detail: `${selectedRunnerStatus?.label ?? setup.runner} electronic method`,
          keywords: [
            "electronic method",
            "basis",
            "pyscf",
            method.name,
            method.label,
          ],
          current: setup.runner_script === method.name,
          run: () => {
            chooseElectronicMethod(method.name);
            goToControl("method");
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
          goToControl("system", "position-sigma");
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
            goToControl("review");
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
      {
        id: "documentation",
        group: "Actions",
        label: "Open documentation",
        detail: "Guides, validation, run packages, and command line",
        keywords: ["docs", "help", "manual", "guide", "getting started"],
        run: () =>
          window.open(
            DOCUMENTATION_URL,
            "_blank",
            "noopener,noreferrer",
          ),
      },
    ];
  }, [
    analysis.structure.cell_generated,
    bootstrap,
    createRun,
    displayedDiagnostics,
    electronicMethods,
    equilibration,
    goToControl,
    molecularMechanics,
    openFilePicker,
    ready,
    rendered?.files,
    rendering,
    runShortcut,
    samplingMode,
    samplingRunCount,
    selectedRunnerStatus,
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
      if (event.altKey && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        goToControl(SECTIONS[Number(event.key) - 1].id);
        return;
      }
      if (!editing && event.key === "/") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createRun, goToControl, paletteOpen]);

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
        message: result.valid ? file.name : `${file.name} needs review`,
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
    setSetup((existing) => {
      const program = externalQMProgram(externalQM, runnerId);
      const keepsSelection =
        existing.runner === runnerId &&
        program?.scripts.some(
          (script) => script.name === existing.runner_script,
        );
      const runnerScript = keepsSelection
        ? existing.runner_script
        : recommendedRunnerScript(externalQM, runnerId);
      const required = qmSetupFileSpecs(
        runnerId,
        existing.ensemble,
        runnerScript,
        externalQM,
      );
      const roles = new Set(required.map((file) => file.role));
      return {
        ...existing,
        preset_id: null,
        job_type: "qm-md",
        runner: runnerId,
        runner_script: runnerScript,
        moldescriptor_file: roles.has("moldescriptor")
          ? existing.moldescriptor_file ?? defaultSetupFileName("moldescriptor")
          : existing.moldescriptor_file,
        dftb_template_file: roles.has("dftb_template")
          ? existing.dftb_template_file ??
            defaultSetupFileName("dftb_template")
          : existing.dftb_template_file,
        turbomole_define_template_file: roles.has(
          "turbomole_define_template",
        )
          ? existing.turbomole_define_template_file ??
            defaultSetupFileName("turbomole_define_template")
          : existing.turbomole_define_template_file,
      };
    });
  }

  function chooseElectronicMethod(scriptName: string) {
    setSetup((existing) => {
      const allowed = electronicMethodOptions(externalQM, existing.runner);
      if (!allowed.some((script) => script.name === scriptName)) {
        return existing;
      }
      const required = qmSetupFileSpecs(
        existing.runner,
        existing.ensemble,
        scriptName,
        externalQM,
      );
      const roles = new Set(required.map((file) => file.role));
      return {
        ...existing,
        preset_id: null,
        runner_script: scriptName,
        dftb_template_file: roles.has("dftb_template")
          ? existing.dftb_template_file ??
            defaultSetupFileName("dftb_template")
          : existing.dftb_template_file,
        turbomole_define_template_file: roles.has(
          "turbomole_define_template",
        )
          ? existing.turbomole_define_template_file ??
            defaultSetupFileName("turbomole_define_template")
          : existing.turbomole_define_template_file,
      };
    });
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

    const preferred = preferredRunner(bootstrap?.runners ?? []);
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
      const packageName = packagedSetupFileName(role, file.name);
      setSetupFiles((existing) => [
        ...existing.filter((item) => item.role !== role),
        { role, name: packageName, content },
      ]);
      setSetup((existing) => withSetupFileName(existing, role, packageName));
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
      moldescriptor_file:
        ensemble === "NPT"
          ? existing.moldescriptor_file ??
            defaultSetupFileName("moldescriptor")
          : existing.moldescriptor_file,
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

  const runLauncher = packageRunLauncher(bootstrap?.pq ?? null);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" title="PQSetup">
          <img src="/pq-logo.png" alt="PQSetup" />
          <strong>PQSetup</strong>
        </div>
        <div className="header-center">
          <button
            type="button"
            className="command-search"
            aria-label={`Search setup, ${searchShortcut}`}
            onClick={() => setPaletteOpen(true)}
          >
            <Search size={16} aria-hidden="true" />
            <span>Search setup…</span>
            <kbd>{searchShortcut}</kbd>
          </button>
        </div>
        <div className="header-status">
          <a
            className="header-docs-link"
            href={DOCUMENTATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open PQSetup documentation"
            title="Docs"
          >
            <BookOpen size={15} aria-hidden="true" />
          </a>
          {bootstrap ? (
            <span
              className={`pq-tag ${bootstrap.pq.found ? "ok" : "missing"}`}
              title={
                bootstrap.pq.found
                  ? `PQ ${bootstrap.pq.version ?? "detected"}`
                  : "PQ not found"
              }
            >
              <span className="pq-tag-label">PQ</span>
              <span className="pq-tag-value">
                {bootstrap.pq.found
                  ? (bootstrap.pq.version ?? "PQ").split("-")[0]
                  : "no PQ"}
              </span>
            </span>
          ) : bootstrapError ? (
            <span className="pq-tag missing" title="Backend unavailable">
              <span className="pq-tag-label">PQ</span>
              <span className="pq-tag-value">offline</span>
            </span>
          ) : (
            <span className="pq-tag pending" title="Checking system">
              <LoaderCircle size={13} className="spin" aria-hidden="true" />
              <span className="pq-tag-value">checking</span>
            </span>
          )}
        </div>
      </header>

      <main className="page">
          {notice && notice.kind === "error" && (
            <div className="notice error" role="status">
              <CircleAlert size={15} />
              <span>{notice.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => setNotice(null)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="setup-page">
            <section
              className="setup-section"
              id="section-structure"
              aria-labelledby="section-structure-title"
            >
              <h2 className="section-title" id="section-structure-title">
                Structure
              </h2>
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                accept=".rst,.xyz,.cif,.pdb,.mol,.sdf,.traj,.extxyz"
                onChange={onFileChange}
              />
              <div className="structure-card">
                <StructureViewer
                  chromeless
                  analysis={analysis}
                  generatedCellTreatment={
                    molecularMechanics ? "density" : "padding"
                  }
                />
                <div
                  className="structure-summary"
                  aria-label="Current structure. Drop a file here to replace it."
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault();
                    const file = event.dataTransfer.files[0];
                    if (file) void useFile(file);
                  }}
                >
                  <div className="file-icon">
                    {uploading ? (
                      <LoaderCircle className="spin" size={18} aria-hidden="true" />
                    ) : (
                      <FileCode2 size={18} aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <strong>{analysis.structure.source_name}</strong>
                    <small>
                      <ChemicalFormula formula={analysis.summary.formula} />
                      {" · "}
                      {analysis.summary.atom_count}{" "}
                      {analysis.summary.atom_count === 1 ? "atom" : "atoms"}
                    </small>
                  </div>
                  {!analysis.valid && (
                    <span
                      className="file-invalid"
                      title="Needs review"
                      aria-label="Needs review"
                    >
                      <CircleAlert size={16} aria-hidden="true" />
                    </span>
                  )}
                  <button
                    type="button"
                    className="structure-replace"
                    aria-label="Import structure"
                    title="Import · RST · XYZ · CIF · PDB · MOL · SDF · TRAJ · or drop a file here"
                    onClick={openFilePicker}
                  >
                    <Upload size={14} aria-hidden="true" />
                    Import
                  </button>
                </div>

                <div className="structure-meta band-row">
                  <div
                    className={`prepare-option ${jitter ? "enabled" : ""}`}
                    title={
                      sourceFile
                        ? "Nudge atoms to break symmetry"
                        : "Import a structure first"
                    }
                  >
                    <label className="switch-row">
                      <span className="prepare-icon">
                        <Sparkles size={16} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>Jitter</strong>
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
                  </div>
                </div>

                {jitter && (
                  <div className="prepare-fields band-row">
                    <Field label="σ" unit="Å" controlId="position-sigma">
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
                    <Field label="Seed" controlId="position-seed">
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
                      Apply
                    </button>
                  </div>
                )}
                {preparation && (
                  <div className="preparation-applied">
                    <CheckCircle2 size={15} />
                    σ {preparation.sigma_angstrom} Å · seed {preparation.seed}
                  </div>
                )}
              </div>
            </section>

            <section
              className="setup-section"
              id="section-method"
              aria-labelledby="section-method-title"
            >
              <h2 className="section-title" id="section-method-title">
                Method
              </h2>
              {!molecularMechanics ? (
                <div className="method-content">
                  <div className="method-band band-row">
                    <fieldset className="interaction-model-fieldset">
                      <legend className="visually-hidden">Interaction model</legend>
                      <div className="interaction-model-options">
                        <label className={!molecularMechanics ? "selected" : ""}>
                          <input
                            type="radio"
                            name="interaction-model"
                            checked={!molecularMechanics}
                            onChange={() => chooseInteractionModel("qm")}
                          />
                          <Atom size={16} aria-hidden="true" />
                          <span className="interaction-model-label">
                            <strong>QM</strong>
                          </span>
                        </label>
                        <label className={molecularMechanics ? "selected" : ""}>
                          <input
                            type="radio"
                            name="interaction-model"
                            checked={molecularMechanics}
                            onChange={() => chooseInteractionModel("mm")}
                          />
                          <Boxes size={16} aria-hidden="true" />
                          <span className="interaction-model-label">
                            <strong>MM</strong>
                          </span>
                        </label>
                      </div>
                    </fieldset>
                    <div className="calculator-select">
                    <label className="visually-hidden" htmlFor="calculator">
                      Calculator
                    </label>
                    <select
                      id="calculator"
                      aria-label="Calculator"
                      value={setup.runner ?? ""}
                      disabled={!bootstrap}
                      onChange={(event) => {
                        if (event.target.value) {
                          chooseCalculator(event.target.value);
                        }
                      }}
                    >
                      <option value="" disabled>
                        {bootstrap ? "Select calculator" : "Loading…"}
                      </option>
                      {RUNNER_GROUPS.map((group) => {
                        const runners = (bootstrap?.runners ?? []).filter(
                          (runner) =>
                            runner.supported && group.ids.includes(runner.id),
                        );
                        if (runners.length === 0) return null;
                        return (
                          <optgroup label={group.label} key={group.label}>
                            {runners.map((runner) => {
                              const state = runnerAvailability(runner);
                              const suffix = runnerAvailabilityLabel(state);
                              return (
                                <option value={runner.id} key={runner.id}>
                                  {runner.label}
                                  {suffix ? ` · ${suffix}` : ""}
                                </option>
                              );
                            })}
                          </optgroup>
                        );
                      })}
                    </select>
                    {(() => {
                      const selected = selectedRunnerStatus;
                      if (!selected) {
                        return !setup.runner ? (
                          <div className="inline-warning" role="alert">
                            <CircleAlert size={15} aria-hidden="true" />
                            Select calculator
                          </div>
                        ) : null;
                      }
                      const state = runnerAvailability(selected);
                      if (state === "ready") return null;
                      return (
                        <div
                          className="calculator-status warn"
                          role="status"
                          title="Calculator not detected on this machine"
                        >
                          <CircleAlert size={14} aria-hidden="true" />
                          {runnerAvailabilityLabel(state)}
                        </div>
                      );
                    })()}
                  </div>
                  </div>
                  {electronicMethods.length > 0 &&
                    (electronicMethods.length > 1 ||
                      !electronicProgram?.recommended_script) && (
                      <fieldset className="electronic-method-fieldset">
                        <legend className="visually-hidden">
                          Electronic method
                        </legend>
                        <div
                          className="electronic-method-options"
                          role="radiogroup"
                          aria-label="Electronic method"
                        >
                          {electronicMethods.map((method) => (
                            <label
                              className={
                                setup.runner_script === method.name
                                  ? "selected"
                                  : ""
                              }
                              key={method.name}
                            >
                              <input
                                type="radio"
                                name="electronic-method"
                                checked={setup.runner_script === method.name}
                                onChange={() =>
                                  chooseElectronicMethod(method.name)
                                }
                              />
                              <span>{method.label}</span>
                            </label>
                          ))}
                        </div>
                        {!selectedElectronicMethod && (
                          <div className="inline-warning" role="alert">
                            <CircleAlert size={15} aria-hidden="true" />
                            Choose method
                          </div>
                        )}
                      </fieldset>
                    )}
                  {methodFileSpecs.length > 0 && (
                    <div className="setup-file-list" aria-label="Files">
                      {methodFileSpecs.map((spec) => {
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
                            <SetupFileStatus selected={Boolean(selected)} />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="method-content">
                  <fieldset className="interaction-model-fieldset">
                    <legend className="visually-hidden">Interaction model</legend>
                    <div className="interaction-model-options">
                      <label className={!molecularMechanics ? "selected" : ""}>
                        <input
                          type="radio"
                          name="interaction-model"
                          checked={!molecularMechanics}
                          onChange={() => chooseInteractionModel("qm")}
                        />
                        <Atom size={16} aria-hidden="true" />
                        <span className="interaction-model-label">
                          <strong>QM</strong>
                        </span>
                      </label>
                      <label className={molecularMechanics ? "selected" : ""}>
                        <input
                          type="radio"
                          name="interaction-model"
                          checked={molecularMechanics}
                          onChange={() => chooseInteractionModel("mm")}
                        />
                        <Boxes size={16} aria-hidden="true" />
                        <span className="interaction-model-label">
                          <strong>MM</strong>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                  <fieldset className="mm-mode-fieldset">
                    <legend className="visually-hidden">Interaction terms</legend>
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
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="form-grid">
                    {analysis.structure.cell_generated && (
                      <Field
                        label="Density"
                        unit="g cm⁻³"
                        controlId="mm-density"
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
                      label="Cutoff"
                      unit="Å"
                      controlId="mm-cutoff"
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
                      Atoms carry no molecule types — import a PQ restart
                      (.rst) with molecule type IDs
                    </div>
                  )}

                  <div className="setup-file-list" aria-label="Files">
                    {methodFileSpecs.map((spec) => {
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
                          <SetupFileStatus
                            selected={Boolean(selected)}
                            optional={spec.optional}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section
              className="setup-section"
              id="section-run"
              aria-labelledby="section-run-title"
            >
              <h2 className="section-title" id="section-run-title">
                Run
              </h2>
              <div className="run-band">
              <div className="run-primary band-row">
              <fieldset className="ensemble-fieldset">
                <legend className="visually-hidden">Ensemble</legend>
                <div role="radiogroup" aria-label="Sampling ensemble">
                  {(
                    [
                      {
                        id: "NVE" as const,
                        icon: Zap,
                        caption: "Energy",
                      },
                      {
                        id: "NVT" as const,
                        icon: Thermometer,
                        caption: "Temperature",
                      },
                      {
                        id: "NPT" as const,
                        icon: Gauge,
                        caption: "Temp + pressure",
                      },
                    ] as const
                  ).map(({ id, icon: EnsembleIcon, caption }) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={setup.ensemble === id}
                      className={setup.ensemble === id ? "selected" : ""}
                      key={id}
                      title={caption}
                      onClick={() => chooseSamplingEnsemble(id)}
                    >
                      <EnsembleIcon size={16} aria-hidden="true" />
                      <strong>{id}</strong>
                      <small>{caption}</small>
                    </button>
                  ))}
                </div>
              </fieldset>

              <div
                className={`form-grid sampling-condition-grid${
                  setup.ensemble === "NPT" ? " has-pressure" : ""
                }`}
              >
                <Field
                  label="Temperature"
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
                <Field label="Steps" controlId="sampling-steps">
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
                {setup.ensemble === "NPT" && (
                  <Field
                    label="Pressure"
                    unit="bar"
                    controlId="sampling-pressure"
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
              </div>
              </div>

              <div className="option-chips" role="toolbar" aria-label="Run options">
                <button
                  type="button"
                  className={`option-chip${
                    openOption === "equilibration" ? " selected" : ""
                  }`}
                  aria-pressed={openOption === "equilibration"}
                  onClick={() =>
                    setOpenOption((current) =>
                      current === "equilibration" ? null : "equilibration",
                    )
                  }
                >
                  <Flame size={14} aria-hidden="true" />
                  <span>Equilibration</span>
                  <strong>
                    {equilibration
                      ? `${equilibration.steps} steps · ${equilibration.temperature_k} K`
                      : "off"}
                  </strong>
                </button>
                <button
                  type="button"
                  className={`option-chip${
                    openOption === "output" ? " selected" : ""
                  }`}
                  aria-pressed={openOption === "output"}
                  onClick={() =>
                    setOpenOption((current) =>
                      current === "output" ? null : "output",
                    )
                  }
                >
                  <Files size={14} aria-hidden="true" />
                  <span>Runs</span>
                  <strong>
                    {samplingMode === "continued"
                      ? `${samplingRunCount} continued`
                      : "1"}
                  </strong>
                </button>
                {(setup.ensemble === "NVT" || setup.ensemble === "NPT") && (
                  <button
                    type="button"
                    className={`option-chip${
                      openOption === "thermostat" ? " selected" : ""
                    }`}
                    aria-pressed={openOption === "thermostat"}
                    onClick={() =>
                      setOpenOption((current) =>
                        current === "thermostat" ? null : "thermostat",
                      )
                    }
                  >
                    <Thermometer size={14} aria-hidden="true" />
                    <span>Thermostat</span>
                    <strong>
                      {THERMOSTATS.find(
                        (option) => option.value === setup.thermostat,
                      )?.label ?? "—"}
                      {setup.thermostat_relaxation_ps != null &&
                        (setup.thermostat === "berendsen" ||
                          setup.thermostat === "velocity_rescaling") &&
                        ` · ${setup.thermostat_relaxation_ps} ps`}
                    </strong>
                  </button>
                )}
                {(setup.ensemble === "NVT" || setup.ensemble === "NPT") && (
                  <button
                    type="button"
                    className={`option-chip${
                      openOption === "ramp" ? " selected" : ""
                    }`}
                    aria-pressed={openOption === "ramp"}
                    onClick={() =>
                      setOpenOption((current) =>
                        current === "ramp" ? null : "ramp",
                      )
                    }
                  >
                    <TrendingUp size={14} aria-hidden="true" />
                    <span>Ramp</span>
                    <strong>{temperatureRampSummary(setup)}</strong>
                  </button>
                )}
                {setup.ensemble === "NPT" && (
                  <button
                    type="button"
                    className={`option-chip${
                      openOption === "manostat" ? " selected" : ""
                    }`}
                    aria-pressed={openOption === "manostat"}
                    onClick={() =>
                      setOpenOption((current) =>
                        current === "manostat" ? null : "manostat",
                      )
                    }
                  >
                    <Gauge size={14} aria-hidden="true" />
                    <span>Manostat</span>
                    <strong>
                      {MANOSTATS.find(
                        (option) => option.value === setup.manostat,
                      )?.label ?? "—"}
                    </strong>
                  </button>
                )}
              </div>

              {openOption === "equilibration" && (
                <div className="option-chip-body">
                  <label className="switch-row">
                    <span className="prepare-icon">
                      <Flame size={16} aria-hidden="true" />
                    </span>
                    <span>
                      <strong>Equilibration</strong>
                    </span>
                    <input
                      type="checkbox"
                      aria-label="Include equilibration stage"
                      checked={Boolean(equilibration)}
                      onChange={(event) =>
                        chooseProtocol(event.target.checked)
                      }
                    />
                    <span className="switch" aria-hidden="true" />
                  </label>
                  {equilibration && (
                    <div className="form-grid stage-primary-grid">
                      <Field label="Temperature" unit="K">
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
                    </div>
                  )}
                </div>
              )}

              {openOption === "output" && (
                <div className="option-chip-body">
                  <fieldset className="sampling-output-fieldset">
                    <legend className="visually-hidden">Sampling mode</legend>
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
                          onChange={() => chooseSamplingOutputMode("single")}
                        />
                        <span>
                          <FileIcon size={15} aria-hidden="true" />
                          <strong>Single</strong>
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
                          <Files size={15} aria-hidden="true" />
                          <strong>Continued</strong>
                        </span>
                      </label>
                    </div>
                  </fieldset>
                  {samplingMode === "continued" && (
                    <div className="form-grid">
                      <Field label="Inputs" controlId="sampling-run-count">
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
                    </div>
                  )}
                </div>
              )}

              {openOption === "thermostat" &&
                (setup.ensemble === "NVT" || setup.ensemble === "NPT") && (
                  <div className="option-chip-body">
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
                  </div>
                )}

              {openOption === "ramp" &&
                (setup.ensemble === "NVT" || setup.ensemble === "NPT") && (
                  <div className="option-chip-body">
                    <TemperatureRampContent
                      value={setup}
                      onChange={(patch) =>
                        setSetup((existing) => ({
                          ...existing,
                          preset_id: null,
                          ...patch,
                        }))
                      }
                    />
                  </div>
                )}

              {openOption === "manostat" && setup.ensemble === "NPT" && (
                <div className="option-chip-body">
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
                </div>
              )}
              </div>
            </section>

            <section
              className="setup-section results-section"
              id="section-output"
              aria-labelledby="section-output-title"
            >
              <h2 className="section-title" id="section-output-title">
                Output
              </h2>
              <div className="output-name">
                <Field label="Name" controlId="run-name">
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
              </div>

              {rendered ? (
                <div
                  className={`input-preview page-input-preview${
                    previewExpanded ? " expanded" : ""
                  }`}
                  id="generated-input-preview"
                  role="region"
                  aria-label={`Input preview: ${
                    selectedFile?.name ?? "preparing inputs"
                  }`}
                >
                  <div className="preview-title">
                    <InputNavigator
                      rendered={rendered}
                      selectedFile={selectedFile}
                      selectedFileIndex={selectedFileIndex}
                      selectId={generatedInputSelectId}
                      equilibrationFiles={equilibrationFiles}
                      samplingFiles={samplingFiles}
                      onSelect={setSelectedFileKey}
                    />
                    <div className="preview-title-actions">
                      {rendering && (
                        <LoaderCircle className="spin" size={15} />
                      )}
                      <button
                        type="button"
                        className="preview-expand"
                        aria-pressed={previewExpanded}
                        aria-label={
                          previewExpanded
                            ? "Collapse input preview"
                            : "Show full input"
                        }
                        title={previewExpanded ? "Collapse" : "Show full input"}
                        onClick={() => setPreviewExpanded((value) => !value)}
                      >
                        {previewExpanded ? (
                          <Minimize2 size={15} aria-hidden="true" />
                        ) : (
                          <Maximize2 size={15} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>
                  {selectedFile && (
                    <div className="preview-continuation">
                      <code>{selectedFile.start_file}</code>
                      <ArrowRight size={13} aria-hidden="true" />
                      <code>{selectedFile.restart_file}</code>
                    </div>
                  )}
                  <pre className="input-preview-body">
                    <InputSource text={deferredStageInputText} />
                  </pre>
                </div>
              ) : (
                <div
                  className="output-empty page-input-preview"
                  id="generated-input-preview"
                  role="region"
                  aria-label="Input preview"
                >
                  {(rendering || !rendered) && (
                    <LoaderCircle
                      className="spin"
                      size={22}
                      aria-hidden="true"
                    />
                  )}
                  <FileCode2 size={16} aria-hidden="true" />
                  <strong>input</strong>
                </div>
              )}

              <div className="footer-run" aria-label="Run command">
                <Terminal size={14} aria-hidden="true" />
                <code title={runLauncher.command}>{runLauncher.command}</code>
                <button
                  type="button"
                  className="footer-run-copy"
                  aria-label="Copy run command"
                  title="Copy run command"
                  onClick={() =>
                    void navigator.clipboard.writeText(runLauncher.command)
                  }
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
              </div>
            </section>
          </div>

          <footer className="page-footer">
            <div className="page-footer-bar">
              {!rendered || rendering ? (
                <div className="footer-status loading" role="status">
                  <LoaderCircle className="spin" size={18} aria-hidden="true" />
                  <span className="footer-status-copy">
                    <span>rendering…</span>
                  </span>
                </div>
              ) : ready || !firstBlockingIssue ? (
                <div className="footer-status ready" role="status">
                  <CheckCircle2 aria-hidden="true" />
                  <span className="footer-status-copy">
                    <strong>{setup.file_prefix}.zip</strong>
                    <span>
                      {rendered?.files.length ?? 0}{" "}
                      {rendered?.files.length === 1 ? "input" : "inputs"}
                    </span>
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  className="footer-status attention"
                  title={firstBlockingIssue.message}
                  onClick={() =>
                    goToControl(
                      firstBlockingIssue.section,
                      firstBlockingIssue.controlId,
                    )
                  }
                >
                  <CircleAlert aria-hidden="true" />
                  <span className="footer-status-copy">
                    {blockingIssues.length > 1 && (
                      <strong>{blockingIssues.length} issues</strong>
                    )}
                    <span>{firstBlockingIssue.message}</span>
                  </span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="create-run"
                disabled={!ready || exporting}
                onClick={() => void createRun()}
              >
                {exporting ? "…" : "Package"}
                {exporting ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <PackageIcon size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </footer>
      </main>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
