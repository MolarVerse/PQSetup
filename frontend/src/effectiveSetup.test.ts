import { describe, expect, it } from "vitest";
import { effectiveSetup } from "./effectiveSetup";
import type { SimulationSetup } from "./types";

const base: SimulationSetup = {
  preset_id: null,
  job_type: "qm-md",
  ensemble: "NVT",
  start_file: "water.rst",
  restart_file: null,
  file_prefix: "water-run",
  timestep_fs: 0.5,
  steps: 1000,
  temperature_k: 298.15,
  start_temperature_k: 100,
  temperature_ramp_steps: 500,
  temperature_ramp_frequency: 1,
  pressure_bar: 50,
  thermostat: "nh-chain",
  thermostat_relaxation_ps: 0.1,
  thermostat_friction_ps_inverse: 0.1,
  nh_chain_length: 3,
  coupling_frequency_cm_inverse: 1000,
  manostat: "berendsen",
  manostat_relaxation_ps: 1,
  compressibility_bar_inverse: 4.591e-5,
  pressure_isotropy: "isotropic",
  initialize_velocities: true,
  random_seed: 1,
  runner: "ase_xtb",
  runner_script: null,
  mm_force_field: "off",
  density_g_cm3: 1,
  coulomb_cutoff_angstrom: 12.5,
  moldescriptor_file: null,
  guff_file: null,
  topology_file: null,
  parameter_file: null,
  intra_nonbonded_file: null,
  mshake_file: null,
  dftb_template_file: null,
  turbomole_define_template_file: null,
  overwrite_output: false,
  extra_settings: { xtb_method: "gfn1-xtb", noncoulomb: "lj", output_freq: 10 },
};

describe("effectiveSetup", () => {
  it("names a QM molecule descriptor only while the file is packed", () => {
    const named = { ...base, moldescriptor_file: "moldescriptor.dat" };
    expect(effectiveSetup(named, false).moldescriptor_file).toBeNull();
    expect(
      effectiveSetup(named, false, new Set(["moldescriptor"])).moldescriptor_file,
    ).toBe("moldescriptor.dat");
    expect(
      effectiveSetup({ ...named, job_type: "mm-md" }, false).moldescriptor_file,
    ).toBe("moldescriptor.dat");
  });


  it("keeps remembered values out of the input when their controls are hidden", () => {
    const nve = effectiveSetup({ ...base, ensemble: "NVE" }, false);
    expect(nve.thermostat).toBeNull();
    expect(nve.start_temperature_k).toBeNull();
    expect(nve.temperature_ramp_steps).toBeNull();
    expect(nve.manostat).toBeNull();
    expect(nve.pressure_bar).toBeNull();

    const nvt = effectiveSetup(base, false);
    expect(nvt.thermostat).toBe("nh-chain");
    expect(nvt.start_temperature_k).toBe(100);
    expect(nvt.manostat).toBeNull();
    expect(nvt.pressure_bar).toBeNull();

    const npt = effectiveSetup({ ...base, ensemble: "NPT" }, false);
    expect(npt.manostat).toBe("berendsen");
    expect(npt.pressure_bar).toBe(50);
  });

  it("drops the QM calculator and QM-only keys for an MM run, and vice versa", () => {
    const mm = effectiveSetup({ ...base, job_type: "mm-md" }, true);
    expect(mm.runner).toBeNull();
    expect(mm.extra_settings).toEqual({ noncoulomb: "lj", output_freq: 10 });
    expect(mm.density_g_cm3).toBe(1);

    const qm = effectiveSetup(base, true);
    expect(qm.runner).toBe("ase_xtb");
    expect(qm.extra_settings).toEqual({ xtb_method: "gfn1-xtb", output_freq: 10 });
    expect(qm.density_g_cm3).toBeNull();
  });

  it("keeps SHAKE for a QM run and names its topology only then", () => {
    const shaken = {
      ...base,
      topology_file: "topology.dat",
      extra_settings: { shake: "on", "shake-iter": 30 },
    };
    const qm = effectiveSetup(shaken, false);
    expect(qm.extra_settings).toEqual({ shake: "on", "shake-iter": 30 });
    expect(qm.topology_file).toBe("topology.dat");
    expect(
      effectiveSetup({ ...shaken, extra_settings: {} }, false).topology_file,
    ).toBeNull();
    expect(
      effectiveSetup(
        { ...shaken, extra_settings: { "distance-constraints": "on" } },
        false,
      ).topology_file,
    ).toBe("topology.dat");
  });

  it("names the M-SHAKE file only while shake = mshake is in force", () => {
    const mm = {
      ...base,
      job_type: "mm-md" as const,
      mm_force_field: "on" as const,
      mshake_file: "mshake.dat",
    };
    expect(effectiveSetup(mm, false).mshake_file).toBeNull();
    const constrained = {
      ...mm,
      extra_settings: { shake: "mshake", "mshake-iter": 50 },
    };
    expect(effectiveSetup(constrained, false).mshake_file).toBe("mshake.dat");
    expect(effectiveSetup(constrained, false).extra_settings).toEqual({
      shake: "mshake",
      "mshake-iter": 50,
    });
    expect(
      effectiveSetup({ ...constrained, extra_settings: { "mshake-iter": 50 } }, false)
        .extra_settings,
    ).toEqual({});
  });

  it("never writes a density for a structure that brought its own cell", () => {
    expect(
      effectiveSetup({ ...base, job_type: "mm-md" }, false).density_g_cm3,
    ).toBeNull();
  });

  it("forgets a MACE-MP-only model when the calculator is MACE-OFF", () => {
    const off = effectiveSetup(
      {
        ...base,
        runner: "mace_off",
        extra_settings: { mace_model: "large-0b2", mace_model_path: "/x" },
      },
      false,
    );
    expect(off.extra_settings).toEqual({});
    const small = effectiveSetup(
      { ...base, runner: "mace_off", extra_settings: { mace_model: "small" } },
      false,
    );
    expect(small.extra_settings).toEqual({ mace_model: "small" });
  });
});
