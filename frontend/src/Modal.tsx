import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Carbon-style modal on top of the native <dialog>: square, white, hairline
 * header, Esc / backdrop / × all close it. Children mount only while open.
 */
export default function Modal({
  open,
  title,
  subtitle,
  size = "md",
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  size?: "md" | "lg" | "full";
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-label={typeof title === "string" ? title : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <header className="modal-header">
            <div className="modal-heading">
              <h2>{title}</h2>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
