export type DiagnosticStep = "system" | "method" | "conditions" | "review";

/** Which page section owns the control a diagnostic code talks about. */
export function diagnosticStep(code: string): DiagnosticStep {
  if (
    code.startsWith("structure.") ||
    code.startsWith("cell.") ||
    code === "input.start_file" ||
    code === "run.random_seed"
  ) {
    return "system";
  }
  // The QM molecule descriptor is picked in Run › Pressure, not in Method.
  if (code.startsWith("qm.") && code.includes("moldescriptor")) {
    return "conditions";
  }
  if (
    code.startsWith("method.") ||
    code.startsWith("mm.") ||
    code.startsWith("qm.") ||
    code.startsWith("runner.") ||
    code.startsWith("calculator.") ||
    code.startsWith("pq.") ||
    code.startsWith("environment.pq")
  ) {
    return "method";
  }
  if (code.startsWith("input.")) {
    return "review";
  }
  return "conditions";
}

const CONTROLS: Record<string, string> = {
  "input.file_prefix": "run-name",
  "conditions.temperature": "sampling-temperature",
  "conditions.pressure": "sampling-pressure",
  "conditions.thermostat": "sampling-thermostat",
  "conditions.manostat": "sampling-manostat",
  "conditions.steps": "sampling-steps",
  "conditions.timestep": "sampling-timestep",
  "run.random_seed": "position-seed",
  "mm.density": "mm-density",
};

/** The control to focus for a diagnostic code, when one exists on the page. */
export function diagnosticControl(code: string): string | undefined {
  return CONTROLS[code];
}
