export type DiagnosticStep = "system" | "method" | "conditions";

export function diagnosticStep(code: string): DiagnosticStep {
  if (code.startsWith("structure.") || code.startsWith("cell.")) {
    return "system";
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
  return "conditions";
}
