import { ChevronDown, SlidersHorizontal } from "lucide-react";

/** Chip that opens the calculator / force-field settings dialog. */
export function SettingsChip({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      className="option-chip settings-chip"
      aria-haspopup="dialog"
      title="Advanced settings"
      onClick={onOpen}
    >
      <SlidersHorizontal size={14} aria-hidden="true" />
      <span>Advanced</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
  );
}

/** Advanced button under the model selection; the keywords in force follow
 *  in input-file form, so what you read here is what the file will say. */
export function SettingsLine({ parts, onOpen }: { parts: string[]; onOpen: () => void }) {
  return (
    <div className="settings-line condition-full">
      <SettingsChip onOpen={onOpen} />
      {parts.length > 0 && (
        <code className="settings-summary" aria-label="Advanced settings in use">
          {parts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </code>
      )}
    </div>
  );
}
