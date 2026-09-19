# @molarverse/pq-design

The flat-mono design language shared by the PQ tools (PQSetup, PQViewer,
PQEnalyzer): IBM Carbon's Gray 10 palette, IBM Plex Mono everywhere, square
corners, hairline dividers, no shadows.

```
tokens.json          single source of truth (colours, type, spacing, shape)
src/styles/
  tokens.css         generated from tokens.json  →  npm run tokens
  base.css           reset, typography, focus ring, status glyphs
  components.css     styles for the primitives below + documented class names
  index.css          all three, in order
src/
  Modal, Info, Field, Choice, Toggle, Group, ConditionRow, CommandPalette
```

## Rules of the language

- **Type**: `--mono` only. Base 14px / 1.5, labels 12px, nothing below 11px.
- **Shape**: `--radius: 0`. Dividers are 1px `--border`; emphasis is a 2px
  edge or a dark fill (`--selected`), never a shadow.
- **Focus**: 2px solid `--focus-color`, inset (`outline-offset: -2px`).
- **Fields**: layer fill (`--surface-subtle`) with a 1px bottom border.
- **Status glyphs**: `● ok · ◐ pending · ○ missing` via `.pq-tag.{ok,pending,missing}`.
- **Text over chrome**: explain with an `<Info>` tooltip rather than a
  sentence next to the control. Never duplicate a view (inline *or* modal).
- **Flow**: a page reads top to bottom. A control may only change what is
  below it.

## Using it from a Vite + React app

```jsonc
// package.json
"dependencies": { "@molarverse/pq-design": "file:../../PQSetup/frontend/packages/pq-design" }
```

```ts
// main.tsx
import "@molarverse/pq-design/styles.css";
import "./styles.css"; // app-specific layout on top
```

```tsx
import { ConditionRow, Field, Info, Modal, Toggle } from "@molarverse/pq-design";
import { Thermometer } from "lucide-react";

<ConditionRow icon={Thermometer} title="Temperature" info="Target of the thermostat">
  <Field label="Target" unit="K">
    <input type="number" value={t} onChange={…} />
  </Field>
</ConditionRow>
```

The package ships TypeScript source; Vite transpiles it because the `file:`
install is a symlink outside `node_modules`. `react`, `react-dom` and
`lucide-react` are peer dependencies so one copy of React is used.

### Command palette

`CommandPalette` is tool-agnostic: commands carry a free-form `group`, and
the tool passes the display order.

```tsx
const GROUPS = ["Suggested", "Problems", "Actions"] as const;
<CommandPalette open={open} commands={commands} groupOrder={GROUPS}
  placeholder="Search viewer…" onClose={() => setOpen(false)} />
```

## Using the tokens from Python (PQEnalyzer)

`tokens.json` is plain data. For a Tk / Textual / Matplotlib front end:

```python
import json, pathlib
tokens = json.loads(pathlib.Path("tokens.json").read_text())
ink, accent = tokens["color"]["ink"], tokens["color"]["accent"]
mono = tokens["font"]["mono"].split(",")[0].strip('" ')  # "IBM Plex Mono"
```

Map `color.background/surface/ink/muted/border/accent/success/warning/danger`
onto the widget palette; `code.*` are the syntax colours for input-file
listings.

## Changing the language

1. Edit `tokens.json`, run `npm run tokens`, commit both files.
2. Add or change a primitive in `src/` together with its rules in
   `components.css`; keep app-specific overrides in the consuming app.
3. A class in `components.css` is public API: renaming it is a breaking
   change for every tool.
