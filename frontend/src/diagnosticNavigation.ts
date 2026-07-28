export type DiagnosticStep = "system" | "method" | "conditions";

export function diagnosticStep(code: string): DiagnosticStep {
  if (code.startsWith("structure.") || code.startsWith("cell.")) {
    return "system";
  }
  if (
    code.startsWith("method.") ||
    code.startsWith("mm.") ||
    code.startsWith("runner.") ||
    code.startsWith("calculator.") ||
    code.startsWith("pq.")
  ) {
    return "method";
  }
  return "conditions";
}
