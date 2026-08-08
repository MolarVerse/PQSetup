import { describe, expect, it } from "vitest";
import { MANOSTATS, THERMOSTATS } from "./conditionOptions";

describe("PQ 0.7.0 condition options", () => {
  it("uses the exact thermostat keywords", () => {
    expect(THERMOSTATS.map((option) => option.value)).toEqual([
      "berendsen",
      "velocity_rescaling",
      "langevin",
      "nh-chain",
    ]);
  });

  it("uses the exact manostat keywords", () => {
    expect(MANOSTATS.map((option) => option.value)).toEqual([
      "berendsen",
      "stochastic_rescaling",
    ]);
  });
});
