import { Check, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  const dialog = useRef<HTMLElement>(null);
  const selectedRow = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const background = document.querySelectorAll<HTMLElement>(
      ".app-header, .page",
    );
    background.forEach((element) => {
      element.inert = true;
    });
    // Lock scrolling without the layout shift: keep the scrollbar's width
    // as padding so the page behind does not jump when the bar disappears.
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter > 0) document.body.style.paddingRight = `${gutter}px`;
    setQuery("");
    setSelected(0);
    requestAnimationFrame(() => input.current?.focus());
    return () => {
      background.forEach((element) => {
        element.inert = false;
      });
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
      restoreFocus.current?.focus();
    };
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

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  function run(command: Command) {
    if (command.disabledReason) return;
    onClose();
    command.run();
  }

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = Array.from(
      dialog.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <section
        ref={dialog}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search setup"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
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
      </section>
    </div>
  );
}
