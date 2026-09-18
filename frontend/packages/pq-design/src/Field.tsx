import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import Info from "./Info";

export interface FieldProps {
  label: ReactNode;
  /** Unit shown right of the label, e.g. "K" or "fs". */
  unit?: string;
  /** Tooltip text behind the ⓘ affordance. */
  info?: string;
  /** Use an existing id instead of a generated one. */
  controlId?: string;
  /** Span two grid columns, for selects with long option labels. */
  wide?: boolean;
  /** Exactly one control; it receives the field id. */
  children: ReactElement<{ id?: string }>;
}

/** Labelled control: label row (label · unit · ⓘ) above a single input. */
export default function Field({
  label,
  unit,
  info,
  controlId,
  wide,
  children,
}: FieldProps) {
  const generatedId = useId();
  const id = controlId ?? generatedId;

  return (
    <div className={wide ? "field field-wide" : "field"}>
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        <span className="field-label-tools">
          {unit && <span className="unit">{unit}</span>}
          {info && <Info text={info} />}
        </span>
      </span>
      {cloneElement(children, { id })}
    </div>
  );
}
