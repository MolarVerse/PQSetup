import type { PlannedInput } from "./types";

export const MIN_SAMPLING_RUNS = 1;
export const MAX_SAMPLING_RUNS = 999;
export const DEFAULT_CONTINUED_SAMPLING_RUNS = 3;

export function clampSamplingRunCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_SAMPLING_RUNS;
  return Math.min(
    MAX_SAMPLING_RUNS,
    Math.max(MIN_SAMPLING_RUNS, Math.trunc(value)),
  );
}

export function parseSamplingRunCountDraft(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < MIN_SAMPLING_RUNS || parsed > MAX_SAMPLING_RUNS) return null;
  return parsed;
}

export function commitSamplingRunCountDraft(
  value: string,
  fallback: number,
): number {
  if (!value.trim()) return clampSamplingRunCount(fallback);
  return clampSamplingRunCount(Number(value));
}

export function samplingLabel(index: number): string {
  return String(index).padStart(2, "0");
}

export function plannedInputOptionLabel(
  file: PlannedInput,
  totalFiles: number,
): string {
  if (file.stage_id === "equilibration") {
    return `eq · ${file.name} — Equilibration`;
  }
  const segmentIndex = file.segment_index ?? file.stage_index;
  const segmentCount = file.segment_count ?? totalFiles;
  return `${samplingLabel(segmentIndex)} · ${file.name} — Sampling ${segmentIndex} of ${segmentCount}`;
}

export function nextPlannedInputSelection(
  currentName: string | null,
  previousFirstName: string | null,
  files: PlannedInput[],
): string | null {
  const firstName = files[0]?.name ?? null;
  if (firstName !== previousFirstName) return firstName;
  if (currentName && files.some((file) => file.name === currentName)) {
    return currentName;
  }
  return firstName;
}
