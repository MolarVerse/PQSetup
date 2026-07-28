import { describe, expect, it } from "vitest";
import { rankCommands, type SearchableCommand } from "./commandSearch";

const commands: SearchableCommand[] = [
  {
    id: "npt",
    group: "Scientific setup",
    label: "Use NPT sampling",
    keywords: ["isobaric", "pressure", "barostat", "manostat"],
  },
  {
    id: "nvt",
    group: "Scientific setup",
    label: "Use NVT sampling",
    keywords: ["canonical", "fixed volume", "temperature"],
  },
  {
    id: "thermostat",
    group: "Parameters",
    label: "Thermostat settings",
    keywords: ["temperature coupling", "nose hoover"],
  },
  {
    id: "import",
    group: "Actions",
    label: "Import a structure",
    keywords: ["xyz", "pdb", "cif"],
    featured: true,
  },
];

describe("command search", () => {
  it("uses scientific aliases", () => {
    expect(rankCommands(commands, "barostat")[0]?.id).toBe("npt");
    expect(rankCommands(commands, "canonical")[0]?.id).toBe("nvt");
    expect(rankCommands(commands, "nose hoover")[0]?.id).toBe("thermostat");
  });

  it("keeps short scientific abbreviations token based", () => {
    expect(rankCommands(commands, "nvt").map((item) => item.id)).toEqual([
      "nvt",
    ]);
  });

  it("shows only featured commands before typing", () => {
    expect(rankCommands(commands, "").map((item) => item.id)).toEqual([
      "import",
    ]);
  });
});
