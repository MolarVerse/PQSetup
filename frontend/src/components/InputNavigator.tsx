import { ChevronLeft, ChevronRight, FileCode2 } from "lucide-react";
import { plannedInputOptionLabel } from "../runPlan";
import type { PlanRenderResult } from "../types";

export default function InputNavigator({
  rendered,
  selectedFile,
  selectedFileIndex,
  selectId,
  equilibrationFiles,
  samplingFiles,
  onSelect,
}: {
  rendered: PlanRenderResult;
  selectedFile: PlanRenderResult["files"][number] | null;
  selectedFileIndex: number;
  selectId: string;
  equilibrationFiles: PlanRenderResult["files"];
  samplingFiles: PlanRenderResult["files"];
  onSelect: (name: string) => void;
}) {
  if (rendered.files.length <= 1) {
    return (
      <span>
        <FileCode2 size={16} aria-hidden="true" />
        {selectedFile?.name ?? "…"}
      </span>
    );
  }

  return (
    <div className="input-navigator preview-navigator">
      <button
        type="button"
        aria-label="Previous input"
        aria-controls="generated-input-preview"
        disabled={selectedFileIndex <= 0}
        onClick={() => {
          if (selectedFileIndex <= 0) return;
          onSelect(rendered.files[selectedFileIndex - 1].name);
        }}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <label htmlFor={selectId}>
        <span className="visually-hidden">Generated input</span>
        <select
          id={selectId}
          aria-label="Generated input"
          aria-controls="generated-input-preview"
          value={selectedFile?.name ?? ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {equilibrationFiles.length > 0 && (
            <optgroup label="Equilibration">
              {equilibrationFiles.map((file) => (
                <option key={file.name} value={file.name}>
                  {plannedInputOptionLabel(file, rendered.files.length)}
                </option>
              ))}
            </optgroup>
          )}
          {samplingFiles.length > 0 && (
            <optgroup label="Sampling">
              {samplingFiles.map((file) => (
                <option key={file.name} value={file.name}>
                  {plannedInputOptionLabel(file, rendered.files.length)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <output aria-live="polite">
        {selectedFileIndex + 1} of {rendered.files.length}
      </output>
      <button
        type="button"
        aria-label="Next input"
        aria-controls="generated-input-preview"
        disabled={
          selectedFileIndex < 0 ||
          selectedFileIndex >= rendered.files.length - 1
        }
        onClick={() => {
          if (
            selectedFileIndex < 0 ||
            selectedFileIndex >= rendered.files.length - 1
          ) {
            return;
          }
          onSelect(rendered.files[selectedFileIndex + 1].name);
        }}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
