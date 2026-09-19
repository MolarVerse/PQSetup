/** Command-palette groups of the setup page, in display order. */
export const COMMAND_GROUP_ORDER = [
  "Suggested",
  "Problems",
  "Workflow",
  "Scientific setup",
  "Parameters",
  "Inputs",
  "Actions",
] as const;

export type CommandGroup = (typeof COMMAND_GROUP_ORDER)[number];
