export type CommandGroup =
  | "Suggested"
  | "Problems"
  | "Workflow"
  | "Scientific setup"
  | "Parameters"
  | "Inputs"
  | "Actions";

export interface SearchableCommand {
  id: string;
  group: CommandGroup;
  label: string;
  detail?: string;
  hint?: string;
  keywords?: string[];
  featured?: boolean;
  current?: boolean;
  disabledReason?: string;
}

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  "Suggested",
  "Problems",
  "Workflow",
  "Scientific setup",
  "Parameters",
  "Inputs",
  "Actions",
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function commandScore(command: SearchableCommand, query: string): number | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return command.featured ? 0 : null;

  const label = normalize(command.label);
  const details = normalize(
    [command.detail, command.hint, ...(command.keywords ?? [])]
      .filter(Boolean)
      .join(" "),
  );
  const labelWords = words(command.label);
  const allWords = words(`${command.label} ${details}`);
  const queryWords = words(normalizedQuery);

  let score = 0;
  if (label === normalizedQuery) score += 160;
  else if (label.startsWith(normalizedQuery)) score += 110;
  else if (label.includes(normalizedQuery)) score += 70;

  for (const token of queryWords) {
    const exactLabel = labelWords.includes(token);
    const exactAny = allWords.includes(token);
    const prefixLabel = labelWords.some((word) => word.startsWith(token));
    const prefixAny = allWords.some((word) => word.startsWith(token));
    const containsAny =
      token.length >= 3 && allWords.some((word) => word.includes(token));

    if (exactLabel) score += 48;
    else if (exactAny) score += 38;
    else if (prefixLabel) score += 28;
    else if (prefixAny) score += 20;
    else if (containsAny) score += 10;
    else return null;
  }

  if (command.current) score += 4;
  if (command.featured) score += 2;
  return score;
}

export function rankCommands<T extends SearchableCommand>(
  commands: T[],
  query: string,
): T[] {
  const groupRank = new Map(
    COMMAND_GROUP_ORDER.map((group, index) => [group, index]),
  );

  return commands
    .map((command, index) => ({
      command,
      index,
      score: commandScore(command, query),
    }))
    .filter(
      (item): item is typeof item & { score: number } => item.score !== null,
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        (groupRank.get(a.command.group) ?? 99) -
          (groupRank.get(b.command.group) ?? 99) ||
        a.index - b.index,
    )
    .map(({ command }) => command);
}
