import { useId, type ReactElement, type ReactNode, cloneElement } from "react";
import Info from "./Info";
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
  usesExternalScript,
  usesGuff,
  usesTopology,
  type ChoiceOption,
  type ExtraSettings,
  type ExtraValue,
} from "./calculatorSettings";
import type { MMForceFieldMode } from "./types";

type SetExtra = (key: string, value: ExtraValue | null) => void;

/** Hairline-titled group inside the Advanced dialog. */
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <h3>
        {title}
        {hint && <Info text={hint} />}
      </h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

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
        <span className="field-label-tools">
          {unit && <span className="unit">{unit}</span>}
          {hint && <Info text={hint} />}
        </span>
      </span>
      {cloneElement(children, { id })}
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
        {hint && <Info text={hint} />}
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

/** Numeric row bound directly to an extra_settings key. */
function NumberRow({
  label,
  keyName,
  extra,
  setExtra,
  unit,
  hint,
  placeholder,
  min = "0",
  step = "1",
}: {
  label: string;
  keyName: string;
  extra: ExtraSettings;
  setExtra: SetExtra;
  unit?: string;
  hint?: string;
  placeholder?: string;
  min?: string;
  step?: string;
}) {
  return (
    <Row label={label} unit={unit} hint={hint}>
      <input
        type="number"
        min={min}
        step={step}
        value={extraNumber(extra, keyName) ?? ""}
        placeholder={placeholder}
        onChange={(event) =>
          setExtra(keyName, numberOrNull(event.target.value))
        }
      />
    </Row>
  );
}

/** Text row bound directly to an extra_settings key (empty removes it). */
function TextRow({
  label,
  keyName,
  extra,
  setExtra,
  hint,
  placeholder,
}: {
  label: string;
  keyName: string;
  extra: ExtraSettings;
  setExtra: SetExtra;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      <input
        value={extraString(extra, keyName, "")}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setExtra(keyName, event.target.value || null)}
      />
    </Row>
  );
}

