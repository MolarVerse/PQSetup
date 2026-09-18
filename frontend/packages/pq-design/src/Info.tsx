import { Info as InfoIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Small ⓘ affordance with a hover/focus tooltip.
 *
 * The bubble renders through a portal with fixed positioning, so it is never
 * clipped by overflow containers (grids, dialogs, code panes).
 */
export default function Info({ text }: { text: string }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean }>();
  // Inside a <dialog> the bubble must live in the dialog too, or the top
  // layer would paint over it.
  const host = anchor.current?.closest("dialog") ?? document.body;

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const below = rect.top < 96;
    setPos({
      x: Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140),
      y: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="info"
        aria-label="More information"
        aria-describedby={open ? id : undefined}
        ref={anchor}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        <InfoIcon size={13} aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <span
            role="tooltip"
            id={id}
            className={`info-bubble ${pos.below ? "below" : "above"}`}
            style={{ left: pos.x, top: pos.y }}
          >
            {text}
          </span>,
          host,
        )}
    </>
  );
}
