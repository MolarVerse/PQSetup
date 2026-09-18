import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Info from "./Info";

export interface ConditionRowProps {
  icon: LucideIcon;
  title: string;
  /** Short status text next to the title, e.g. "2 of 3 added". */
  hint?: ReactNode;
  /** Tooltip text behind the ⓘ affordance. */
  info?: string;
  /** Switch in the head that enables the whole row. */
  toggle?: { label?: string; checked: boolean; onChange: (on: boolean) => void };
  /** Extra control at the far right of the head. */
  action?: ReactNode;
  /** Class for the fields grid. */
  className?: string;
  children?: ReactNode;
}

/**
 * Self-contained settings row: icon + title head, optional switch, and a
 * grid of fields below. Rows stack; each one owns exactly one concern.
 */
export default function ConditionRow({
  icon: Icon,
  title,
  hint,
  info,
  toggle,
  action,
  className,
  children,
}: ConditionRowProps) {
  return (
    <div className="condition-row">
      <div className="condition-head">
        <Icon size={14} aria-hidden="true" />
        <span className="condition-title">{title}</span>
        {info && <Info text={info} />}
        {hint && <span className="condition-hint">{hint}</span>}
        {toggle && (
          <label className="condition-toggle">
            {toggle.label && <span>{toggle.label}</span>}
            <input
              type="checkbox"
              aria-label={toggle.label ?? title}
              checked={toggle.checked}
              onChange={(event) => toggle.onChange(event.target.checked)}
            />
            <span className="switch" aria-hidden="true" />
          </label>
        )}
        {action && <div className="condition-action">{action}</div>}
      </div>
      {children && (
        <div className={`condition-fields${className ? ` ${className}` : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}
