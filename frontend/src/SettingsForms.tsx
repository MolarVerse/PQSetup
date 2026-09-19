import { Choice, Field, Group, Toggle } from "@molarverse/pq-design";
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
  VIRIAL_KINDS,
  XTB_METHODS,
  dispersionDefault,
  extraBool,
  extraNumber,
  extraString,
  supportsDispersion,
  usesExternalScript,
  usesGuff,
  usesTopology,
  type ExtraSettings,
  type ExtraValue,
} from "./calculatorSettings";
import type { MMForceFieldMode } from "./types";

type SetExtra = (key: string, value: ExtraValue | null) => void;

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
  info,
  placeholder,
  min = "0",
  step = "1",
}: {
  label: string;
  keyName: string;
  extra: ExtraSettings;
  setExtra: SetExtra;
  unit?: string;
  info?: string;
  placeholder?: string;
  min?: string;
  step?: string;
}) {
  return (
    <Field label={label} unit={unit} info={info}>
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
    </Field>
  );
}

/** Text row bound directly to an extra_settings key (empty removes it). */
function TextRow({
  label,
  keyName,
  extra,
  setExtra,
  info,
  placeholder,
}: {
  label: string;
  keyName: string;
  extra: ExtraSettings;
  setExtra: SetExtra;
  info?: string;
  placeholder?: string;
}) {
  return (
    <Field label={label} info={info}>
      <input
        value={extraString(extra, keyName, "")}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => setExtra(keyName, event.target.value || null)}
      />
    </Field>
  );
}

/**
 * Kinetic resets from PQ's MD engine (Run › Steps › Advanced). They apply to
 * every MD run whatever the calculator; hard temperature rescaling needs the
 * target temperature of an NVT / NPT run, so it is offered only then.
 */
export function RunSettingsForm({
  thermal,
  extra,
  setExtra,
}: {
  thermal: boolean;
  extra: ExtraSettings;
  setExtra: SetExtra;
}) {
  const common = { extra, setExtra, placeholder: "never" };
  return (
    <div className="settings-form">
      {thermal && (
        <Group
          title="Temperature rescaling"
          info="Hard velocity scaling to the target temperature · blank = never"
        >
          <div className="form-grid">
            <NumberRow label="First n steps" keyName="nscale" {...common} />
            <NumberRow
              label="Every"
              keyName="fscale"
              unit="steps"
              min="1"
              {...common}
            />
          </div>
        </Group>
      )}
      <Group
        title="Drift removal"
        info="Zero the total momentum, angular momentum or net force · blank = never"
      >
        <div className="form-grid">
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
    </div>
  );
}

/**
 * SHAKE / RATTLE and distance constraints. PQ applies them in every MD job and
 * reads the bonds from a topology file; M-SHAKE rigid bodies are an MM extra
 * because their reference geometries refer to molecule types.
 */
