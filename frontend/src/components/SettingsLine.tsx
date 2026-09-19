import { ChevronDown, SlidersHorizontal, type LucideIcon } from "lucide-react";

/** Chip that opens a settings dialog; defaults to the method's "Advanced". */
export function SettingsChip({
  onOpen,
  label = "Advanced",
  icon: Icon = SlidersHorizontal,
  title = "Advanced settings",
}: {
  onOpen: () => void;
  label?: string;
  icon?: LucideIcon;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="option-chip settings-chip"
      aria-haspopup="dialog"
      title={title}
      onClick={onOpen}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{label}</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
  );
}

/** Settings button with the keywords in force after it, in input-file form,
 *  so what you read here is what the file will say. */
export function SettingsLine({
  parts,
  onOpen,
  label,
  icon,
  title,
}: {
  parts: string[];
  onOpen: () => void;
  label?: string;
  icon?: LucideIcon;
  title?: string;
}) {
  return (
    <div className="settings-line condition-full">
      <SettingsChip onOpen={onOpen} label={label} icon={icon} title={title} />
      {parts.length > 0 && (
        <code
          className="settings-summary"
          aria-label={`${title ?? "Advanced settings"} in use`}
        >
          {parts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </code>
      )}
    </div>
  );
}
