import type { ReactNode } from "react";
import Info from "./Info";

export interface GroupProps {
  title: string;
  /** Tooltip text behind the ⓘ affordance next to the title. */
  info?: string;
  children: ReactNode;
}

/** Hairline-titled group of fields, as used inside settings dialogs. */
export default function Group({ title, info, children }: GroupProps) {
  return (
    <section className="settings-group">
      <h3>
        {title}
        {info && <Info text={info} />}
      </h3>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