function ConstraintsGroup({
  extra,
  setExtra,
  mshake,
  info,
}: {
  extra: ExtraSettings;
  setExtra: SetExtra;
  mshake: boolean;
  info: string;
}) {
  const shake = extraString(extra, "shake", MM_DEFAULTS.shake);
  return (
    <Group title="Constraints" info={info}>
      <Choice
        label="Bond constraints"
        value={shake}
        options={mshake ? SHAKE_MODES : SHAKE_MODES.slice(0, 2)}
        info={
          mshake
            ? "M-SHAKE needs reference geometries · a file slot appears under Files"
            : "Bonds come from a topology file · a slot appears under Files"
        }
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
          if (value !== "mshake") {
            setExtra("mshake-tolerance", null);
            setExtra("mshake-iter", null);
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
          {shake === "mshake" && (
            <>
              <NumberRow
                label="M-SHAKE tolerance"
                keyName="mshake-tolerance"
                step="1e-9"
                placeholder={String(MM_DEFAULTS["mshake-tolerance"])}
                extra={extra}
                setExtra={setExtra}
              />
              <NumberRow
                label="M-SHAKE iterations"
                keyName="mshake-iter"
                min="1"
                placeholder={String(MM_DEFAULTS["mshake-iter"])}
                extra={extra}
                setExtra={setExtra}
              />
            </>
          )}
        </div>
      )}
      <Toggle
        label="Distance constraints"
        info="Pairs from the distance_constraints section of the topology"
        checked={extraBool(extra, "distance-constraints", false)}
        onChange={(value) =>
          setExtra("distance-constraints", value ? "on" : null)
        }
      />
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
  // PQ switches third order on for 3ob when the key is absent, off otherwise.
  const thirdOrder = extraBool(extra, "third_order", slakos === "3ob");
  const hasCalculatorGroup =
    runner === "ase_xtb" ||
    runner === "ase_dftbplus" ||
    isMace ||
    usesExternalScript(runner);
  const calculatorInfo = usesExternalScript(runner)
    ? runner === "dftbplus"
      ? "Hamiltonian, SCC and k-points live in the DFTB+ template under Files"
      : "Method, basis and convergence live in the QM script itself"
    : undefined;

  return (
    <div className="settings-form">
      {hasCalculatorGroup && (
        <Group title="Calculator" info={calculatorInfo}>
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
                  info="Directory with the .skf files"
                  placeholder="/path/to/skf"
                  extra={extra}
                  setExtra={setExtra}
                />
              )}
              <Toggle
                label="Third-order expansion"
                info="PQ turns it on for 3ob unless set here"
                checked={thirdOrder}
                onChange={(value) => {
                  setExtra("third_order", value);
                  if (!value) setExtra("hubbard_derivs", null);
                }}
              />
              {thirdOrder && (
                <TextRow
                  label="Hubbard derivatives"
                  keyName="hubbard_derivs"
                  info="Override the built-in 3ob values · element: value, …"
                  placeholder="C: -0.1492, H: -0.1857, O: -0.1575"
                  extra={extra}
                  setExtra={setExtra}
                />
              )}
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
                info="fast needs cuequivariance + CUDA ops"
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
              info="Run your own script instead of the bundled one"
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
          info="Subtract the mean QM force after each call"
          checked={extraBool(extra, "remove_net_force", false)}
          onChange={(value) => setExtra("remove_net_force", value)}
        />
        <NumberRow
          label="QM time limit"
          keyName="qm_loop_time_limit"
          unit="s"
          step="60"
          info="Per-step wall-clock cap · 0 disables"
          placeholder={String(QM_DEFAULTS.qm_loop_time_limit)}
          extra={extra}
          setExtra={setExtra}
        />
      </Group>

      <ConstraintsGroup
        extra={extra}
        setExtra={setExtra}
        mshake={false}
        info="Freeze bonds to move the timestep past 0.5 fs"
      />
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
  return (
    <div className="settings-form">
      <Group title="Potentials">
        {usesGuff(mode) && (
          <Choice
            label="Non-Coulomb potential"
            value={extraString(extra, "noncoulomb", MM_DEFAULTS.noncoulomb)}
            options={NONCOULOMB_KINDS}
            info="Quick routines replace the full GUFF formalism"
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
            info="Required for reaction field"
            extra={extra}
            setExtra={setExtra}
          />
        )}
        <Choice
          label="Virial"
          value={extraString(extra, "virial", MM_DEFAULTS.virial)}
          options={VIRIAL_KINDS}
          info="Molecular applies the intramolecular correction from the molecule descriptor"
          onChange={(value) =>
            setExtra("virial", value === MM_DEFAULTS.virial ? null : value)
          }
        />
      </Group>

      <Group title="Neighbour search">
        <Toggle
          label="Cell list"
          info="Replaces the brute-force pair loop"
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
        <ConstraintsGroup
          extra={extra}
          setExtra={setExtra}
          mshake
          info="Definitions come from the topology file"
        />
      )}
    </div>
  );
}
