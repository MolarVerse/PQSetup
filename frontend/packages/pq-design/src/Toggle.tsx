import type { ReactNode } from "react";
import Info from "./Info";

export interface ToggleProps {
  label: ReactNode;
  /** Secondary line under the label. */
  detail?: ReactNode;
  /** Tooltip text behind the ⓘ affordance. */
  info?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}

/**
 * Switch row: label (with optional detail/ⓘ) on the left, switch on the right.
 * Consecutive toggles inside a Group separate with hairlines.
 */
export default function Toggle({
  label,
  detail,
  info,
  checked,
  disabled,
  onChange,
  className,
}: ToggleProps) {
  return (
    <label
      className={`switch-row settings-toggle${className ? ` ${className}` : ""}`}
    >
      <span>
        <strong>{label}</strong>
        {info && <Info text={info} />}
        {detail && <small>{detail}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
