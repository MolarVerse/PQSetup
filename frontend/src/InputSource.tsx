/** Lightweight PQ input highlighter for the live preview. */
export default function InputSource({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <code className="input-source">
      {lines.map((line, index) => {
        const key = `${index}:${line.slice(0, 24)}`;
        if (line.startsWith("#")) {
          const isBanner =
            line.startsWith("# ╔") ||
            line.startsWith("# ╚") ||
            line.startsWith("# ║");
          const isSection = line.startsWith("# ──⟨");
          return (
            <span
              className={`src-line ${
                isBanner ? "src-banner" : isSection ? "src-section" : "src-comment"
              }`}
              key={key}
            >
              {line || " "}
              {"\n"}
            </span>
          );
        }
        const match = /^(\s*)([A-Za-z][A-Za-z0-9_-]*)(\s*=\s*)(.*)$/.exec(line);
        if (match) {
          const [, indent, name, eq, rest] = match;
          return (
            <span className="src-line src-assign" key={key}>
              {indent}
              <span className="src-key">{name}</span>
              <span className="src-eq">{eq}</span>
              <span className="src-value">{rest}</span>
              {"\n"}
            </span>
          );
        }
        return (
          <span className="src-line" key={key}>
            {line || " "}
            {"\n"}
          </span>
        );
      })}
    </code>
  );
}
