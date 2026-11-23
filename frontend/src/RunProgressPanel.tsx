import { useEffect, useState } from "react";

type RunProgress = { state: "waiting" } | {
  state: "running" | "completed" | "failed";
  stage: number;
  completed: number;
  total: number;
  exit_code: number;
};

export function RunProgressPanel() {
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      try {
        const response = await fetch("/api/run/progress", { signal: controller.signal });
        if (!response.ok) throw new Error("Progress unavailable");
        const next: RunProgress = await response.json();
        if (controller.signal.aborted) return;
        setProgress(next);
        setUnavailable(false);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(update, 2000);
      }
    }
    void update();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const count = progress?.state !== "waiting" ? progress : null;
  const label = unavailable ? "Run progress unavailable"
    : !count ? progress ? "Waiting for run" : "Checking run…"
    : count.state === "completed" ? "Run completed"
    : count.state === "failed" ? `Run failed on input ${count.stage}`
    : `Last reported: input ${count.stage} of ${count.total} running`;

  return <section className="setup-section run-progress" aria-labelledby="run-progress-title">
    <h2 className="section-title" id="run-progress-title">Run progress</h2>
    <div className="run-progress-status" role="status">
      <span>{label}</span>
      {count && !unavailable && <span>{count.completed} / {count.total} inputs</span>}
    </div>
    {count && !unavailable && <progress max={count.total} value={count.completed} aria-label="Inputs completed" />}
  </section>;
}
