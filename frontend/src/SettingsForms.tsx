import { useId, type ReactElement, cloneElement } from "react";
import {
  LONG_RANGE_KINDS,
  MACE_MODELS,
  MACE_MODES,
  MACE_OFF_MODELS,
  MM_DEFAULTS,
  NONCOULOMB_KINDS,
  QM_DEFAULTS,
  SHAKE_MODES,
  SLAKOS_SETS,
  XTB_METHODS,
  dispersionDefault,
  extraBool,
  extraNumber,
  extraString,
  supportsDispersion,
  usesGuff,
  usesTopology,
  type ChoiceOption,
  type ExtraSettings,
  type ExtraValue,
} from "./calculatorSettings";
import type { MMForceFieldMode } from "./types";

type SetExtra = (key: string, value: ExtraValue | null) => void;

function Row({
  label,
  unit,
  hint,
  children,
}: {
  label: string;
  unit?: string;
  hint?: string;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="field-label">
        <label htmlFor={id}>{label}</label>
        {unit && <span className="unit">{unit}</span>}
      </span>
      {cloneElement(children, { id })}
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

function Choice({
  label,
  value,
  options,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  options: ChoiceOption[];
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="switch-row settings-toggle">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function numberOrNull(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw);
}

/** Advanced keywords for the selected QM calculator. */
export function QMSettingsForm({
  runner,
  extra,
  setExtra,
}: {
  runner: string | null;
  extra: ExtraSettings;
  setExtra: SetExtra;
}) {
  const isMace = runner === "mace_mp" || runner === "mace_off";
  const maceModel = extraString(extra, "mace_model", QM_DEFAULTS.mace_model);
  const slakos = extraString(extra, "slakos", QM_DEFAULTS.slakos);
  return (
    <div className="settings-form">
      {runner === "ase_xtb" && (
        <Choice
          label="xTB method"
          value={extraString(extra, "xtb_method", QM_DEFAULTS.xtb_method)}
          options={XTB_METHODS}
          onChange={(value) =>
            setExtra("xtb_method", value === QM_DEFAULTS.xtb_method ? null : value)
          }
        />
      )}

      {runner === "ase_dftbplus" && (
        <>
          <Choice
            label="Slater–Koster set"
            value={slakos}
            options={SLAKOS_SETS}
            onChange={(value) => {
              setExtra("slakos", value === QM_DEFAULTS.slakos ? null : value);
              if (value !== "custom") setExtra("slakos_path", null);
            }}
          />
          {slakos === "custom" && (
            <Row label="Slater–Koster path" hint="Directory with the .skf files">
              <input
                value={extraString(extra, "slakos_path", "")}
                placeholder="/path/to/skf"
                onChange={(event) =>
                  setExtra("slakos_path", event.target.value || null)
                }
              />
            </Row>
          )}
          <Toggle
            label="Third-order expansion"
            hint="Implied by 3ob"
            checked={extraBool(extra, "third_order", slakos === "3ob")}
            onChange={(value) => setExtra("third_order", value)}
          />
        </>
      )}

      {isMace && (
        <>
          <Choice
            label="MACE model"
            value={maceModel}
            options={runner === "mace_off" ? MACE_OFF_MODELS : MACE_MODELS}
            onChange={(value) => {
              setExtra("mace_model", value === QM_DEFAULTS.mace_model ? null : value);
              if (value !== "custom") setExtra("mace_model_path", null);
            }}
          />
          {maceModel === "custom" && (
            <Row label="Model path or URL">
              <input
                value={extraString(extra, "mace_model_path", "")}
                placeholder="https://… or /path/to/model"
                onChange={(event) =>
                  setExtra("mace_model_path", event.target.value || null)
                }
              />
            </Row>
          )}
          <Choice
            label="Evaluation"
            value={extraString(extra, "mace_mode", QM_DEFAULTS.mace_mode)}
            options={MACE_MODES}
            hint="fast needs cuequivariance + CUDA ops"
            onChange={(value) =>
              setExtra("mace_mode", value === QM_DEFAULTS.mace_mode ? null : value)
            }
          />
        </>
      )}

      {supportsDispersion(runner) && (
        <Toggle
          label="Dispersion correction"
          checked={extraBool(extra, "dispersion", dispersionDefault(runner))}
          onChange={(value) => setExtra("dispersion", value)}
        />
      )}

      <Row
        label="QM time limit"
        unit="s"
        hint="Per-step wall-clock cap · 0 disables"
      >
        <input
          type="number"
          min="0"
          step="60"
          value={extraNumber(extra, "qm_loop_time_limit") ?? ""}
          placeholder={String(QM_DEFAULTS.qm_loop_time_limit)}
          onChange={(event) =>
            setExtra("qm_loop_time_limit", numberOrNull(event.target.value))
          }
        />
      </Row>
    </div>
  );
}

/** Advanced keywords for molecular-mechanics runs. */
export function MMSettingsForm({
  mode,
  extra,
  setExtra,
}: {
  mode: MMForceFieldMode;
  extra: ExtraSettings;
  setExtra: SetExtra;
}) {
  const longRange = extraString(extra, "long_range", MM_DEFAULTS.long_range);
  const shake = extraString(extra, "shake", MM_DEFAULTS.shake);
  return (
    <div className="settings-form">
      {usesGuff(mode) && (
        <Choice
          label="Non-Coulomb potential"
          value={extraString(extra, "noncoulomb", MM_DEFAULTS.noncoulomb)}
          options={NONCOULOMB_KINDS}
          hint="Quick routines replace the full GUFF formalism"
          onChange={(value) =>
            setExtra("noncoulomb", value === MM_DEFAULTS.noncoulomb ? null : value)
          }
        />
      )}
      <Row label="Non-Coulomb cutoff" unit="Å" hint="Defaults to the Coulomb cutoff">
        <input
          type="number"
          min="0"
          step="0.1"
          value={extraNumber(extra, "rnoncoulomb") ?? ""}
          placeholder="= Coulomb cutoff"
          onChange={(event) =>
            setExtra("rnoncoulomb", numberOrNull(event.target.value))
          }
        />
      </Row>
      <Choice
        label="Long-range correction"
        value={longRange}
        options={LONG_RANGE_KINDS}
        onChange={(value) => {
          setExtra("long_range", value === MM_DEFAULTS.long_range ? null : value);
          if (value !== "wolf") setExtra("wolf_param", null);
          if (value !== "reaction-field") setExtra("rf_epsilon", null);
        }}
      />
      {longRange === "wolf" && (
        <Row label="Wolf parameter" unit="Å⁻¹">
          <input
            type="number"
            min="0"
            step="0.01"
            value={extraNumber(extra, "wolf_param") ?? ""}
            placeholder={String(MM_DEFAULTS.wolf_param)}
            onChange={(event) =>
              setExtra("wolf_param", numberOrNull(event.target.value))
            }
          />
        </Row>
      )}
      {longRange === "reaction-field" && (
        <Row label="Dielectric constant" hint="Required for reaction field">
          <input
            type="number"
            min="1"
            step="0.1"
            value={extraNumber(extra, "rf_epsilon") ?? ""}
            onChange={(event) =>
              setExtra("rf_epsilon", numberOrNull(event.target.value))
            }
          />
        </Row>
      )}

      {usesTopology(mode) && (
        <>
          <Choice
            label="Bond constraints"
            value={shake}
            options={SHAKE_MODES}
            hint="Constraints come from the topology file"
            onChange={(value) => {
              setExtra("shake", value === MM_DEFAULTS.shake ? null : value);
              if (value === "off") {
                setExtra("shake-tolerance", null);
                setExtra("shake-iter", null);
              }
            }}
          />
          {shake !== "off" && (
            <div className="form-grid">
              <Row label="Tolerance">
                <input
                  type="number"
                  min="0"
                  step="1e-9"
                  value={extraNumber(extra, "shake-tolerance") ?? ""}
                  placeholder={String(MM_DEFAULTS["shake-tolerance"])}
                  onChange={(event) =>
                    setExtra("shake-tolerance", numberOrNull(event.target.value))
                  }
                />
              </Row>
              <Row label="Max iterations">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={extraNumber(extra, "shake-iter") ?? ""}
                  placeholder={String(MM_DEFAULTS["shake-iter"])}
                  onChange={(event) =>
                    setExtra("shake-iter", numberOrNull(event.target.value))
                  }
                />
              </Row>
            </div>
          )}
        </>
      )}
    </div>
  );
}
