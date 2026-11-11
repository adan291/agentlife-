// Installs a git pre-push hook that runs scripts/push-guard.ts, so pushes from any terminal are
// checked too (the Kiro hook only sees pushes made by agents). Local only: .git/hooks is not committed.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const hooks = join(ROOT, ".git", "hooks");
if (!existsSync(join(ROOT, ".git"))) {
  console.error("not a git repository");
  process.exit(1);
}
mkdirSync(hooks, { recursive: true });
const hook = join(hooks, "pre-push");
writeFileSync(hook, '#!/bin/sh\nexec node --experimental-strip-types --no-warnings scripts/push-guard.ts --git\n');
try { chmodSync(hook, 0o755); } catch { /* Windows: git for Windows runs it through sh anyway */ }
console.log(`installed ${hook}`);
