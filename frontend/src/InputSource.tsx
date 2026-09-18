/**
 * Lightweight PQ input highlighter for the live preview.
 *
 * Every line is a block with a CSS-counter gutter. The generated header is
 * `# run-name · kind` then `# label   value` rows; sections are
 * `# ── title · quip ───`; assignments may carry a trailing `# unit` note.
 */
const HEADER_ROW = /^# (\S(?:.*?\S)?) {2,}(\S.*)$/;
const SECTION = /^(# ── )([^·─]+?)(?: · ([^─]+?))? (─+)$/;
const ASSIGNMENT =
  /^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*?;)(\s+#.*)?$/;
const TITLE = /^# (.+?)(?: · (.+))?$/;

export default function InputSource({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <code className="input-source">
      {lines.map((line, index) => {
        const key = `${index}:${line.slice(0, 24)}`;
        if (line.startsWith("#")) {
          if (index === 0) {
            const title = TITLE.exec(line);
            return (
              <span className="src-line src-title" key={key}>
                {"# "}
                <span className="src-title-name">{title?.[1] ?? line}</span>
                {title?.[2] && (
                  <span className="src-title-kind">{` · ${title[2]}`}</span>
                )}
              </span>
            );
          }
          const section = SECTION.exec(line);
          if (section) {
            const [, lead, title, quip, rule] = section;
            return (
              <span className="src-line src-section" key={key}>
                {lead}
                <span className="src-section-title">{title}</span>
                {quip && (
                  <>
                    {" · "}
                    <span className="src-section-quip">{quip}</span>
                  </>
                )}
                {" "}
                {rule}
              </span>
            );
          }
          if (line.startsWith("# ──")) {
            return (
              <span className="src-line src-section" key={key}>
                {line}
              </span>
            );
          }
          // Closing one-liner after the `fin` divider.
          if (index > 0 && lines[index - 1].startsWith("# ── fin")) {
            return (
              <span className="src-line src-signoff" key={key}>
                {line}
              </span>
            );
          }
          const header = HEADER_ROW.exec(line);
          if (header) {
            const [, label, value] = header;
            return (
              <span className="src-line src-meta" key={key}>
                {"# "}
                <span className="src-meta-label">{label}</span>
                {" ".repeat(Math.max(1, 12 - label.length))}
                <span className="src-meta-value">{value}</span>
              </span>
            );
          }
          return (
            <span className="src-line src-comment" key={key}>
              {line}
            </span>
          );
        }
        const match = ASSIGNMENT.exec(line);
        if (match) {
          const [, indent, name, eq, rest, note] = match;
          return (
            <span className="src-line src-assign" key={key}>
              {indent}
              <span className="src-key">{name}</span>
              <span className="src-eq">{eq}</span>
              <span className="src-value">{rest}</span>
              {note && <span className="src-note">{note}</span>}
            </span>
          );
        }
        return (
          <span className="src-line" key={key}>
            {line}
          </span>
        );
      })}
    </code>
  );
}
