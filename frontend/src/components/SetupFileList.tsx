import { Check, CircleAlert, CircleDashed, Upload } from "lucide-react";
import type { ChangeEvent } from "react";
import type { SetupFileSpec } from "../method";
import type { SetupFile, SetupFileRole } from "../types";

function SetupFileStatus({
  selected,
  optional,
}: {
  selected: boolean;
  optional?: boolean;
}) {
  if (selected) {
    return (
      <span className="file-added" title="Added">
        <Check size={14} aria-hidden="true" />
        Added
      </span>
    );
  }
  if (optional) {
    return (
      <span className="file-optional" title="Optional file">
        <CircleDashed size={14} aria-hidden="true" />
        Optional
      </span>
    );
  }
  return (
    <span className="file-required" title="Required file">
      <CircleAlert size={14} aria-hidden="true" />
      Add file
    </span>
  );
}

export default function SetupFileList({
  specs,
  files,
  onChoose,
}: {
  specs: SetupFileSpec[];
  files: SetupFile[];
  onChoose: (role: SetupFileRole, event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="setup-file-list" aria-label="Files">
      {specs.map((spec) => {
        const selected = files.find((file) => file.role === spec.role);
        return (
          <label className={selected ? "selected" : ""} key={spec.role}>
            <input
              className="setup-file-input"
              type="file"
              onChange={(event) => onChoose(spec.role, event)}
            />
            <Upload size={16} aria-hidden="true" />
            <span>
              <strong>{spec.label}</strong>
              <small>{selected?.name ?? spec.defaultName}</small>
            </span>
            <SetupFileStatus
              selected={Boolean(selected)}
              optional={spec.optional}
            />
          </label>
        );
      })}
    </div>
  );
}
