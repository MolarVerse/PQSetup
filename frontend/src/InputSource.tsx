/**
 * Lightweight PQ input highlighter for the live preview.
 *
 * Every line is a block with a CSS-counter gutter. The generated header is
 * `# label   value` rows; sections are `# ── title ───`.
 */
const HEADER_ROW = /^# (\S(?:.*?\S)?) {2,}(\S.*)$/;
const ASSIGNMENT = /^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*)$/;

export default function InputSource({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <code className="input-source">
      {lines.map((line, index) => {
        const key = `${index}:${line.slice(0, 24)}`;
        if (line.startsWith("#")) {
          if (index === 0 && line.startsWith("# PQSetup")) {
            return (
              <span className="src-line src-title" key={key}>
                {line}
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
          const [, indent, name, eq, rest] = match;
          return (
            <span className="src-line src-assign" key={key}>
              {indent}
              <span className="src-key">{name}</span>
              <span className="src-eq">{eq}</span>
              <span className="src-value">{rest}</span>
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
