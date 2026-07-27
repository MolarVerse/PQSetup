export const MIN_SAMPLING_RUNS = 1;
export const MAX_SAMPLING_RUNS = 99;

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

export function samplingRunSummary(
  samplingRunCount: number,
  hasEquilibration: boolean,
): string {
  const count = clampSamplingRunCount(samplingRunCount);
  const files = count === 1 ? "file" : "files";
  if (hasEquilibration) return `${count} sampling ${files} · from eq`;
  if (count === 1) return "1 sampling file";

  const continuation =
    count === 2 ? "02 continued" : `02–${samplingLabel(count)} continued`;
  return `${count} sampling files · ${continuation}`;
}

export function compactRunFileNames(
  hasEquilibration: boolean,
  samplingRunCount: number,
): string[] {
  const count = clampSamplingRunCount(samplingRunCount);
  const names = hasEquilibration ? ["run-eq.in"] : [];
  const indices =
    count <= 4 ? Array.from({ length: count }, (_, index) => index + 1) : [1, 2];

  names.push(...indices.map((index) => `run-${samplingLabel(index)}.in`));
  if (count > 4) {
    names.push("…", `run-${samplingLabel(count)}.in`);
  }
  return names;
}
