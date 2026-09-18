/**
 * Lightweight PQ input highlighter for the live preview.
 *
 * Every line is a block with a CSS-counter gutter. The generated header is a
 * box-drawn run card (`# ┌──┐`, `# │ label   value │`), sections are
 * `# ── title ─── quip ──`, and assignments may end in a `# unit` note.
 */
const BOX_RULE = /^# ([┌├└])(─+)([┐┤┘])$/;
const BOX_ROW = /^# │ (.*) │$/;
/** Title block rows are `art (ART_WIDTH cols) + text`; see input_writer.py. */
const ART_WIDTH = 13;
const BOX_COLUMNS = /^(\S(?:.*?\S)?)( {2,})(\S.*?)(\s*)$/;
const SECTION = /^(# ── )([^─]+?) (─+)(?: ([^─]+?) (──))?$/;
const ASSIGNMENT =
  /^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*?)(;)(\s+#.*)?$/;
const RAMP = /^(# .*? )(━+▶)( .*)$/;
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
            // Rows between the ┌ and ├ rules form the title block.
            let start = index - 1;
            while (start >= 0 && !BOX_RULE.test(lines[start])) start -= 1;
            const inTitle = start >= 0 && lines[start].startsWith("# ┌");
            if (inTitle) {
              const art = row[1].slice(0, ART_WIDTH);
              const text = row[1].slice(ART_WIDTH);
              const isName = index - start === 2;
              return (
                <span className="src-line src-box src-title" key={key}>
                  {"# │ "}
                  <span className="src-art">{art}</span>
                  <span className={isName ? "src-title-name" : "src-title-kind"}>
                    {text}
                  </span>
                  {" │"}
                </span>
              );
            }
            const columns = BOX_COLUMNS.exec(row[1]);
            return (
              <span
                className="src-line src-box src-meta"
                key={key}
              >
                {"# │ "}
                {columns ? (
                  <>
                    <span className="src-meta-label">
                      {columns[1]}
                    </span>
                    {columns[2]}
                    <span className="src-meta-value">
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
          const ramp = RAMP.exec(line);
          if (ramp) {
            return (
              <span className="src-line src-comment" key={key}>
                {ramp[1]}
                <span className="src-ramp">{ramp[2]}</span>
                {ramp[3]}
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
