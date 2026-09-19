import {
  MACE_OFF_MODELS,
  pruneExtraSettings,
} from "./calculatorSettings";
import type { SetupFileRole, SimulationSetup } from "./types";

/**
 * What the page state means for the run that gets written.
 *
 * The form keeps everything the user ever typed (so switching NVT → NVE → NVT
 * or QM → MM → QM brings their choices back), but only the controls that are
 * visible right now may reach the input file. This is the single place that
 * strips hidden state before rendering or packaging.
 */
export function effectiveSetup(
  setup: SimulationSetup,
  cellGenerated: boolean,
  packedRoles: ReadonlySet<SetupFileRole> = new Set(),
): SimulationSetup {
  const mm = setup.job_type === "mm-md" || setup.job_type === "mm-opt";
  const thermal = setup.ensemble === "NVT" || setup.ensemble === "NPT";
  const npt = setup.ensemble === "NPT";
  const ramp = thermal && setup.start_temperature_k != null;

  const extra = { ...pruneExtraSettings(setup) };
  if (
    setup.runner === "mace_off" &&
    typeof extra.mace_model === "string" &&
    !MACE_OFF_MODELS.some((option) => option.value === extra.mace_model)
  ) {
    delete extra.mace_model;
    delete extra.mace_model_path;
  }

  // Naming a molecule descriptor makes PQ require the file, so a QM run only
  // keeps the name while the file is actually in the package.
  const moldescriptor =
    mm || packedRoles.has("moldescriptor") ? setup.moldescriptor_file : null;

  return {
    ...setup,
    moldescriptor_file: moldescriptor,
    // The M-SHAKE file is read only for `shake = mshake`; keep its name only then.
    mshake_file: mm && extra.shake === "mshake" ? setup.mshake_file : null,
    runner: mm ? null : setup.runner,
    runner_script: mm ? null : setup.runner_script,
    density_g_cm3: mm && cellGenerated ? setup.density_g_cm3 : null,
    thermostat: thermal ? setup.thermostat : null,
    start_temperature_k: ramp ? setup.start_temperature_k : null,
    temperature_ramp_steps: ramp ? setup.temperature_ramp_steps : null,
    manostat: npt ? setup.manostat : null,
    pressure_bar: npt ? setup.pressure_bar : null,
    extra_settings: extra,
  };
}
