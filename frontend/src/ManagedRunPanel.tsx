import { useEffect, useState } from "react";

type RunProgress = { state: "idle" } | {
  state: "running" | "completed" | "failed";
  steps: number;
  target: number;
  stage: number;
  total: number;
  exit_code: number | null;
  log_tail?: string;
  elapsed_seconds: number;
  eta_seconds: number | null;
  steps_per_second: number | null;
  outputs: { stage: number; label: string; viewer: string | null; enalyzer: string | null }[];
};

export function ManagedRunPanel({ revision, onRunning }: {
  revision: number;
  onRunning: (active: boolean) => void;
}) {
  const [run, setRun] = useState<RunProgress>({ state: "idle" });
  const [details, setDetails] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/run/managed", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const next: RunProgress = await response.json();
        if (controller.signal.aborted) return;
        setRun(next);
        setOffline(false);
        onRunning(next.state === "running");
      } catch {
        if (!controller.signal.aborted) setOffline(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision, onRunning]);

  if (run.state === "idle") return null;
  const stage = run.outputs.find((output) => output.stage === run.stage)?.label;
  const label = offline ? "Run progress unavailable"
    : run.state === "completed" ? "Simulation finished"
      : run.state === "failed" ? `Simulation failed${stage ? ` · ${stage}` : ""}`
        : stage ? `${stage} · stage ${run.stage} of ${run.total}` : "Starting simulation…";

  const viewer = [...run.outputs].reverse().find((output) => output.viewer);
  const analysis = [...run.outputs].reverse().find((output) => output.enalyzer);
  return <section className="managed-run" aria-label="Simulation progress">
    <div className="managed-run-heading">
      <div className="managed-run-summary" role="status">
        <strong>{label}</strong>
        {run.target > 0 && <span>{run.steps.toLocaleString()} / {run.target.toLocaleString()} steps
          {!offline && run.state === "running" && run.eta_seconds != null && ` · ~${duration(run.eta_seconds)} left`}
        </span>}
      </div>
      <button type="button" className="run-details" aria-expanded={details}
        aria-controls="managed-run-details" onClick={() => setDetails(!details)}>Details</button>
    </div>
    {run.target > 0 && <progress aria-label={offline ? "Last reported simulation progress" : "Simulation steps"}
      value={run.steps} max={run.target} />}
    {(viewer || analysis) && <nav className="run-views" aria-label="Simulation outputs">
      {viewer && <a href={`/run-app/viewer/${viewer.stage}/`}>
        <img src="/pqviewer-logo.png" alt="" width="18" height="18" />
        PQViewer
      </a>}
      {analysis && <a href={`/run-app/enalyzer/${analysis.stage}/`}>
        <img src="/pqenalyzer-logo.png" alt="" width="18" height="18" />
        PQEnalyzer
      </a>}
    </nav>}
    <div id="managed-run-details" className="managed-run-details" hidden={!details}>
      {run.state === "failed" && <>
        <div>Exit code: {run.exit_code}</div>
        {run.log_tail && <pre className="managed-run-log" aria-label="Recent simulation log">{run.log_tail}</pre>}
      </>}
      <div>Elapsed: {duration(run.elapsed_seconds)}</div>
      {run.steps_per_second != null && <div>Recent speed: {Math.round(run.steps_per_second).toLocaleString()} steps/s</div>}
      {run.outputs.length > 1 && run.outputs.map((output) =>
        <div key={output.stage} className="run-stage">
          <span>{output.label}</span>
          {output.viewer && <a href={`/run-app/viewer/${output.stage}/`}>Trajectory</a>}
          {output.enalyzer && <a href={`/run-app/enalyzer/${output.stage}/`}>Analysis</a>}
        </div>)}
    </div>
  </section>;
}

function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
