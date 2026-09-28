import {
  Atom,
  BookOpen,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Copy,
  FileCode2,
  FolderOpen,
  Flame,
  Gauge,
  LoaderCircle,
  Maximize2,
  Package as PackageIcon,
  Rotate3d,
  Search,
  Sparkles,
  Terminal,
  Thermometer,
  RotateCcw,
  Timer,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
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
} from "react";
import {
  analyzeFile,
  exportProject,
  getBootstrap,
  perturbFile,
  renderPlan,
} from "./api";
import {
  CommandPalette,
  ConditionRow,
  Field,
  Modal,
  type Command,
} from "@molarverse/pq-design";
import { COMMAND_GROUP_ORDER, type CommandGroup } from "./commandGroups";
import { PressureCoupling, TemperatureCoupling } from "./components/Coupling";
import InputNavigator from "./components/InputNavigator";
import { SettingsLine } from "./components/SettingsLine";
import SetupFileList from "./components/SetupFileList";
import {
  MMSettingsForm,
  QMSettingsForm,
  RunSettingsForm,
} from "./SettingsForms";
import {
  QM_DEFAULTS,
  XTB_METHODS,
  extraString,
  isThermalEnsemble,
  runSettingsLines,
  settingsLines,
  usesConstraints,
  usesMShake,
  usesTopology,
} from "./calculatorSettings";
import ChemicalFormula from "./ChemicalFormula";
import InputSource from "./InputSource";
import { compactInputPreview } from "./inputPreview";
import {
  MANOSTATS,
  THERMOSTATS,
} from "./conditionOptions";
import { diagnosticStep, diagnosticControl } from "./diagnosticNavigation";
import { effectiveSetup } from "./effectiveSetup";
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
  companionRoleForFileName,
  isStructureFileName,
  recommendedRunnerScript,
  selectedExternalQMScript,
  setupFileSpecs,
} from "./method";
import {
  clampSamplingRunCount,
  commitSamplingRunCountDraft,
  DEFAULT_CONTINUED_SAMPLING_RUNS,
  MAX_SAMPLING_RUNS,
  MIN_SAMPLING_RUNS,
  nextPlannedInputSelection,
  parseSamplingRunCountDraft,
  samplingLabel,
} from "./runPlan";
import { packageRunLauncher } from "./runCommand";
import { filesFromDrop } from "./droppedFiles";
import {
  EXAMPLE,
  INITIAL_SETUP,
  INITIAL_EQUILIBRATION,
  isMolecularMechanics,
  withMMFileNames,
  withSetupFileName,
} from "./setupState";
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

/** A palette command whose group is one of the setup page's groups. */
type SetupCommand = Command & { group: CommandGroup };

/** Above this many generated inputs, tabs give way to the compact navigator. */
const MAX_INPUT_TABS = 8;

const DOCUMENTATION_URL = "https://molarverse.github.io/PQSetup/";

const RUNNER_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Tight-binding", ids: ["dftbplus", "ase_dftbplus"] },
  { label: "Semi-empirical", ids: ["ase_xtb"] },
  { label: "Ab initio", ids: ["pyscf", "turbomole"] },
  { label: "ML", ids: ["mace_mp", "mace_off"] },
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

// Scroll targets on the single setup page.
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
    label: "Output",
    anchor: "section-output",
    keywords: "review inputs files preview package output",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

interface BlockingIssue {
  message: string;
  section: SectionId;
  controlId?: string;
}

function formatCompact(value: number): string {
  return Number(value.toPrecision(4)).toString();
}

