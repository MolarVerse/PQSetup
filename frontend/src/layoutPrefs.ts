/** Persisted layout sizes for the student GUI split panes. */

export const OUTPUT_WIDTH_KEY = "pqsetup.outputWidth";
export const VIEWER_HEIGHT_KEY = "pqsetup.viewerHeight";

export const OUTPUT_WIDTH_DEFAULT = 380;
export const OUTPUT_WIDTH_MIN = 280;
export const OUTPUT_WIDTH_MAX = 720;

export const VIEWER_HEIGHT_DEFAULT = 280;
export const VIEWER_HEIGHT_MIN = 140;
export const VIEWER_HEIGHT_MAX = 640;

export function readLayoutNumber(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  } catch {
    return fallback;
  }
}

export function writeLayoutNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* private mode / blocked storage */
  }
}

export function clampLayoutNumber(
  value: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, value));
}

const layoutWriteTimers = new Map<string, number>();

/** Persist a layout value after a short idle period to avoid storage churn. */
export function scheduleLayoutWrite(key: string, value: number): void {
  const existing = layoutWriteTimers.get(key);
  if (existing != null) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    layoutWriteTimers.delete(key);
    writeLayoutNumber(key, value);
  }, 150);
  layoutWriteTimers.set(key, timer);
}
