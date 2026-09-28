#!/usr/bin/env node
/** Install the packed library outside the PQSetup workspace and check exports. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const archive = resolve(process.argv[2] ?? "");
if (!existsSync(archive)) {
  throw new Error(`Design package not found: ${archive}`);
}

const consumer = mkdtempSync(join(tmpdir(), "pq-design-consumer-"));
try {
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "pq-design-smoke", private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    ["install", archive, "react@19", "react-dom@19", "lucide-react@0.468"],
    { cwd: consumer, stdio: "inherit" },
  );
  execFileSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `import { existsSync } from "node:fs";
       import { createRequire } from "node:module";
       import { Field, Modal } from "@molarverse/pq-design";
       const require = createRequire(import.meta.url);
       if (typeof Field !== "function" || typeof Modal !== "function") {
         throw new Error("React controls are unavailable");
       }
       for (const name of ["styles.css", "tokens.css", "tokens.json"]) {
         if (!existsSync(require.resolve("@molarverse/pq-design/" + name))) {
           throw new Error(name + " is unavailable");
         }
       }`,
    ],
    { cwd: consumer, stdio: "inherit" },
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

console.log(`Verified independent install of ${archive}`);
