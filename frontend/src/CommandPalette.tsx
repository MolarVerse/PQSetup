import { Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  COMMAND_GROUP_ORDER,
  rankCommands,
  type CommandGroup,
  type SearchableCommand,
} from "./commandSearch";

export interface Command extends SearchableCommand {
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}

export default function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const filtered = useMemo(
    () => rankCommands(commands, query),
    [commands, query],
  );
  const grouped = useMemo(() => {
    const groups = new Map<
      CommandGroup,
      { command: Command; index: number }[]
    >();
    filtered.forEach((command, index) => {
      const items = groups.get(command.group) ?? [];
      items.push({ command, index });
      groups.set(command.group, items);
    });
    return COMMAND_GROUP_ORDER.flatMap((group) => {
      const items = groups.get(group);
      return items?.length ? [{ group, items }] : [];
    });
  }, [filtered]);
  const ordered = useMemo(
    () => grouped.flatMap(({ items }) => items.map(({ command }) => command)),
    [grouped],
  );
  const orderedIndex = useMemo(
    () => new Map(ordered.map((command, index) => [command.id, index])),
    [ordered],
  );
  const activeId = ordered[selected]
    ? `command-option-${ordered[selected].id}`
    : undefined;

  // Native modal <dialog>: the browser handles the top layer, inertness of
  // the page behind, focus trapping and focus restore. Nothing on <body>
  // changes, so the page cannot reflow while the palette is open. The dialog
  // fills the viewport as its own scroll container (overscroll-behavior:
  // contain), so wheel events over the dimmed area do not scroll the page.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      setQuery("");
      setSelected(0);
      requestAnimationFrame(() => input.current?.focus());
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    setSelected((value) =>
      Math.min(value, Math.max(ordered.length - 1, 0)),
    );
  }, [ordered.length]);

  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: "nearest" });
  }, [query, selected]);

  function run(command: Command) {
    if (command.disabledReason) return;
    onClose();
    command.run();
  }

  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-label="Search setup"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Clicks on the ::backdrop arrive with the dialog itself as target.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="palette-panel">
        <div className="palette-search">
          <Search size={19} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((value) =>
                  ordered.length ? (value + 1) % ordered.length : 0,
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((value) =>
                  ordered.length
                    ? (value - 1 + ordered.length) % ordered.length
                    : 0,
                );
              }
              if (event.key === "Home") {
                event.preventDefault();
                setSelected(0);
              }
              if (event.key === "End") {
                event.preventDefault();
                setSelected(Math.max(ordered.length - 1, 0));
              }
              if (event.key === "Enter" && ordered[selected]) {
                event.preventDefault();
                run(ordered[selected]);
              }
            }}
            placeholder="Search…"
            aria-label="Search setup"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
          />
          <button type="button" onClick={onClose} aria-label="Close search">
            <X size={18} />
          </button>
        </div>
        <span className="visually-hidden" aria-live="polite">
          {filtered.length
            ? `${filtered.length} result${filtered.length === 1 ? "" : "s"}`
            : "No results"}
        </span>
        <div
          className="palette-results"
          id="command-results"
          role="listbox"
          aria-label="Search results"
        >
          {filtered.length ? (
            grouped.map(({ group, items }) => (
              <section className="command-group" key={group}>
                <h2>{group}</h2>
                {items.map(({ command }) => {
                  const index = orderedIndex.get(command.id) ?? 0;
                  return (
                  <button
                    type="button"
                    role="option"
                    id={`command-option-${command.id}`}
                    key={command.id}
                    ref={selected === index ? selectedRow : undefined}
                    className={selected === index ? "selected" : ""}
                    aria-selected={selected === index}
                    aria-disabled={Boolean(command.disabledReason)}
                    onMouseMove={() => setSelected(index)}
                    onClick={() => run(command)}
                  >
                    <span className="command-copy">
                      <strong>{command.label}</strong>
                    </span>
                    <span className="command-hint">
                      {command.disabledReason ?? command.hint}
                      {command.current && (
                        <Check size={15} aria-label="Current" />
                      )}
                    </span>
                  </button>
                  );
                })}
              </section>
            ))
          ) : (
            <div className="palette-empty">
              <strong>No results</strong>
            </div>
          )}
        </div>
        </div>
      )}
    </dialog>
  );
}
