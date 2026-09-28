/** Syntax highlighting for generated PQ assignments and comments. */
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
    <code className="input-source" style={{ counterReset: "line 0" }}>
      {lines.map((line, index) => {
        const key = `${index}:${line.slice(0, 24)}`;
        if (line.startsWith("#")) {
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