/** Hard temperature rescaling and momentum / force resets (any MD job). */
function ResetsGroup({
  extra,
  setExtra,
}: {
  extra: ExtraSettings;
  setExtra: SetExtra;
}) {
  const common = { extra, setExtra, placeholder: "never" };
  return (
    <Group
      title="Resets"
      hint="Hard rescaling and drift removal · blank = never"
    >
      <div className="form-grid">
        <NumberRow
          label="T rescale · first n steps"
          keyName="nscale"
          {...common}
        />
        <NumberRow
          label="T rescale · every"
          keyName="fscale"
          unit="steps"
          min="1"
          {...common}
        />
        <NumberRow
          label="Momentum · first n steps"
          keyName="nreset"
          {...common}
        />
        <NumberRow
          label="Momentum · every"
          keyName="freset"
          unit="steps"
          min="1"
          {...common}
        />
        <NumberRow
          label="Angular mom. · first n steps"
          keyName="nreset_angular"
          {...common}
        />
        <NumberRow
          label="Angular mom. · every"
          keyName="freset_angular"
          unit="steps"
          min="1"
          {...common}
        />
        <NumberRow
          label="Net force · every"
          keyName="freset_forces"
          unit="steps"
          min="1"
          {...common}
        />
      </div>
    </Group>
  );
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
  const hasCalculatorGroup =
    runner === "ase_xtb" ||
    runner === "ase_dftbplus" ||
    isMace ||
    usesExternalScript(runner);

  return (
    <div className="settings-form">
      {hasCalculatorGroup && (
        <Group title="Calculator">
          {runner === "ase_xtb" && (
            <Choice
              label="xTB method"
              value={extraString(extra, "xtb_method", QM_DEFAULTS.xtb_method)}
              options={XTB_METHODS}
              onChange={(value) =>
                setExtra(
                  "xtb_method",
                  value === QM_DEFAULTS.xtb_method ? null : value,
                )
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
                <TextRow
                  label="Slater–Koster path"
                  keyName="slakos_path"
                  hint="Directory with the .skf files"
                  placeholder="/path/to/skf"
                  extra={extra}
                  setExtra={setExtra}
                />
              )}
              <Toggle
                label="Third-order expansion"
                hint="Implied by 3ob"
                checked={extraBool(extra, "third_order", slakos === "3ob")}
                onChange={(value) => setExtra("third_order", value)}
              />
              <TextRow
                label="Hubbard derivatives"
                keyName="hubbard_derivs"
                hint="Per element, e.g. C: -0.1492, H: -0.1857"
                placeholder="C: -0.1492, H: -0.1857, O: -0.1575"
                extra={extra}
                setExtra={setExtra}
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
                  setExtra(
                    "mace_model",
                    value === QM_DEFAULTS.mace_model ? null : value,
                  );
                  if (value !== "custom") setExtra("mace_model_path", null);
                }}
              />
              {maceModel === "custom" && (
                <TextRow
                  label="Model path or URL"
                  keyName="mace_model_path"
                  placeholder="https://… or /path/to/model"
                  extra={extra}
                  setExtra={setExtra}
                />
              )}
              <Choice
                label="Evaluation"
                value={extraString(extra, "mace_mode", QM_DEFAULTS.mace_mode)}
                options={MACE_MODES}
                hint="fast needs cuequivariance + CUDA ops"
                onChange={(value) =>
                  setExtra(
                    "mace_mode",
                    value === QM_DEFAULTS.mace_mode ? null : value,
                  )
                }
              />
            </>
          )}

          {usesExternalScript(runner) && (
            <TextRow
              label="Script full path"
              keyName="qm_script_full_path"
              hint="Overrides the bundled qm_script lookup"
              placeholder="/opt/pq/scripts/…"
              extra={extra}
              setExtra={setExtra}
            />
          )}
        </Group>
      )}

      <Group title="QM run">
        {supportsDispersion(runner) && (
          <Toggle
            label="Dispersion correction"
            checked={extraBool(extra, "dispersion", dispersionDefault(runner))}
            onChange={(value) => setExtra("dispersion", value)}
          />
        )}
        <Toggle
          label="Remove net force"
          hint="Subtract the mean QM force after each call"
          checked={extraBool(extra, "remove_net_force", false)}
          onChange={(value) => setExtra("remove_net_force", value)}
        />
        <NumberRow
          label="QM time limit"
          keyName="qm_loop_time_limit"
          unit="s"
          step="60"
          hint="Per-step wall-clock cap · 0 disables"
          placeholder={String(QM_DEFAULTS.qm_loop_time_limit)}
          extra={extra}
          setExtra={setExtra}
        />
      </Group>

      <ResetsGroup extra={extra} setExtra={setExtra} />
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
      <Group title="Potentials">
        {usesGuff(mode) && (
          <Choice
            label="Non-Coulomb potential"
            value={extraString(extra, "noncoulomb", MM_DEFAULTS.noncoulomb)}
            options={NONCOULOMB_KINDS}
            hint="Quick routines replace the full GUFF formalism"
            onChange={(value) =>
              setExtra(
                "noncoulomb",
                value === MM_DEFAULTS.noncoulomb ? null : value,
              )
            }
          />
        )}
        <Choice
          label="Long-range correction"
          value={longRange}
          options={LONG_RANGE_KINDS}
          onChange={(value) => {
            setExtra(
              "long_range",
              value === MM_DEFAULTS.long_range ? null : value,
            );
            if (value !== "wolf") setExtra("wolf_param", null);
            if (value !== "reaction-field") setExtra("rf_epsilon", null);
          }}
        />
        {longRange === "wolf" && (
          <NumberRow
            label="Wolf parameter"
            keyName="wolf_param"
            unit="Å⁻¹"
            step="0.01"
            placeholder={String(MM_DEFAULTS.wolf_param)}
            extra={extra}
            setExtra={setExtra}
          />
        )}
        {longRange === "reaction-field" && (
          <NumberRow
            label="Dielectric constant"
            keyName="rf_epsilon"
            min="1"
            step="0.1"
            hint="Required for reaction field"
            extra={extra}
            setExtra={setExtra}
          />
        )}
      </Group>

      <Group title="Neighbour search">
        <Toggle
          label="Cell list"
          hint="Replaces the brute-force pair loop"
          checked={extraBool(extra, "cell-list", false)}
          onChange={(value) => {
            setExtra("cell-list", value ? "on" : null);
            if (!value) setExtra("cell-number", null);
          }}
        />
        {extraBool(extra, "cell-list", false) && (
          <NumberRow
            label="Cells per direction"
            keyName="cell-number"
            min="1"
            placeholder={String(MM_DEFAULTS["cell-number"])}
            extra={extra}
            setExtra={setExtra}
          />
        )}
      </Group>

      {usesTopology(mode) && (
        <Group title="Constraints" hint="Definitions come from the topology file">
          <Choice
            label="Bond constraints"
            value={shake}
            options={SHAKE_MODES}
            onChange={(value) => {
              setExtra("shake", value === MM_DEFAULTS.shake ? null : value);
              if (value === "off") {
                for (const key of [
                  "shake-tolerance",
                  "shake-iter",
                  "rattle-tolerance",
                  "rattle-iter",
                ]) {
                  setExtra(key, null);
                }
              }
            }}
          />
          {shake !== "off" && (
            <div className="form-grid">
              <NumberRow
                label="SHAKE tolerance"
                keyName="shake-tolerance"
                step="1e-9"
                placeholder={String(MM_DEFAULTS["shake-tolerance"])}
                extra={extra}
                setExtra={setExtra}
              />
              <NumberRow
                label="SHAKE iterations"
                keyName="shake-iter"
                min="1"
                placeholder={String(MM_DEFAULTS["shake-iter"])}
                extra={extra}
                setExtra={setExtra}
              />
              <NumberRow
                label="RATTLE tolerance"
                keyName="rattle-tolerance"
                unit="s⁻¹kg⁻¹"
                step="1"
                placeholder={String(MM_DEFAULTS["rattle-tolerance"])}
                extra={extra}
                setExtra={setExtra}
              />
              <NumberRow
                label="RATTLE iterations"
                keyName="rattle-iter"
                min="1"
                placeholder={String(MM_DEFAULTS["rattle-iter"])}
                extra={extra}
                setExtra={setExtra}
              />
            </div>
          )}
          <Toggle
            label="Distance constraints"
            checked={extraBool(extra, "distance-constraints", false)}
            onChange={(value) =>
              setExtra("distance-constraints", value ? "on" : null)
            }
          />
        </Group>
      )}

      <ResetsGroup extra={extra} setExtra={setExtra} />
    </div>
  );
}
