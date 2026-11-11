// Deterministic leak scanner (no model, no credits). Run before anything leaves this machine.
//
//   pnpm security:scan              tracked files + git history + commit metadata
//   pnpm security:scan --staged     only what is staged (fast, for pre-commit use)
//   pnpm security:scan --json       machine-readable output (used by the security agent)
//
// Findings never print the secret itself: values are masked and identified by a short hash.
// Accepted findings (e.g. a public author address the user chose) are listed by hash in
// scripts/security-allow.json, so the allowlist itself leaks nothing.
// Exit code: 0 clean, 1 findings of severity high or medium, 2 scanner error.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SAFE_EMAIL, SKIP_SCAN_FILE, createLeakScanner, envSecretValues, groupFindings, isBlockingLeak } from "../packages/shared/src/leaks.ts";

// The scanning core (patterns, masking, scanner) lives in packages/shared/src/leaks.ts; the engine uses it too.
const ROOT = process.env.AGENTLIFE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

function git(a: string[], maxBuffer = 512 * 1024 * 1024): string {
  const r = spawnSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${a[0]} failed: ${(r.stderr ?? "").slice(0, 200)}`);
  return r.stdout;
}

// Known secret values on this machine: matched exactly, never printed.
function knownSecrets(): string[] {
  const out: string[] = [];
  const fromEnvFile = (file: string, names: string[]) => {
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m && names.includes(m[1]!) && m[2]) out.push(m[2].trim().replace(/^["']|["']$/g, ""));
    }
  };
  fromEnvFile(join(ROOT, ".env"), ["KIRO_API_KEY", "ENGINE_TOKEN", "LLM_API_KEY", "GITHUB_TOKEN"]);
  fromEnvFile(join(homedir(), ".kiro", "crew", ".env"), ["DISCORD_BOT_TOKEN"]);
  out.push(...envSecretValues());
  return [...new Set(out.filter((s) => s.length >= 12))];
}

function loadAllow(): Set<string> {
  const f = join(ROOT, "scripts", "security-allow.json");
  if (!existsSync(f)) return new Set();
  const j = JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")) as { allow?: { id: string }[] };
  return new Set((j.allow ?? []).map((a) => a.id));
}

const secrets = knownSecrets();
const allow = loadAllow();
const scanner = createLeakScanner({ secrets, allow });
const { add, scanText } = scanner;

function scanTracked(): void {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const f of files) {
    if (/^data\/|\.db$/.test(f)) add("high", "tracked-runtime-data", f, f);
    const p = join(ROOT, f);
    if (!existsSync(p)) {
      scanner.scanFile(f, new Uint8Array());
      continue;
    }
    scanner.scanFile(f, readFileSync(p));
  }
}

function scanStaged(): void {
  const diff = git(["diff", "--cached", "-U0", "--no-color"]);
  let file = "(staged)";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && !SKIP_SCAN_FILE.test(file)) scanText(line.slice(1), `staged:${file}`);
  }
}

function scanHistory(): void {
  // Commit metadata: author and committer addresses end up public on push.
  for (const line of git(["log", "--all", "--format=%H%x09%ae%x09%ce"]).split("\n").filter(Boolean)) {
    const [sha, ae, ce] = line.split("\t");
    for (const e of [ae, ce]) if (e && !SAFE_EMAIL.test(e)) add("medium", "commit-email", `commit ${sha!.slice(0, 7)} metadata`, e);
  }
  // Every line ever added in any commit.
  const log = git(["log", "--all", "-p", "--no-color", "--format=@@COMMIT %H", "-U0"]);
  let sha = "";
  let file = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@@COMMIT ")) { sha = line.slice(9, 16); continue; }
    if (line.startsWith("+++ b/")) { file = line.slice(6); continue; }
    if (line.startsWith("+") && !line.startsWith("+++") && !SKIP_SCAN_FILE.test(file)) scanText(line.slice(1), `history ${sha}:${file}`);
  }
}

try {
  if (args.has("--staged")) scanStaged();
  else { scanTracked(); scanHistory(); }
} catch (e) {
  console.error(`[security] scanner error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

// Collapse the same value found in many places into one line per value.
const groups = groupFindings(scanner.findings).map((g) => ({ f: g.finding, where: g.where }));

if (args.has("--json")) {
  console.log(JSON.stringify(groups.map((g) => ({ ...g.f, where: g.where.slice(0, 20), count: g.where.length })), null, 2));
} else if (groups.length === 0) {
  console.log("[security] clean: no secrets, personal emails or private paths found");
} else {
  for (const g of groups) {
    const extra = g.where.length > 3 ? ` (+${g.where.length - 3} more)` : "";
    console.log(`[${g.f.severity.toUpperCase()}] ${g.f.kind} ${g.f.masked} id=${g.f.id}\n    ${g.where.slice(0, 3).join("\n    ")}${extra}`);
  }
}
const blocking = groups.some((g) => isBlockingLeak(g.f));
process.exit(blocking ? 1 : 0);
