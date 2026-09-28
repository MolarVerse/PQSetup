# @molarverse/pq-design

Shared flat mono tokens, CSS and React controls for PQSetup, PQViewer and
PQEnalyzer Web. The package uses the IBM Carbon Gray 10 palette, IBM Plex Mono,
square corners and hairline dividers.

## Install

Install a versioned archive from the public PQSetup GitHub release:

```bash
npm install "https://github.com/MolarVerse/PQSetup/releases/download/pq-design-v0.1.1/molarverse-pq-design-0.1.1.tgz"
```

Commit the updated `package.json` and `package-lock.json`. A clean `npm ci`
works without a sibling PQSetup checkout. The app must provide React 19,
React DOM 19 and Lucide as peer dependencies.

```tsx
import "@molarverse/pq-design/styles.css";
import { ConditionRow, Field, Info, Modal, Toggle } from "@molarverse/pq-design";
```

Import the shared stylesheet before app-specific layout rules. Consumers that
only need the palette can import `@molarverse/pq-design/tokens.css` or read
`@molarverse/pq-design/tokens.json`.

## Package contents

- `tokens.json` is the source for shared colour, type, spacing and shape values.
- `src/styles/tokens.css` is generated from the JSON. `base.css` and
  `components.css` style shared controls and public class names.
- `dist/index.js` and TypeScript declarations provide `Modal`, `Info`,
  `Field`, `Choice`, `Toggle`, `Group`, `ConditionRow` and `CommandPalette`.
- `CommandPalette` takes tool-specific commands and a display order; it has no
  PQSetup-specific navigation.

The design rules are: monospaced type, square controls, one-pixel dividers,
clear two-pixel keyboard focus, and no shadows. Keep page layout and product
logic in the consuming app.

## Change and release

Edit this package in the PQSetup repository. When tokens change, run
`npm --prefix frontend run tokens` and commit the generated CSS. Build and
test the workspace with `npm --prefix frontend test` and
`npm --prefix frontend run build`.

Bump this package's version when exported controls, tokens or public class
names change. A `pq-design-v<version>` tag on a verified main commit publishes
the installable archive and SHA-256 checksums. Consumers update the archive
URL and lockfile together. The design version is independent of PQSetup's
Python release version.
