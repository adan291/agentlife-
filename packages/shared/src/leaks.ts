// Deterministic leak scanner core (no model, no credits). Shared by `scripts/security-scan.ts` (this repository)
// and the agent-engine (tracked files of a project that the user registers).
//
// This module uses node:crypto, so it is NOT exported from the package index (the client bundle must not pull it in).
// Import it as `@agentlife/shared/leaks`.
//
// Findings never carry the secret itself: values are masked and identified by a short hash. A finding the user
// accepted is listed by hash in an allowlist, so the allowlist leaks nothing either.

import { createHash } from "node:crypto";

export type LeakSeverity = "high" | "medium" | "low";

export interface LeakFinding {
  severity: LeakSeverity;
  kind: string;
  where: string;
  masked: string;
  id: string;
}

export const LEAK_PATTERNS: readonly { kind: string; severity: LeakSeverity; re: RegExp }[] = [
  { kind: "kiro-api-key", severity: "high", re: /ksk_[A-Za-z0-9]{16,}/g },
  { kind: "openai-style-key", severity: "high", re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { kind: "github-token", severity: "high", re: /\b(ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g },
  { kind: "aws-access-key", severity: "high", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "discord-bot-token", severity: "high", re: /\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/g },
  { kind: "private-key", severity: "high", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: "email", severity: "medium", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: "user-home-path", severity: "low", re: /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/g },
];

export const SAFE_EMAIL = /(@users\.noreply\.github\.com|@agentlife\.local|@example\.(com|org)|\.(test|invalid|example)|@localhost)$/i;
export const SAFE_PATH = /\\Users\\(\.\.\.|<user>|USERNAME|you)$/i;
/** Paths whose content is not ours to judge (lockfile integrity hashes, binary assets). */
export const SKIP_SCAN_FILE = /(^|\/)(pnpm-lock\.yaml|package-lock\.json)$|\.(png|jpg|jpeg|gif|webp|glb|ico|woff2?)$/i;
/** A tracked file with this name is a finding by itself (`.env.example` is fine). */
export const TRACKED_ENV_FILE = /(^|\/)\.env($|\.)/;

const KNOWN_SECRET_ENV_NAMES = ["KIRO_API_KEY", "ENGINE_TOKEN", "LLM_API_KEY", "GITHUB_TOKEN", "DISCORD_BOT_TOKEN"] as const;
const MIN_KNOWN_SECRET_CHARS = 12;

export function leakHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function maskLeak(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}***@${value.slice(at + 1)}`;
  return value.length <= 8 ? "***" : `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

/** Values of the well-known secret variables of this machine, to be matched exactly (never printed). */
export function envSecretValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const name of KNOWN_SECRET_ENV_NAMES) {
    const v = env[name];
    if (v) out.push(v);
  }
  return [...new Set(out.filter((s) => s.length >= MIN_KNOWN_SECRET_CHARS))];
}

export interface LeakScannerOptions {
  /** Exact secret values to look for. Values shorter than 12 characters are ignored. */
  secrets?: readonly string[];
  /** Finding ids (see `leakHash`) that were accepted and must not be reported. */
  allow?: ReadonlySet<string>;
}

export interface LeakScanner {
  readonly findings: LeakFinding[];
  add(severity: LeakSeverity, kind: string, where: string, value: string): void;
  scanText(text: string, where: string): void;
  /** Name check (tracked `.env` files) plus content scan; skips lockfiles, binary assets and binary content. */
  scanFile(rel: string, content: Uint8Array): void;
}

export function createLeakScanner(opts: LeakScannerOptions = {}): LeakScanner {
  const secrets = (opts.secrets ?? []).filter((s) => s.length >= MIN_KNOWN_SECRET_CHARS);
  const allow = opts.allow ?? new Set<string>();
  const findings: LeakFinding[] = [];
  const seen = new Set<string>();

  const add = (severity: LeakSeverity, kind: string, where: string, value: string): void => {
    const id = leakHash(`${kind}:${value}`);
    if (allow.has(id)) return;
    const key = `${id}|${where}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, kind, where, masked: maskLeak(value), id });
  };

  const scanText = (text: string, where: string): void => {
    for (const s of secrets) if (text.includes(s)) add("high", "known-secret-value", where, s);
    for (const p of LEAK_PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        const v = m[0];
        if (p.kind === "email" && SAFE_EMAIL.test(v)) continue;
        if (p.kind === "user-home-path" && SAFE_PATH.test(v)) continue;
        add(p.severity, p.kind, where, v);
      }
    }
  };

  const scanFile = (rel: string, content: Uint8Array): void => {
    if (TRACKED_ENV_FILE.test(rel) && !rel.endsWith(".env.example")) add("high", "tracked-env-file", rel, rel);
    if (SKIP_SCAN_FILE.test(rel)) return;
    if (content.includes(0)) return;
    scanText(Buffer.from(content).toString("utf8"), rel);
  };

  return { findings, add, scanText, scanFile };
}

export interface LeakGroup {
  finding: LeakFinding;
  where: string[];
}

const SEVERITY_ORDER: Record<LeakSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Collapses the same value found in many places into one entry, highest severity first. */
export function groupFindings(findings: readonly LeakFinding[]): LeakGroup[] {
  const byId = new Map<string, LeakGroup>();
  for (const f of findings) {
    const g = byId.get(f.id) ?? { finding: f, where: [] };
    g.where.push(f.where);
    byId.set(f.id, g);
  }
  return [...byId.values()].sort((a, b) => SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity]);
}

/** High and medium findings block publishing and registration; low ones are only reported. */
export function isBlockingLeak(f: Pick<LeakFinding, "severity">): boolean {
  return f.severity !== "low";
}
