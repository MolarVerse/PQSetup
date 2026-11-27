import type {
  Bootstrap,
  EquilibrationStage,
  PlanRenderResult,
  PreparationMetadata,
  PerturbationResult,
  SetupFile,
  SetupFileReference,
  SimulationSetup,
  Structure,
  StructureAnalysis,
} from "./types";

export function errorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "object" && item !== null) {
          if ("msg" in item && typeof item.msg === "string") {
            return item.msg;
          }
          if ("message" in item && typeof item.message === "string") {
            const file =
              "file" in item && typeof item.file === "string"
                ? item.file
                : null;
            const line =
              "line" in item && typeof item.line === "number"
                ? item.line
                : null;
            const location = file
              ? `${file}${line == null ? "" : `:${line}`}`
              : null;
            return location ? `${item.message} · ${location}` : item.message;
          }
        }
        return null;
      })
      .filter((value): value is string => Boolean(value));
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: unknown }
      | null;
    throw new Error(
      errorDetail(payload?.detail, `Request failed (${response.status})`),
    );
  }
  return response.json() as Promise<T>;
}

export async function getBootstrap(): Promise<Bootstrap> {
  return readJson(await fetch("/api/bootstrap"));
}

export async function analyzeFile(file: File): Promise<StructureAnalysis> {
  const body = new FormData();
  body.append("file", file);
  return readJson(
    await fetch("/api/structure/analyze", { method: "POST", body }),
  );
}

export async function prepareCrystal(file: File, repeats: string[], block: string): Promise<File> {
  const body = new FormData();
  body.append("file", file);
  ["a", "b", "c"].forEach((axis, index) => body.append(`repeat_${axis}`, repeats[index]));
  if (block.trim()) body.append("block", block.trim());
  const response = await fetch("/api/structure/crystal", { method: "POST", body });
  if (!response.ok) await readJson(response);
  return new File([await response.blob()], file.name.replace(/\.cif$/i, "-supercell.rst"));
}

export async function importAmber(topology: File, coordinates: File): Promise<{
  analysis: StructureAnalysis;
  setup_files: SetupFile[];
  restart: string;
  cutoff: number;
  settings: SimulationSetup["extra_settings"];
}> {
  const body = new FormData();
  body.append("topology", topology);
  body.append("coordinates", coordinates);
  return readJson(await fetch("/api/structure/amber", { method: "POST", body }));
}

export async function perturbFile(
  file: File,
  sigma: number,
  seed: number,
): Promise<PerturbationResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("sigma_angstrom", String(sigma));
  body.append("seed", String(seed));
  return readJson(
    await fetch("/api/structure/perturb", { method: "POST", body }),
  );
}

export async function renderPlan(
  setup: SimulationSetup,
  equilibration: EquilibrationStage | null,
  samplingRunCount: number,
  setupFiles: SetupFileReference[],
  structure: Structure,
): Promise<PlanRenderResult> {
  return readJson(
    await fetch("/api/plan/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setup,
        equilibration,
        sampling_run_count: samplingRunCount,
        setup_files: setupFiles,
        structure,
      }),
    }),
  );
}

export async function submitProject(
  setup: SimulationSetup,
  structure: Structure,
  projectName: string,
  preparation: PreparationMetadata | null,
  equilibration: EquilibrationStage | null,
  samplingRunCount: number,
  setupFiles: SetupFile[],
  start = false,
): Promise<Response> {
  const response = await fetch(start ? "/api/run/start" : "/api/project/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      setup,
      structure,
      project_name: projectName,
      preparation,
      equilibration,
      sampling_run_count: samplingRunCount,
      setup_files: setupFiles,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { detail?: unknown }
      | null;
    throw new Error(
      errorDetail(payload?.detail, `${start ? "Start failed" : "Export failed"} (${response.status})`),
    );
  }
  return response;
}

export async function exportProject(...args: Parameters<typeof submitProject>): Promise<Blob> {
  return (await submitProject(...args)).blob();
}
