interface ChemicalFormulaProps {
  formula: string | null | undefined;
  fallback?: string;
}

export default function ChemicalFormula({
  formula,
  fallback = "—",
}: ChemicalFormulaProps) {
  if (!formula) return <>{fallback}</>;

  return (
    <span className="chemical-formula" aria-label={formula}>
      {formula.split(/(\d+)/).map((part, index) =>
        /^\d+$/.test(part) ? (
          <sub aria-hidden="true" key={`${part}-${index}`}>
            {part}
          </sub>
        ) : (
          <span aria-hidden="true" key={`${part}-${index}`}>
            {part}
          </span>
        ),
      )}
    </span>
  );
}
