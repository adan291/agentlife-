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

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Severity = "high" | "medium" | "low";
interface Finding { severity: Severity; kind: string; where: string; masked: string; id: string }

const ROOT = process.env.AGENTLIFE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

function git(a: string[], maxBuffer = 512 * 1024 * 1024): string {
  const r = spawnSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${a[0]} failed: ${(r.stderr ?? "").slice(0, 200)}`);
  return r.stdout;
}

const hash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 12);
function mask(v: string): string {
  const at = v.indexOf("@");
  if (at > 0) return `${v[0]}***@${v.slice(at + 1)}`;
  return v.length <= 8 ? "***" : `${v.slice(0, 4)}…${v.slice(-2)} (${v.length} chars)`;
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
  for (const n of ["KIRO_API_KEY", "ENGINE_TOKEN", "LLM_API_KEY", "GITHUB_TOKEN", "DISCORD_BOT_TOKEN"]) {
    const v = process.env[n];
    if (v) out.push(v);
  }
  return [...new Set(out.filter((s) => s.length >= 12))];
}

const PATTERNS: { kind: string; severity: Severity; re: RegExp }[] = [
  { kind: "kiro-api-key", severity: "high", re: /ksk_[A-Za-z0-9]{16,}/g },
  { kind: "openai-style-key", severity: "high", re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", severity: "high", re: /\b(ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: "aws-access-key", severity: "high", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "discord-bot-token", severity: "high", re: /\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/g },
  { kind: "private-key", severity: "high", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "email", severity: "medium", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: "user-home-path", severity: "low", re: /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/g },
];

const SAFE_EMAIL = /(@users\.noreply\.github\.com|@agentlife\.local|@example\.(com|org)|\.(test|invalid|example)|@localhost)$/i;
const SAFE_PATH = /\\Users\\(\.\.\.|<user>|USERNAME|you)$/i;
// Paths whose content is not ours to judge (lockfile integrity hashes, binary assets).
const SKIP_FILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$|\.(png|jpg|jpeg|gif|webp|glb|ico|woff2?)$/i;

function loadAllow(): Set<string> {
  const f = join(ROOT, "scripts", "security-allow.json");
  if (!existsSync(f)) return new Set();
  const j = JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, "")) as { allow?: { id: string }[] };
  return new Set((j.allow ?? []).map((a) => a.id));
}

const findings: Finding[] = [];
const seen = new Set<string>();
const secrets = knownSecrets();
const allow = loadAllow();

function add(severity: Severity, kind: string, where: string, value: string): void {
  const id = hash(`${kind}:${value}`);
  if (allow.has(id)) return;
  const key = `${id}|${where}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ severity, kind, where, masked: mask(value), id });
}

function scanText(text: string, where: string): void {
  for (const s of secrets) if (text.includes(s)) add("high", "known-secret-value", where, s);
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const v = m[0];
      if (p.kind === "email" && SAFE_EMAIL.test(v)) continue;
      if (p.kind === "user-home-path" && SAFE_PATH.test(v)) continue;
      add(p.severity, p.kind, where, v);
    }
  }
}

function scanTracked(): void {
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const f of files) {
    if (/(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")) add("high", "tracked-env-file", f, f);
    if (/^data\/|\.db$/.test(f)) add("high", "tracked-runtime-data", f, f);
    if (SKIP_FILE.test(f)) continue;
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    const buf = readFileSync(p);
    if (buf.includes(0)) continue;
    scanText(buf.toString("utf8"), f);
  }
}

function scanStaged(): void {
  const diff = git(["diff", "--cached", "-U0", "--no-color"]);
  let file = "(staged)";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && !SKIP_FILE.test(file)) scanText(line.slice(1), `staged:${file}`);
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
    if (line.startsWith("+") && !line.startsWith("+++") && !SKIP_FILE.test(file)) scanText(line.slice(1), `history ${sha}:${file}`);
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
const byId = new Map<string, { f: Finding; where: string[] }>();
for (const f of findings) {
  const g = byId.get(f.id) ?? { f, where: [] };
  g.where.push(f.where);
  byId.set(f.id, g);
}
const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const groups = [...byId.values()].sort((a, b) => order[a.f.severity] - order[b.f.severity]);

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
const blocking = groups.some((g) => g.f.severity !== "low");
process.exit(blocking ? 1 : 0);
