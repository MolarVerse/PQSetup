import { ArrowRight, Search, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
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
  const restoreFocus = useRef<HTMLElement | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const background = document.querySelectorAll<HTMLElement>(
      ".app-header, .workspace",
    );
    background.forEach((element) => {
      element.inert = true;
    });
    setQuery("");
    setSelected(0);
    requestAnimationFrame(() => input.current?.focus());
    return () => {
      background.forEach((element) => {
        element.inert = false;
      });
      restoreFocus.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

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
    restoreFocus.current = null;
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
        aria-label="Commands"
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
                  Math.min(value + 1, Math.max(filtered.length - 1, 0)),
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((value) => Math.max(value - 1, 0));
              }
              if (event.key === "Enter" && filtered[selected]) {
                event.preventDefault();
                run(filtered[selected]);
              }
            }}
            placeholder="Go to a step or run an action"
            aria-label="Search commands"
          />
          <button type="button" onClick={onClose} aria-label="Close commands">
            <X size={18} />
          </button>
        </div>
        <div className="palette-results">
          {filtered.length ? (
            filtered.map((command, index) => (
              <button
                type="button"
                key={command.id}
                className={selected === index ? "selected" : ""}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                <span className="command-hint">
                  {command.hint}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </button>
            ))
          ) : (
            <p>No matching commands</p>
          )}
        </div>
        <footer>
          <span>
            <kbd>Enter</kbd> run
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </section>
    </div>
  );
}
