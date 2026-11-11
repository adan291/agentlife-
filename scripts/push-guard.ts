// Blocks a push while the leak scanner has findings.
// Used two ways:
//   1. Kiro PreToolUse hook: reads the tool call JSON on stdin; acts only when it is a `git push`.
//   2. Git pre-push hook (installed by `pnpm security:install-hook`): called with --git.
// Exit 2 blocks (Kiro hook semantics); the git hook maps any non-zero to a refused push.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fromGit = process.argv.includes("--git");

let isPush = fromGit;
if (!fromGit) {
  let input = "";
  try { input = readFileSync(0, "utf8"); } catch { /* no stdin */ }
  // Look only at the command being run, and only at a real `git [global options] push` invocation,
  // so a commit message that mentions "push" is not mistaken for one.
  let command = input;
  try {
    const j = JSON.parse(input) as Record<string, unknown>;
    const inner = (j["tool_input"] ?? j["input"] ?? j["toolInput"] ?? j["arguments"]) as Record<string, unknown> | undefined;
    if (typeof inner?.["command"] === "string") command = inner["command"];
  } catch { /* not JSON: scan the raw text */ }
  const segments = command.split(/;|&&|\|\||\r?\n/).map((s) => s.trim());
  isPush = segments.some((s) =>
    /^(&\s*)?git(\.exe)?(\s+(-C\s+\S+|-c\s+\S+|--?[\w-]+(=\S+)?))*\s+push(\s|$)/.test(s) ||
    /^gh(\.exe)?\s+repo\s+create\b.*--push\b/.test(s));
}
if (!isPush) process.exit(0);

const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "security-scan.ts")], { cwd: ROOT, encoding: "utf8", windowsHide: true });
if (r.status === 0) process.exit(0);
process.stderr.write(
  "PUSH BLOCKED by the security gate. The leak scanner found secrets or personal data in the files or git history:\n" +
    (r.stdout ?? "") + (r.stderr ?? "") +
    "\nDo not push. Ask the user to decide each finding (fix, rewrite history, or accept it in scripts/security-allow.json), " +
    "or run the agentlife-security agent for a recommendation.\n",
);
process.exit(2);
