/**
 * Lightweight PQ input highlighter for the live preview.
 *
 * Every line is a block with a CSS-counter gutter. The generated header is a
 * box-drawn run card (`# ┌──┐`, `# │ label   value │`), sections are
 * `# ── title ─── quip ──`, and assignments may end in a `# unit` note.
 */
const BOX_RULE = /^# ([┌├└])(─+)([┐┤┘])$/;
const BOX_ROW = /^# │ (.*) │$/;
const BOX_COLUMNS = /^(\S(?:.*?\S)?)( {2,})(\S.*?)(\s*)$/;
const SECTION = /^(# ── )([^─]+?) (─+)(?: ([^─]+?) (──))?$/;
const ASSIGNMENT =
  /^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*?)(;)(\s+#.*)?$/;
const NUMBER = /^[-+]?(\d|\.\d)/;
const SWITCH = /^(true|false|on|off)$/i;

function valueClass(value: string): string {
  if (NUMBER.test(value)) return "src-value src-num";
  if (SWITCH.test(value)) return "src-value src-switch";
  if (value.includes(".")) return "src-value src-file";
  return "src-value";
}

export default function InputSource({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <code className="input-source">
      {lines.map((line, index) => {
        const key = `${index}:${line.slice(0, 24)}`;
        if (line.startsWith("#")) {
          const rule = BOX_RULE.exec(line);
          if (rule) {
            return (
              <span className="src-line src-box" key={key}>
                {line}
              </span>
            );
          }
          const row = BOX_ROW.exec(line);
          if (row) {
            const isTitle = index > 0 && lines[index - 1].startsWith("# ┌");
            const columns = BOX_COLUMNS.exec(row[1]);
            return (
              <span
                className={`src-line src-box ${isTitle ? "src-title" : "src-meta"}`}
                key={key}
              >
                {"# │ "}
                {columns ? (
                  <>
                    <span className={isTitle ? "src-title-name" : "src-meta-label"}>
                      {columns[1]}
                    </span>
                    {columns[2]}
                    <span className={isTitle ? "src-title-kind" : "src-meta-value"}>
                      {columns[3]}
                    </span>
                    {columns[4]}
                  </>
                ) : (
                  <span className="src-meta-value">{row[1]}</span>
                )}
                {" │"}
              </span>
            );
          }
          const section = SECTION.exec(line);
          if (section) {
            const [, lead, title, fill, quip, tail] = section;
            return (
              <span className="src-line src-section" key={key}>
                {lead}
                <span className="src-section-title">{title}</span>
                {` ${fill}`}
                {quip && (
                  <>
                    {" "}
                    <span className="src-section-quip">{quip}</span>
                    {` ${tail}`}
                  </>
                )}
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
          const [, indent, name, eq, value, semicolon, note] = match;
          return (
            <span className="src-line src-assign" key={key}>
              {indent}
              <span className="src-key">{name}</span>
              <span className="src-eq">{eq}</span>
              <span className={valueClass(value)}>{value}</span>
              <span className="src-eq">{semicolon}</span>
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