function formatDuration(totalFs: number): string {
  if (!Number.isFinite(totalFs) || totalFs <= 0) return "invalid duration";
  if (totalFs >= 1e6) return `${formatCompact(totalFs / 1e6)} ns`;
  if (totalFs >= 1e3) return `${formatCompact(totalFs / 1e3)} ps`;
  return `${formatCompact(totalFs)} fs`;
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
  const [showInputHeader, setShowInputHeader] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [perturbing, setPerturbing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [jitter, setJitter] = useState(false);
  const [sigma, setSigma] = useState(0.01);
  const [jitterSeed, setJitterSeed] = useState(238917);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [modal, setModal] = useState<
    "structure" | "input" | "calculator" | "run" | null
  >(null);
  const generatedInputSelectId = useId();
  const modalInputSelectId = useId();
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
  const folderInput = useRef<HTMLInputElement>(null);
  const renderSequence = useRef(0);
  const uploadSequence = useRef(0);
  const perturbSequence = useRef(0);
  const firstGeneratedFileName = useRef<string | null>(null);
  const derivedRunName = useRef(INITIAL_SETUP.file_prefix);
  const molecularMechanics = isMolecularMechanics(setup);
  const externalQM = bootstrap?.pq.external_qm ?? null;
  const thermalEnsemble =
    setup.ensemble === "NVT" || setup.ensemble === "NPT";
  // "3 × 1000 × 0.5 fs = 1.5 ps" — total sampled time across chained runs.
  const samplingSpan = useMemo(() => {
    const steps = setup.steps;
    const dt = setup.timestep_fs;
    if (steps == null || dt == null || steps <= 0 || dt <= 0) return undefined;
    const totalFs = samplingRunCount * steps * dt;
    const runs = samplingRunCount > 1 ? `${samplingRunCount} × ` : "";
    return `${runs}${steps} × ${formatCompact(dt)} fs = ${formatDuration(totalFs)}`;
  }, [samplingRunCount, setup.steps, setup.timestep_fs]);
  // Editing σ / seed never touches the structure above; Apply is the only
  // action that does, so until then the applied line just reports drift.
  const preparationStale =
    preparation != null &&
    (preparation.sigma_angstrom !== sigma ||
      preparation.seed !== jitterSeed);
  // Hydrogen moves fast: above 0.5 fs its bonds need constraints.
  const hasHydrogen = analysis.structure.atoms.some(
    (atom) => atom.symbol.toUpperCase() === "H",
  );
  const constrainedBonds =
    molecularMechanics &&
    usesTopology(setup.mm_force_field) &&
    setup.extra_settings.shake === "on";
  const timestepWarning =
    hasHydrogen &&
    !constrainedBonds &&
    setup.timestep_fs != null &&
    setup.timestep_fs > 0.5
      ? molecularMechanics && usesTopology(setup.mm_force_field)
        ? "H present: use ≤ 0.5 fs or turn on SHAKE in Advanced"
        : "H present: use ≤ 0.5 fs"
      : undefined;

  const electronicMethods = useMemo(
    () => electronicMethodOptions(externalQM, setup.runner),
    [externalQM, setup.runner],
  );
  const electronicProgram = useMemo(
    () => externalQMProgram(externalQM, setup.runner),
    [externalQM, setup.runner],
  );
  // A script given by full path replaces the bundled method (PQ treats
  // qm_script and qm_script_full_path as mutually exclusive).
  const scriptFullPath = Boolean(setup.extra_settings.qm_script_full_path);
  const selectedElectronicMethod = useMemo(
    () =>
      selectedExternalQMScript(
        externalQM,
        setup.runner,
        setup.runner_script,
      ),
    [externalQM, setup.runner, setup.runner_script],
  );
  const hasTypedMolecules = analysis.structure.atoms.some(
    (atom) => atom.molecule_type > 0,
  );
  const mshake = usesMShake(setup);
  const constrained = usesConstraints(setup);
  const methodFileSpecs = useMemo(
    () =>
      molecularMechanics
        ? setupFileSpecs(setup.mm_force_field, mshake)
        : qmSetupFileSpecs(
            setup.runner,
            setup.runner_script,
            externalQM,
            hasTypedMolecules,
            constrained,
          ),
    [
      constrained,
      externalQM,
      hasTypedMolecules,
      molecularMechanics,
      mshake,
      setup.mm_force_field,
      setup.runner,
      setup.runner_script,
    ],
  );
  const methodFilesHint = useMemo(() => {
    const required = methodFileSpecs.filter((spec) => !spec.optional);
    const added = required.filter((spec) =>
      setupFiles.some((file) => file.role === spec.role),
    ).length;
    const optional = methodFileSpecs.length - required.length;
    const parts: string[] = [];
    if (required.length > 0) parts.push(`${added} of ${required.length} added`);
    if (optional > 0) parts.push(`${optional} optional`);
    return parts.join(" · ");
  }, [methodFileSpecs, setupFiles]);
  const methodSetupFiles = useMemo(
    () => activeFilesForSpecs(methodFileSpecs, setupFiles),
    [methodFileSpecs, setupFiles],
  );
  const activeSetupFiles = methodSetupFiles; // everything the package ships
  // The form remembers every choice; only what is visible reaches the input.
  const effective = useMemo(
    () =>
      effectiveSetup(
        setup,
        analysis.structure.cell_generated,
        new Set(methodSetupFiles.map((file) => file.role)),
      ),
    [analysis.structure.cell_generated, methodSetupFiles, setup],
  );
  const setupFileReferences = useMemo(
    () =>
      activeSetupFiles.map(({ role, name, content }) => ({
        role,
        name,
        content: role === "moldescriptor" ? content : null,
      })),
    [activeSetupFiles],
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
        effective,
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
    effective,
    equilibration,
    samplingRunCount,
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
  const stageInputText = selectedFile?.input_text ?? "";
  const preview = useMemo(
    () => compactInputPreview(stageInputText, showInputHeader),
    [stageInputText, showInputHeader],
  );
  const deferredPreview = useDeferredValue(preview);
  const deferredFullInputText = useDeferredValue(stageInputText);
  useEffect(() => {
    const list = document.querySelector<HTMLElement>(".input-tab-list");
    const selected = list?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (!list || !selected) return;
    // Keep the selected tab visible within its own strip. scrollIntoView also
    // scrolls the page, which skipped Structure on the first render.
    const strip = list.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < strip.left) list.scrollLeft -= strip.left - tab.left;
    if (tab.right > strip.right) list.scrollLeft += tab.right - strip.right;
  }, [selectedFile?.name]);

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
  const mmDensityReady =
    !analysis.structure.cell_generated ||
    Boolean(setup.density_g_cm3 && setup.density_g_cm3 > 0);
  const methodReady = molecularMechanics
    ? hasTypedMolecules && mmDensityReady && missingMethodFiles.length === 0
    : Boolean(setup.runner) &&
      (!electronicProgram ||
        Boolean(selectedElectronicMethod) ||
        scriptFullPath) &&
      missingMethodFiles.length === 0;

  // The NPT / generated-cell rule is checked by the plan renderer, so it
  // arrives with the other diagnostics instead of being duplicated here.
  const diagnostics = useMemo(
    () => [...analysis.diagnostics, ...(rendered?.diagnostics ?? [])],
    [analysis.diagnostics, rendered?.diagnostics],
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
        !selectedElectronicMethod &&
        !scriptFullPath
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
      const outputFrequencyIssue =
        item.code === "input.extra_value" &&
        item.message.includes("'output_freq'");
      issues.push({
        message: item.message,
        section: outputFrequencyIssue ? "review" : diagnosticStep(item.code),
        controlId: outputFrequencyIssue
          ? "output-freq"
          : diagnosticControl(item.code),
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
    scriptFullPath,
    selectedElectronicMethod,
    setup.runner,
  ]);
  const firstBlockingIssue = blockingIssues[0] ?? null;
  const initialVelocitiesMissing = analysis.structure.atoms.every(
    (atom) =>
      atom.velocity == null || atom.velocity.every((value) => value === 0),
  );
  const warningDiagnostics = useMemo(() => {
    const seen = new Set<string>();
    const candidates = [
      ...displayedDiagnostics,
      ...(!setup.initialize_velocities && initialVelocitiesMissing
        ? [
            {
              code: "run.initial_velocities_missing",
              severity: "warning" as const,
              message:
                "The structure has no nonzero velocities. With initialization off, the run starts from zero velocities.",
              atom_indices: [],
            },
          ]
        : []),
    ];
    return candidates.filter((item) => {
      if (item.severity !== "warning") return false;
      const key = `${item.code}:${item.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [displayedDiagnostics, initialVelocitiesMissing, setup.initialize_velocities]);
  const outputFrequency =
    typeof effective.extra_settings.output_freq === "number"
      ? effective.extra_settings.output_freq
      : 1;
  const validOutputFrequency =
    Number.isInteger(outputFrequency) && outputFrequency >= 1;
  const outputFrameCount =
    validOutputFrequency && setup.steps != null && setup.steps > 0
      ? Math.floor(setup.steps / outputFrequency)
      : null;
  const methodSummary = molecularMechanics
    ? MM_MODES.find((option) => option.value === setup.mm_force_field)?.label ??
      "Molecular mechanics"
    : `${selectedRunnerStatus?.label ?? setup.runner ?? "Choose a calculator"}${
        setup.runner === "ase_xtb"
          ? ` · ${
              XTB_METHODS.find(
                (option) =>
                  option.value ===
                  extraString(
                    setup.extra_settings,
                    "xtb_method",
                    QM_DEFAULTS.xtb_method,
                  ),
              )?.label ?? "GFN2-xTB"
            }`
          : electronicProgram
            ? ` · ${
                scriptFullPath
                  ? "Custom script"
                  : selectedElectronicMethod?.label ?? "Choose a method"
              }`
            : ""
      }`;

  const openFilePicker = useCallback(() => fileInput.current?.click(), []);

  // Optional PQ keywords live in extra_settings; null removes the key.
  const setExtra = useCallback(
    (key: string, value: string | number | boolean | null) => {
      setSetup((existing) => {
        const next = { ...existing.extra_settings };
        if (value === null) delete next[key];
        else next[key] = value;
        return { ...existing, preset_id: null, extra_settings: next };
      });
    },
    [],
  );

  // Scroll the page to a section and, when given, focus a specific control.
  const goToControl = useCallback(
    (section: SectionId, controlId?: string) => {
      const anchor =
        SECTIONS.find((item) => item.id === section)?.anchor ?? section;
      window.requestAnimationFrame(() => {
        const control = controlId
          ? document.getElementById(controlId)
          : null;
        const target = control ?? document.getElementById(anchor);
        target?.scrollIntoView({
          block:
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLButtonElement ||
            control instanceof HTMLTextAreaElement
              ? "center"
              : "start",
          behavior: "smooth",
        });
        if (
          control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLButtonElement ||
          control instanceof HTMLTextAreaElement
        ) {
          control.focus({ preventScroll: true });
        } else if (control instanceof HTMLElement && control.tabIndex === -1) {
          control.focus({ preventScroll: true });
        }
      });
    },
    [],
  );

  const createRun = useCallback(async () => {
    if (!ready || exporting || rendering) {
      if (firstBlockingIssue) {
        goToControl(firstBlockingIssue.section, firstBlockingIssue.controlId);
      }
      return;
    }
    setExporting(true);
    setNotice(null);
    try {
      const blob = await exportProject(
        effective,
        analysis.structure,
        setup.file_prefix,
        preparation,
        equilibration,
        samplingRunCount,
        activeSetupFiles,
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
    activeSetupFiles,
    analysis.structure,
    effective,
    equilibration,
    exporting,
    firstBlockingIssue,
    goToControl,
    preparation,
    ready,
    rendering,
    samplingRunCount,
    setup.file_prefix,
  ]);

  const commands = useMemo<SetupCommand[]>(() => {
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
        (item, index): SetupCommand => ({
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
        (section, index): SetupCommand => ({
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
          (runner): SetupCommand => ({
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
        (method): SetupCommand => ({
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
          current: !molecularMechanics && setup.runner_script === method.name,
          run: () => {
            chooseElectronicMethod(method.name);
            goToControl("method");
          },
        }),
      ),
      ...MM_MODES.map(
        (option): SetupCommand => ({
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
        (ensemble): SetupCommand => ({
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
        current: samplingRunCount === 1,
        run: () => {
          setRunCount(1);
          goToControl("conditions", "sampling-run-count");
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
        current: samplingRunCount > 1,
        run: () => {
          if (samplingRunCount === 1) setRunCount(DEFAULT_CONTINUED_SAMPLING_RUNS);
          goToControl("conditions", "sampling-run-count");
        },
      },
      ...THERMOSTATS.map(
        (option): SetupCommand => ({
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
        (option): SetupCommand => ({
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
        label: samplingRunCount === 1 ? "Sampling steps" : "Steps per input",
        detail: `${setup.steps?.toLocaleString() ?? "Not set"} steps`,
        keywords: ["length", "duration", "sampling", "steps per input"],
        run: () => goToControl("conditions", "sampling-steps"),
      },
      ...(samplingRunCount > 1
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
        (file): SetupCommand => ({
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
        id: "structure-3d",
        group: "Actions",
        label: "View structure in 3D",
        detail: `${analysis.summary.formula} · ${analysis.summary.atom_count} atoms`,
        keywords: ["3d", "viewer", "model", "rotate", "structure", "show"],
        run: () => setModal("structure"),
      },
      {
        id: "input-full",
        group: "Actions",
        label: "Show full input",
        detail: selectedFile?.name ?? "Generated input",
        keywords: ["input", "preview", "large", "expand", "full"],
        run: () => setModal("input"),
      },
      {
        id: "calculator-settings",
        group: "Actions",
        label: "Advanced settings",
        detail: molecularMechanics
          ? "Potentials, neighbour search, constraints"
          : "Calculator, QM run, constraints",
        keywords: ["settings", "advanced", "options", "extra", "keywords"],
        disabledReason:
          !molecularMechanics && !setup.runner
            ? "Choose a calculator first."
            : undefined,
        run: () => setModal("calculator"),
      },
      {
        id: "run-settings",
        group: "Actions",
        label: "Kinetic resets",
        detail: "Temperature rescaling, drift removal (Run › Steps)",
        keywords: ["reset", "rescale", "momentum", "drift", "nscale", "nreset"],
        disabledReason:
          setup.ensemble === "OPT" ? "Not used by an optimisation." : undefined,
        run: () => setModal("run"),
      },
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
    analysis.summary.atom_count,
    analysis.summary.formula,
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
    samplingRunCount,
    selectedFile?.name,
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
      const runName = `${stem || "pq"}-run`;
      // Read before setSetup: the updater runs later, after the ref moved on.
      const previousDerived = derivedRunName.current;
      derivedRunName.current = runName;
      setBaseStartFile(restartName);
      setSetup((existing) => ({
        ...existing,
        start_file: restartName,
        // A name the user typed in Output stays; only the derived one follows.
        file_prefix:
          existing.file_prefix === previousDerived
            ? runName
            : existing.file_prefix,
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
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) void importFiles(files);
  }

  async function addSetupFile(role: SetupFileRole, file: File) {
    const content = await file.text();
    const packageName = packagedSetupFileName(role, file.name);
    setSetupFiles((existing) => [
      ...existing.filter((item) => item.role !== role),
      { role, name: packageName, content },
    ]);
    setSetup((existing) => withSetupFileName(existing, role, packageName));
  }

  /**
   * Import a structure together with whatever companion files sit next to
   * it: a multi-select, a dropped folder, or a folder picked with "Folder".
   * Companions are sorted by name; the structure (an .rst wins) is analysed.
   */
  async function importFiles(files: File[]) {
    const structures = files.filter((file) => isStructureFileName(file.name));
    const structure =
      structures.find((file) => file.name.toLowerCase().endsWith(".rst")) ??
      structures[0] ??
      null;
    const companions = new Map<SetupFileRole, File>();
    for (const file of files) {
      if (file === structure) continue;
      const role = companionRoleForFileName(file.name);
      if (role && !companions.has(role)) companions.set(role, file);
    }
    try {
      await Promise.all(
        [...companions].map(([role, file]) => addSetupFile(role, file)),
      );
    } catch (error) {
      setNotice({ kind: "error", message: formatError(error) });
      return;
    }
    if (structure) {
      await useFile(structure);
    }
    if (companions.size > 0) {
      const roles = [...companions.keys()]
        .map((role) => defaultSetupFileName(role).split(".")[0])
        .join(", ");
      setNotice({
        kind: "success",
        message: structure
          ? `${structure.name} · ${roles}`
          : `Added ${roles}`,
      });
    } else if (!structure) {
      const names = files.map((file) => file.name).slice(0, 3).join(", ");
      setNotice({
        kind: "error",
        message: `${names}: not a structure (.rst, .xyz, .cif, .pdb, .mol, .sdf, .traj) or a companion file.`,
      });
    }
  }

  async function applyJitter() {
    if (!sourceFile) return;
    const sequence = ++perturbSequence.current;
    setPerturbing(true);
    setNotice(null);
    try {
      const result = await perturbFile(sourceFile, sigma, jitterSeed);
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
          ? `Prepared with σ = ${sigma} Å and seed ${jitterSeed}.`
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
      const required = qmSetupFileSpecs(runnerId, runnerScript, externalQM);
      const roles = new Set(required.map((file) => file.role));
      return {
        ...existing,
        preset_id: null,
        job_type: "qm-md",
        runner: runnerId,
        runner_script: runnerScript,
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
      const required = qmSetupFileSpecs(existing.runner, scriptName, externalQM);
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
      await addSetupFile(role, file);
    } catch (error) {
      setNotice({ kind: "error", message: formatError(error) });
    }
  }

  function setRunCount(count: number) {
    const clamped = clampSamplingRunCount(count);
    setSamplingRunCount(clamped);
    setSamplingRunCountDraft(String(clamped));
  }

  function commitSamplingRunCount() {
    setRunCount(
      commitSamplingRunCountDraft(samplingRunCountDraft, samplingRunCount),
    );
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
    // Only fill gaps; a thermostat or pressure chosen earlier survives a
    // detour through NVE / NVT and comes back unchanged.
    const previousDerived = derivedRunName.current;
    const nextDerived = sourceFile
      ? previousDerived
      : `water-${ensemble.toLowerCase()}`;
    derivedRunName.current = nextDerived;
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      ensemble,
      file_prefix:
        existing.file_prefix === previousDerived
          ? nextDerived
          : existing.file_prefix,
      thermostat: existing.thermostat ?? "velocity_rescaling",
      manostat: existing.manostat ?? "stochastic_rescaling",
      pressure_bar: existing.pressure_bar ?? 1.01325,
    }));
  }

  function chooseThermostat(
    thermostat: (typeof THERMOSTATS)[number]["value"],
  ) {
    if (setup.ensemble === "NVE") chooseSamplingEnsemble("NVT");
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      thermostat,
    }));
  }

  function chooseManostat(manostat: (typeof MANOSTATS)[number]["value"]) {
    chooseSamplingEnsemble("NPT");
    setSetup((existing) => ({
      ...existing,
      preset_id: null,
      manostat,
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
              className={`pq-tag ${bootstrap.pq.found ? "ok" : "portable"}`}
              title={
                bootstrap.pq.found
                  ? `PQ ${bootstrap.pq.version ?? "detected"}`
                  : "PQ is not installed locally. Packaging is available; run and validate with PQ on the target machine."
              }
              aria-label={
                bootstrap.pq.found
                  ? `Local PQ ${bootstrap.pq.version ?? "detected"}`
                  : "No local PQ. Packages can still be created."
              }
            >
              <span className="pq-tag-label">PQ</span>
              <span className="pq-tag-value">
                {bootstrap.pq.found
                  ? `PQ ${(bootstrap.pq.version ?? "detected").split("-")[0]}`
                  : "PQ not local"}
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
                multiple
                accept=".rst,.xyz,.cif,.pdb,.mol,.sdf,.traj,.extxyz,.dat,.template,.hsd"
                onChange={onFileChange}
              />
              <input
                ref={folderInput}
                className="visually-hidden"
                type="file"
                multiple
                onChange={onFileChange}
                {...{ webkitdirectory: "" }}
              />
              <div className="structure-card">
                <div
                  className="structure-summary"
                  aria-label="Current structure. Drop a file or a run folder here."
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault();
                    void filesFromDrop(event.dataTransfer).then((files) => {
                      if (files.length > 0) void importFiles(files);
                    });
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
                    <small className="structure-context">
                      {!sourceFile && "Example · "}
                      {analysis.structure.cell_generated
                        ? "vacuum cell"
                        : analysis.structure.cell
                          ? "periodic cell"
                          : "no cell"}
                      {analysis.summary.density_g_cm3 != null &&
                        ` · ${formatCompact(analysis.summary.density_g_cm3)} g/cm³`}
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
                    aria-haspopup="dialog"
                    title="View in 3D"
                    onClick={() => setModal("structure")}
                  >
                    <Rotate3d size={14} aria-hidden="true" />
                    3D
                  </button>
                  <button
                    type="button"
                    className="structure-replace"
                    aria-label="Import structure"
                    title="Import · RST · XYZ · CIF · PDB · MOL · SDF · TRAJ · select companion files along, or drop them here"
                    onClick={openFilePicker}
                  >
                    <Upload size={14} aria-hidden="true" />
                    Import
                  </button>
                  <button
                    type="button"
                    className="structure-replace"
                    aria-label="Import a run folder"
                    title="Pick a folder: the structure and companion files (moldescriptor, guff, topology, …) are sorted by name"
                    onClick={() => folderInput.current?.click()}
                  >
                    <FolderOpen size={14} aria-hidden="true" />
                    Folder
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
                        onChange={(event) => setSigma(Number(event.target.value))}
                      />
                    </Field>
                    <Field label="Seed" controlId="position-seed">
                      <input
                        type="number"
                        min="0"
                        max="4294967295"
                        step="1"
                        value={jitterSeed}
                        onChange={(event) =>
                          setJitterSeed(Number(event.target.value))
                        }
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
                    {preparationStale && (
                      <span className="preparation-stale">
                        {" "}· settings changed, apply again
                      </span>
                    )}
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

              <div className="run-band">
                {!molecularMechanics ? (
                  <ConditionRow
                    icon={Atom}
                    title="Calculator"
                    hint={
                      selectedRunnerStatus &&
                      runnerAvailability(selectedRunnerStatus) !== "ready" ? (
                        <span className="hint-warn">
                          {runnerAvailabilityLabel(
                            runnerAvailability(selectedRunnerStatus),
                          )}
                        </span>
                      ) : undefined
                    }
                    className="method-fields"
                  >
                    <Field label="Program" controlId="calculator">
                      <select
                        value={setup.runner ?? ""}
                        disabled={!bootstrap}
                        aria-invalid={!setup.runner || undefined}
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
                    </Field>
                    {electronicMethods.length > 0 &&
                      (electronicMethods.length > 1 ||
                        !electronicProgram?.recommended_script ||
                        !selectedElectronicMethod) && (
                        <Field label="Method" controlId="electronic-method">
                          <select
                            value={selectedElectronicMethod ? setup.runner_script ?? "" : ""}
                            aria-invalid={!selectedElectronicMethod || undefined}
                            onChange={(event) => {
                              if (event.target.value) {
                                chooseElectronicMethod(event.target.value);
                              }
                            }}
                          >
                            <option value="" disabled>
                              Choose method
                            </option>
                            {electronicMethods.map((method) => (
                              <option value={method.name} key={method.name}>
                                {method.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                    {setup.runner === "ase_xtb" && (
                      <Field label="Electronic model" controlId="xtb-model">
                        <select
                          value={extraString(
                            setup.extra_settings,
                            "xtb_method",
                            QM_DEFAULTS.xtb_method,
                          )}
                          onChange={(event) =>
                            setExtra(
                              "xtb_method",
                              event.target.value === QM_DEFAULTS.xtb_method
                                ? null
                                : event.target.value,
                            )
                          }
                        >
                          {XTB_METHODS.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {setup.runner && (
                      <SettingsLine
                        parts={settingsLines(effective)}
                        onOpen={() => setModal("calculator")}
                      />
                    )}
                  </ConditionRow>
                ) : (
                  <ConditionRow
                    icon={Boxes}
                    title="Force field"
                    info={
                      MM_MODES.find(
                        (option) => option.value === setup.mm_force_field,
                      )?.description
                    }
                    className="method-fields"
                  >
                    <fieldset className="mm-mode-fieldset condition-full">
                      <legend className="visually-hidden">
                        Interaction terms
                      </legend>
                      <div className="interaction-model-options mm-mode-options">
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
                            <strong>{option.label}</strong>
                          </label>
                        ))}
                      </div>
                    </fieldset>
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
                    <Field label="Coulomb cutoff" unit="Å" controlId="mm-cutoff">
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
                    <SettingsLine
                      parts={settingsLines(effective)}
                      onOpen={() => setModal("calculator")}
                    />
                  </ConditionRow>
                )}

                {methodFileSpecs.length > 0 && (
                  <ConditionRow
                    icon={Upload}
                    title="Files"
                    hint={methodFilesHint}
                    info={
                      molecularMechanics
                        ? "Force-field files PQ reads next to the input. Drop a run folder on the structure to add them all at once."
                        : "Optional files are packed only when added."
                    }
                  >
                    <div className="condition-full">
                      {molecularMechanics && !hasTypedMolecules && (
                        <div className="inline-warning" role="alert">
                          <CircleAlert size={15} aria-hidden="true" />
                          {sourceFile
                            ? "This structure has no molecule type IDs. Import a typed PQ restart (.rst)."
                            : "The built-in water example has no molecule type IDs. Import a typed PQ restart (.rst) for MM."}
                        </div>
                      )}
                      <SetupFileList
                        specs={methodFileSpecs}
                        files={setupFiles}
                        onChoose={chooseSetupFile}
                      />
                    </div>
                  </ConditionRow>
                )}
              </div>
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
              {setup.ensemble === "NPT" &&
                !molecularMechanics &&
                analysis.structure.cell_generated && (
                  <div className="inline-warning" role="alert">
                    <CircleAlert size={15} aria-hidden="true" />
                    NPT needs an imported physical periodic cell. This is a
                    generated vacuum cell.
                  </div>
                )}

              <ConditionRow
                icon={Zap}
                title="Initial velocities"
                info="PQ keeps velocities already present in the start restart. When enabled, it generates velocities at the chosen temperature only if they are absent."
                toggle={{
                  label: "Generate if absent",
                  controlId: "initial-velocities-control",
                  checked: setup.initialize_velocities,
                  onChange: (value) =>
                    setSetup((existing) => ({
                      ...existing,
                      initialize_velocities: value,
                    })),
                }}
              >
                <Field
                  label="Random seed"
                  controlId="run-random-seed"
                  info="Used for all random events in the PQ simulation, including generated velocities and stochastic coupling. Keep this value for a reproducible run."
                >
                  <input
                    type="number"
                    min="0"
                    max="4294967295"
                    step="1"
                    value={setup.random_seed}
                    onChange={(event) =>
                      setSetup((existing) => ({
                        ...existing,
                        random_seed: Number(event.target.value),
                      }))
                    }
                  />
                </Field>
              </ConditionRow>

              {/* Each condition is its own row: value + the coupling that
                  controls it. Nothing here depends on another row. */}
              {(thermalEnsemble || setup.initialize_velocities) && <ConditionRow
                icon={Thermometer}
                title="Temperature"
                info={
                  thermalEnsemble
                    ? undefined
                    : "NVE has no thermostat: this temperature only seeds the initial velocities."
                }
              >
                <Field
                  label={thermalEnsemble ? "Target" : "Initial"}
                  unit="K"
                  controlId="sampling-temperature"
                  info={
                    thermalEnsemble
                      ? undefined
                      : "Used to generate initial velocities if the restart has none. NVE has no thermostat."
                  }
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
                {thermalEnsemble && (
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
                )}
                {thermalEnsemble && (
                  <Field
                    label="Start"
                    unit="K"
                    controlId="sampling-start-temperature"
                    info="Optional. A different start temperature ramps linearly to the target over the ramp steps (or the whole run)."
                  >
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="= target"
                      value={setup.start_temperature_k ?? ""}
                      onChange={(event) => {
                        const value = event.target.value
                          ? Number(event.target.value)
                          : null;
                        setSetup((existing) => ({
                          ...existing,
                          preset_id: null,
                          start_temperature_k: value,
                          temperature_ramp_steps:
                            value == null ? null : existing.temperature_ramp_steps,
                        }));
                      }}
                    />
                  </Field>
                )}
                {thermalEnsemble && (
                  <Field label="Ramp" unit="steps" controlId="sampling-ramp-steps">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      disabled={setup.start_temperature_k == null}
                      placeholder={
                        setup.start_temperature_k == null ? "—" : "whole run"
                      }
                      value={setup.temperature_ramp_steps ?? ""}
                      onChange={(event) =>
                        setSetup((existing) => ({
                          ...existing,
                          preset_id: null,
                          temperature_ramp_steps: event.target.value
                            ? Number(event.target.value)
                            : null,
                        }))
                      }
                    />
                  </Field>
                )}
              </ConditionRow>
              }

              {setup.ensemble === "NPT" && (
                <ConditionRow icon={Gauge} title="Pressure">
                  <Field
                    label="Target"
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
                </ConditionRow>
              )}

              <ConditionRow
                icon={Timer}
                title="Steps"
                hint={
                  timestepWarning ? (
                    <span className="hint-warn">{timestepWarning}</span>
                  ) : (
                    samplingSpan
                  )
                }
              >
                <Field label="Sampling" unit="steps" controlId="sampling-steps">
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
                <Field
                  label="Runs"
                  controlId="sampling-run-count"
                  info="One input file per run. With more than one, each run continues from the previous run's restart file (run-01 → run-02 → …)."
                >
                  <input
                    type="number"
                    min={MIN_SAMPLING_RUNS}
                    max={MAX_SAMPLING_RUNS}
                    step="1"
                    inputMode="numeric"
                    value={samplingRunCountDraft}
                    onChange={(event) => {
                      const draft = event.target.value;
                      setSamplingRunCountDraft(draft);
                      const count = parseSamplingRunCountDraft(draft);
                      if (count !== null) setSamplingRunCount(count);
                    }}
                    onBlur={commitSamplingRunCount}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </Field>
                {setup.ensemble !== "OPT" && (
                  <SettingsLine
                    label="Resets"
                    icon={RotateCcw}
                    title="Kinetic resets"
                    parts={runSettingsLines(effective)}
                    onOpen={() => setModal("run")}
                  />
                )}
              </ConditionRow>

              {/* A separate NVT stage written as run-eq.in; sampling run 01
                  continues from its restart file. */}
              <ConditionRow
                icon={Flame}
                title="Equilibration"
                info="An NVT stage that runs before sampling, written as run-eq.in. Sampling run 01 starts from its restart file, velocities included."
                hint={
                  equilibration ? (
                    "NVT · runs first"
                  ) : setup.ensemble === "NPT" ? (
                    <span className="hint-warn">
                      recommended before pressure coupling
                    </span>
                  ) : (
                    "off"
                  )
                }
                toggle={{
                  checked: Boolean(equilibration),
                  onChange: chooseProtocol,
                }}
              >
                {equilibration && (
                  <>
                    <Field label="Steps" controlId="equilibration-steps">
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
                    <TemperatureCoupling
                      value={equilibration}
                      controlId="equilibration-thermostat"
                      onChange={(patch) =>
                        updateEquilibration({
                          ...patch,
                          thermostat: patch.thermostat ?? equilibration.thermostat,
                          thermostat_relaxation_ps:
                            patch.thermostat_relaxation_ps ??
                            equilibration.thermostat_relaxation_ps,
                        })
                      }
                    />
                  </>
                )}
              </ConditionRow>
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
              <div className="run-band">
                <ConditionRow
                  icon={PackageIcon}
                  title="Package"
                  hint={`${setup.file_prefix || "…"}.zip`}
                  className="output-fields"
                >
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
                  <Field
                    label="Write every"
                    unit="steps"
                    controlId="output-freq"
                    info="How often PQ writes the trajectory, energy and restart files."
                  >
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="1"
                      value={
                        typeof setup.extra_settings.output_freq === "number"
                          ? setup.extra_settings.output_freq
                          : ""
                      }
                      onChange={(event) =>
                        setExtra(
                          "output_freq",
                          event.target.value ? Number(event.target.value) : null,
                        )
                      }
                    />
                  </Field>
                </ConditionRow>

                <ConditionRow
                  icon={ready ? CheckCircle2 : CircleAlert}
                  title="Review"
                  hint={
                    rendering
                      ? "Checking inputs…"
                      : ready
                        ? "Ready to package"
                        : `${blockingIssues.length} ${
                            blockingIssues.length === 1 ? "issue" : "issues"
                          } to resolve`
                  }
                >
                  <div
                    className="condition-full setup-review"
                    id="setup-checks"
                    tabIndex={-1}
                  >
                    <dl className="review-facts">
                      <div>
                        <dt>Structure</dt>
                        <dd>
                          <ChemicalFormula formula={analysis.summary.formula} />
                          {` · ${analysis.summary.atom_count} atoms · `}
                          {analysis.structure.cell_generated
                            ? "vacuum cell"
                            : analysis.structure.cell
                              ? "periodic cell"
                              : "no cell"}
                        </dd>
                      </div>
                      <div>
                        <dt>Method</dt>
                        <dd>{methodSummary}</dd>
                      </div>
                      <div>
                        <dt>Sampling</dt>
                        <dd>
                          {setup.ensemble} · {samplingSpan ?? "set steps and timestep"}
                          {equilibration
                            ? ` · NVT equilibration ${formatDuration(
                                equilibration.steps * equilibration.timestep_fs,
                              )} first`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>Velocities</dt>
                        <dd>
                          {setup.initialize_velocities
                            ? "Keep restart velocities; generate if absent"
                            : "Use restart velocities without initialization"}
                          {` · random seed ${setup.random_seed}`}
                        </dd>
                      </div>
                      {(thermalEnsemble || setup.initialize_velocities) && (
                        <div>
                          <dt>Temperature</dt>
                          <dd>
                            {setup.temperature_k == null
                              ? "Not set"
                              : `${setup.temperature_k} K`}
                            {setup.ensemble === "NVE"
                              ? " for initial velocities only"
                              : ` · ${
                                  THERMOSTATS.find(
                                    (option) => option.value === setup.thermostat,
                                  )?.label ?? "choose a thermostat"
                                }`}
                            {setup.ensemble === "NPT" &&
                              ` · ${setup.pressure_bar ?? 1.01325} bar`}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Output</dt>
                        <dd>
                          {validOutputFrequency
                            ? `Every ${outputFrequency} ${outputFrequency === 1 ? "step" : "steps"}`
                            : `Write frequency ${outputFrequency} is invalid`}
                          {outputFrameCount != null &&
                            ` · ${outputFrameCount.toLocaleString()} frames per sampling input`}
                        </dd>
                      </div>
                    </dl>
                    {blockingIssues.length > 0 && (
                      <div className="review-check-list review-errors">
                        <h3>Fix before packaging</h3>
                        <ul>
                          {blockingIssues.map((issue, index) => (
                            <li key={`${issue.message}-${index}`}>
                              <button
                                type="button"
                                onClick={() =>
                                  goToControl(issue.section, issue.controlId)
                                }
                              >
                                <CircleAlert size={14} aria-hidden="true" />
                                <span>{issue.message}</span>
                                <ChevronRight size={14} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {warningDiagnostics.length > 0 && (
                      <div className="review-check-list review-warnings">
                        <h3>Check before running</h3>
                        <ul>
                          {warningDiagnostics.map((warning) => (
                            <li key={`${warning.code}:${warning.message}`}>
                              <button
                                type="button"
                                onClick={() =>
                                  goToControl(
                                    diagnosticStep(warning.code),
                                    diagnosticControl(warning.code),
                                  )
                                }
                              >
                                <CircleAlert size={14} aria-hidden="true" />
                                <span>{warning.message}</span>
                                <ChevronRight size={14} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!sourceFile && (
                      <p className="review-example">
                        Example only: one water molecule in a vacuum cell and a
                        short run. Choose a suitable structure, model and run
                        length for research use.
                      </p>
                    )}
                    <p className="review-scope">
                      {bootstrap &&
                        (!bootstrap.pq.validation_available ||
                          !bootstrap.pq.validation_scopes.includes("portable")) &&
                        "PQ parser check unavailable locally. "}
                      Local checks cover input validity. Confirm the physical
                      setup and validate on the machine that will run PQ.
                    </p>
                  </div>
                </ConditionRow>

                <ConditionRow
                  icon={FileCode2}
                  title="Inputs"
                  hint={
                    rendering
                      ? "Checking…"
                      : rendered && ready
                        ? `${rendered.files.length} ${
                            rendered.files.length === 1 ? "file" : "files"
                          }`
                        : rendered
                          ? "unavailable"
                          : undefined
                  }
                >
                  <div className="condition-full">
                    {rendered && ready && !rendering && selectedFile?.input_text ? (
                      <div
                        className="input-preview page-input-preview"
                        id="generated-input-preview"
                        role="region"
                        aria-label={`Input preview: ${
                          selectedFile?.name ?? "preparing inputs"
                        }`}
                      >
                        <div className="input-tabs">
                          <div className="input-tab-list" role="tablist">
                          {rendered.files.length <= MAX_INPUT_TABS ? (
                            rendered.files.map((file) => {
                              const active = file.name === selectedFile?.name;
                              return (
                                <button
                                  type="button"
                                  role="tab"
                                  aria-selected={active}
                                  aria-controls="generated-input-body"
                                  className={active ? "selected" : ""}
                                  key={file.name}
                                  onClick={() => setSelectedFileKey(file.name)}
                                >
                                  <span>{file.name}</span>
                                  <small>
                                    {file.stage_id === "equilibration"
                                      ? "eq"
                                      : samplingLabel(
                                          file.segment_index ?? file.stage_index,
                                        )}
                                  </small>
                                </button>
                              );
                            })
                          ) : (
                            <InputNavigator
                              rendered={rendered}
                              selectedFile={selectedFile}
                              selectedFileIndex={selectedFileIndex}
                              selectId={generatedInputSelectId}
                              equilibrationFiles={equilibrationFiles}
                              samplingFiles={samplingFiles}
                              onSelect={setSelectedFileKey}
                            />
                          )}
                          </div>
                          <div className="preview-title-actions">
                            {rendering && (
                              <LoaderCircle className="spin" size={15} />
                            )}
                            {preview.headerHidden || showInputHeader ? (
                              <button
                                type="button"
                                className="preview-header-toggle"
                                aria-pressed={showInputHeader}
                                onClick={() => setShowInputHeader((value) => !value)}
                              >
                                {showInputHeader ? "Hide header" : "Show header"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="preview-expand"
                              aria-label="Copy input"
                              title="Copy input"
                              disabled={!selectedFile?.input_text}
                              onClick={() =>
                                void navigator.clipboard.writeText(
                                  selectedFile?.input_text ?? "",
                                )
                              }
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="preview-expand"
                              aria-haspopup="dialog"
                              aria-label="Show full input"
                              title="Show full input"
                              onClick={() => setModal("input")}
                            >
                              <Maximize2 size={15} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        <pre
                          className="input-preview-body"
                          id="generated-input-body"
                          role="tabpanel"
                          key={`${selectedFile?.name ?? "none"}:${showInputHeader}`}
                        >
                          <InputSource
                            text={deferredPreview.text}
                            firstLine={deferredPreview.firstLine}
                          />
                        </pre>
                      </div>
                    ) : rendered ? (
                      <div
                        className="output-empty page-input-preview"
                        id="generated-input-preview"
                        role="status"
                      >
                        <CircleAlert size={18} aria-hidden="true" />
                        <strong>{rendering ? "Checking inputs…" : "Input preview unavailable"}</strong>
                        {!rendering && <span>Resolve the issues in Review to generate inputs.</span>}
                      </div>
                    ) : (
                      <div
                        className="output-empty page-input-preview"
                        id="generated-input-preview"
                        role="region"
                        aria-label="Input preview"
                      >
                        <LoaderCircle
                          className="spin"
                          size={22}
                          aria-hidden="true"
                        />
                        <FileCode2 size={16} aria-hidden="true" />
                        <strong>Generating input…</strong>
                      </div>
                    )}

                    {ready && <div className="footer-run" aria-label="Run command">
                      <Terminal size={14} aria-hidden="true" />
                      <code title={runLauncher.command}>
                        {runLauncher.command}
                      </code>
                      <button
                        type="button"
                        className="footer-run-copy"
                        aria-label="Copy run command"
                        title="Copy run command"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            runLauncher.command,
                          )
                        }
                      >
                        <Copy size={14} aria-hidden="true" />
                      </button>
                    </div>}
                  </div>
                </ConditionRow>
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
                  title="Review all issues"
                  aria-controls="setup-checks"
                  onClick={() =>
                    goToControl(
                      "review",
                      "setup-checks",
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

      <Modal
        open={modal === "structure"}
        size="full"
        title={
          <>
            <ChemicalFormula
              formula={analysis.summary.formula}
              fallback="Structure"
            />
            {" · "}
            {analysis.summary.atom_count}{" "}
            {analysis.summary.atom_count === 1 ? "atom" : "atoms"}
          </>
        }
        subtitle={analysis.structure.source_name}
        onClose={() => setModal(null)}
      >
        <StructureViewer
          variant="stage"
          analysis={analysis}
          defaultOpen
        />
      </Modal>

      <Modal
        open={modal === "input"}
        size="input"
        title={selectedFile?.name ?? "Generated input"}
        subtitle={
          selectedFile
            ? `${selectedFile.start_file} → ${selectedFile.restart_file}`
            : undefined
        }
        onClose={() => setModal(null)}
      >
        {rendered ? (
          <div className="input-preview modal-input-preview">
            <div className="preview-title">
              <InputNavigator
                rendered={rendered}
                selectedFile={selectedFile}
                selectedFileIndex={selectedFileIndex}
                selectId={modalInputSelectId}
                equilibrationFiles={equilibrationFiles}
                samplingFiles={samplingFiles}
                onSelect={setSelectedFileKey}
              />
              <div className="preview-title-actions">
                <button
                  type="button"
                  className="preview-expand"
                  aria-label="Copy input"
                  title="Copy input"
                  disabled={!selectedFile?.input_text}
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      selectedFile?.input_text ?? "",
                    )
                  }
                >
                  <Copy size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <pre className="input-preview-body">
              <InputSource text={deferredFullInputText} />
            </pre>
          </div>
        ) : (
          <div className="output-empty">
            <LoaderCircle className="spin" size={22} aria-hidden="true" />
            <strong>Generating input…</strong>
          </div>
        )}
      </Modal>

      <Modal
        open={modal === "calculator"}
        title="Advanced settings"
        subtitle={
          molecularMechanics
            ? MM_MODES.find((option) => option.value === setup.mm_force_field)
                ?.label
            : selectedRunnerStatus?.label ?? setup.runner ?? undefined
        }
        onClose={() => setModal(null)}
      >
        {molecularMechanics ? (
          <MMSettingsForm
            mode={setup.mm_force_field}
            extra={setup.extra_settings}
            setExtra={setExtra}
          />
        ) : (
          <QMSettingsForm
            runner={setup.runner}
            extra={setup.extra_settings}
            setExtra={setExtra}
          />
        )}
      </Modal>

      <Modal
        open={modal === "run"}
        title="Kinetic resets"
        subtitle={`${setup.ensemble} · applied by PQ's MD engine every step`}
        onClose={() => setModal(null)}
      >
        <RunSettingsForm
          thermal={isThermalEnsemble(setup)}
          extra={setup.extra_settings}
          setExtra={setExtra}
        />
      </Modal>

      <CommandPalette
        open={paletteOpen}
        commands={commands}
        groupOrder={COMMAND_GROUP_ORDER}
        placeholder="Search setup…"
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
