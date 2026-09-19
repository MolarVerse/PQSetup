#!/usr/bin/env node
/**
 * tokens.json → src/styles/tokens.css
 *
 * Every PQ tool reads the same tokens.json: web frontends through this CSS,
 * Python/Tk/Textual apps directly from the JSON. Edit the JSON, run
 * `npm run tokens`, commit both.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "tokens.json"), "utf8"));

const lines = [
  "/* Generated from tokens.json by scripts/build-tokens.mjs — do not edit. */",
  `/* ${tokens.name}: ${tokens.description} */`,
  ":root {",
  "  color-scheme: light;",
  `  --mono: ${tokens.font.mono};`,
];

for (const [name, value] of Object.entries(tokens.color)) {
  lines.push(`  --${name === "focus" ? "focus-color" : name}: ${value};`);
}
for (const group of ["shape", "space"]) {
  for (const [name, value] of Object.entries(tokens[group])) {
    lines.push(`  --${name}: ${value};`);
  }
}
for (const [name, value] of Object.entries(tokens.type)) {
  lines.push(`  --type-${name}: ${value};`);
}
for (const [name, value] of Object.entries(tokens.code)) {
  lines.push(`  --code-${name}: ${value};`);
}
lines.push("}", "");

writeFileSync(join(root, "src/styles/tokens.css"), lines.join("\n"));
console.log("wrote src/styles/tokens.css");
