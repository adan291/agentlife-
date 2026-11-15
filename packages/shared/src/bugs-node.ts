// Bug sack, the node-only half (spec bug-sack): masking of secrets and private paths, the file format of
// `data/bugs.jsonl` and the inbox other processes append to. Not exported from the package index, because it uses node:fs
// and the leak scanner (the client bundle must not pull them in). Import it as `@agentlife/shared/bugs-node`.
// See .kiro/specs/bug-sack/design.md.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUG_CONTEXT_KEYS,
  BUG_FIELD_MAX,
  BUG_INBOX_MAX_BYTES,
  BUG_MESSAGE_MAX,
  BUG_NOTE_MAX,
  BUG_STACK_MAX,
  BugGroupSchema,
  BugInputSchema,
  BugKindSchema,
  type BugContext,
  type BugGroup,
  type BugInput,
  type BugProcess,
} from "./bugs.ts";
import { envSecretValues, maskLeaks } from "./leaks.ts";

/** The repository root: `packages/shared/src` is three folders below it. */
export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// ---- masking ----

export interface BugMaskOptions {
  /** Exact secret values to remove. Default: the well-known secret variables of the environment. */
  secrets?: readonly string[];
  /** Folders whose name must not appear: the repository root (default: this repository) becomes `<repo>`. */
  repoRoot?: string;
  /** The allowed project roots (default `D:\AgentHotel`), they become `<projects>`. */
  projectRoots?: readonly string[];
  /** The user's home folder, `<home>`. Default: the OS home. */
  home?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A regex that finds `root` written with either kind of slash, in any letter case (Windows paths ignore case). */
function rootRegex(root: string): RegExp | undefined {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const lead = /^[\\/]{2}/.test(root) ? "[\\\\/]{2}" : root.startsWith("/") ? "/" : "";
  return new RegExp(`${lead}${parts.map(escapeRegex).join("[\\\\/]+")}(?=[\\\\/]|$|[^\\w\\\\/.-])`, "gi");
}

const SEGMENT = String.raw`[^\\/\s:*?"'<>|()\[\]]`;
const WIN_PATH = new RegExp(String.raw`(?<![\w<])(?:[A-Za-z]:|\\\\[^\\/\s]+)[\\/](?:${SEGMENT}+[\\/])*${SEGMENT}*`, "g");
const POSIX_PATH = new RegExp(String.raw`(?<![\w.:/<>~-])/(?:home|Users|root|tmp|var|opt|mnt|srv|usr|etc|workspace|app|builds|runner)(?:/[^\s:()'"<>]*)?`, "g");

function pathTail(path: string): string {
  const segs = path.split(/[\\/]+/).filter(Boolean);
  if (segs[0] && /^[A-Za-z]:$/.test(segs[0])) segs.shift();
  const tail = segs.slice(-2).join("/");
  return tail ? `<path>/${tail}` : "<path>";
}

/** Private folders out of a text: the known roots by name, any other absolute path down to its last two segments. */
export function maskPaths(text: string, opts: BugMaskOptions = {}): string {
  const roots: [string, string][] = [
    [opts.repoRoot ?? REPO_ROOT, "<repo>"],
    ...(opts.projectRoots ?? ["D:\\AgentHotel"]).map((r): [string, string] => [r, "<projects>"]),
    [opts.home ?? homedir(), "<home>"],
  ];
  let out = text;
  for (const [root, token] of roots.sort((a, b) => b[0].length - a[0].length)) {
    const re = rootRegex(root);
    if (re) out = out.replace(re, token);
  }
  return out.replace(WIN_PATH, pathTail).replace(POSIX_PATH, pathTail);
}

/** A secret that sits next to its name (`GITHUB_TOKEN=...`, `"password": "..."`, `Bearer ...`): the name stays, the value goes. */
function maskAssignments(text: string): string {
  return text
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*=)\S+/g, "$1[masked]")
    .replace(/("[A-Za-z0-9_-]*(?:key|token|secret|password|passwd|credential)[A-Za-z0-9_-]*"\s*:\s*")[^"]{4,}"/gi, '$1[masked]"')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [masked]");
}

// Control characters other than tab and newline (a client cannot smuggle terminal escapes into `pnpm bugs`).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Plain text that is safe to store and print: bounded, no control characters, no secrets, no private paths. */
export function maskBugText(text: string, max: number, opts: BugMaskOptions = {}): string {
  const bounded = text.replace(CONTROL, "").slice(0, max * 4);
  const secrets = opts.secrets ?? envSecretValues();
  // Masking a path can make a boundary appear next to a key (`AKIA...D:\x` becomes `AKIA...<projects>\x`), so the leak
  // masking runs once more at the end.
  const masked = maskPaths(maskAssignments(maskLeaks(bounded, { secrets })), opts);
  return maskLeaks(masked, { secrets }).slice(0, max);
}

function cleanContext(raw: unknown, opts: BugMaskOptions): BugContext {
  const out: BugContext = {};
  if (!raw || typeof raw !== "object") return out;
  const rec = raw as Record<string, unknown>;
  for (const key of BUG_CONTEXT_KEYS) {
    const v = rec[key];
    if (typeof v !== "string" || v === "") continue;
    const clean = maskBugText(v, BUG_FIELD_MAX, opts).replace(/\s+/g, " ").trim();
    if (clean) out[key] = clean;
  }
  return out;
}

/**
 * Makes any report storable: every text capped, stripped of control characters and passed through the leak masking and the
 * path masking. Input from a browser is untrusted, so this takes `unknown` fields and never throws (what cannot be used gets
 * a fallback). Idempotent: cleaning a clean report returns the same report.
 */
export function cleanBugInput(raw: Pick<BugInput, "component" | "process"> & { kind: string; message: string; stack?: string | undefined; note?: string | undefined; context?: unknown; clientTime?: number | undefined }, opts: BugMaskOptions = {}): BugInput {
  const kind = BugKindSchema.safeParse(raw.kind).success ? raw.kind : "unknown";
  const message = maskBugText(String(raw.message ?? ""), BUG_MESSAGE_MAX, opts).trim() || "(no message)";
  const stack = typeof raw.stack === "string" ? maskBugText(raw.stack, BUG_STACK_MAX, opts).trim() : "";
  const note = typeof raw.note === "string" ? maskBugText(raw.note, BUG_NOTE_MAX, opts).trim() : "";
  const context = cleanContext(raw.context, opts);
  const clientTime = typeof raw.clientTime === "number" && Number.isInteger(raw.clientTime) && raw.clientTime >= 0 ? raw.clientTime : undefined;
  return {
    component: raw.component,
    process: raw.process,
    kind,
    message,
    ...(stack ? { stack } : {}),
    ...(note ? { note } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(clientTime === undefined ? {} : { clientTime }),
  };
}

/** The report of an `Error` (or anything thrown): message and stack, as plain text. */
export function bugFromError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const message = error.message ? `${error.name}: ${error.message}` : error.name;
    return { message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  return { message: typeof error === "string" ? error : "Non-error thrown" };
}

// ---- files ----

export interface BugFiles {
  /** `data/bugs.jsonl` */
  file: string;
  /** Where other processes append. */
  inbox: string;
  /** The inbox while the world-server reads it. */
  draining: string;
  /** Folder of the screenshots. */
  shots: string;
}

/** `data/bugs.jsonl` and its neighbours, or the same names next to `AGENTLIFE_BUGS_FILE`. */
export function bugFiles(env: NodeJS.ProcessEnv = process.env, root: string = REPO_ROOT): BugFiles {
  const file = env["AGENTLIFE_BUGS_FILE"] || join(root, "data", "bugs.jsonl");
  const base = file.replace(/\.jsonl$/i, "");
  return { file, inbox: `${base}-inbox.jsonl`, draining: `${base}-inbox.draining`, shots: base };
}

export const BUG_FILE_FORMAT = "agentlife-bugs";

/** The text of `bugs.jsonl`: a header line, then one group per line, newest first. */
export function serializeBugFile(groups: readonly BugGroup[], savedAt: number): string {
  const sorted = [...groups].sort((a, b) => b.lastSeen - a.lastSeen || (a.id < b.id ? -1 : 1));
  return `${[JSON.stringify({ format: BUG_FILE_FORMAT, version: 1, savedAt }), ...sorted.map((g) => JSON.stringify(g))].join("\n")}\n`;
}

/** Parses the text of `bugs.jsonl`. Throws with the reason when the header or any line is wrong. */
export function parseBugFile(text: string): BugGroup[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift();
  const h = header ? (JSON.parse(header) as { format?: unknown; version?: unknown }) : undefined;
  if (!h || h.format !== BUG_FILE_FORMAT || h.version !== 1) throw new Error("not an agentlife-bugs version 1 file");
  const ids = new Set<string>();
  return lines.map((l, i) => {
    const g = BugGroupSchema.parse(JSON.parse(l));
    if (ids.has(g.id)) throw new Error(`line ${i + 2}: group ${g.id} twice`);
    ids.add(g.id);
    return g;
  });
}

export interface LoadBugOptions {
  now?: () => number;
  onLog?: (message: string) => void;
  /** Default true. `pnpm bugs` reads and never writes, so it passes false. */
  moveAside?: boolean;
}

/**
 * The groups in `bugs.jsonl`. A missing file gives an empty list. An unreadable one is renamed `<file>.bad-<time>` (when
 * `moveAside`) and gives an empty list, so the old content is never overwritten.
 */
export function loadBugFile(file: string, opts: LoadBugOptions = {}): BugGroup[] {
  if (!existsSync(file)) return [];
  try {
    return parseBugFile(readFileSync(file, "utf8"));
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (opts.moveAside === false) {
      opts.onLog?.(`${file} is unreadable: ${reason}`);
      return [];
    }
    const aside = `${file}.bad-${(opts.now ?? Date.now)()}`;
    opts.onLog?.(`${file} is unreadable, moved aside to ${aside}: ${reason}`);
    try {
      renameSync(file, aside);
    } catch {
      // Nothing better can be done here; the next save would replace it.
    }
    return [];
  }
}

/** Writes a temporary file in the same folder, then renames it over the target. Throws when it cannot. */
export function writeTextAtomic(file: string, text: string | Uint8Array): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

// ---- the inbox ----

export interface InboxRecord {
  /** Epoch ms when the report was made. */
  at: number;
  report: BugInput;
}

/** Records of one inbox file. Lines that are not valid are counted and skipped. */
export function readInboxFile(file: string): { records: InboxRecord[]; bad: number } {
  const records: InboxRecord[] = [];
  let bad = 0;
  if (!existsSync(file)) return { records, bad };
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const raw = JSON.parse(line) as { at?: unknown; report?: unknown };
      const report = BugInputSchema.safeParse(raw.report);
      if (typeof raw.at === "number" && Number.isFinite(raw.at) && report.success) records.push({ at: Math.max(0, Math.trunc(raw.at)), report: report.data });
      else bad++;
    } catch {
      bad++;
    }
  }
  return { records, bad };
}

export interface BugReporterOptions {
  process: BugProcess;
  env?: NodeJS.ProcessEnv;
  files?: BugFiles;
  /** Passed to the masking (the engine gives its own list of secrets and the allowed project roots). */
  mask?: BugMaskOptions;
  now?: () => number;
  /** Where a warning goes (default `console.warn`). */
  onWarn?: (message: string) => void;
}

export interface BugReporter {
  /** Appends a code report to the inbox. Never throws. */
  report(input: { kind: string; message: string; stack?: string | undefined; context?: BugContext | undefined }): void;
  /** The same for something thrown. */
  error(kind: string, error: unknown, context?: BugContext): void;
}

/**
 * For a process that does not own the store (the engine, the conductor, `pnpm session`): masks the report and appends it to
 * the inbox as one line. Writes nothing when the inbox is already over its limit (nobody is draining it).
 */
export function createBugReporter(opts: BugReporterOptions): BugReporter {
  const files = opts.files ?? bugFiles(opts.env);
  const now = opts.now ?? Date.now;
  const warn = opts.onWarn ?? ((m: string) => console.warn(m));
  let warned = false;
  const report: BugReporter["report"] = (input) => {
    try {
      const clean = cleanBugInput({ component: "code", process: opts.process, ...input }, opts.mask);
      if (existsSync(files.inbox) && statSync(files.inbox).size > BUG_INBOX_MAX_BYTES) {
        if (!warned) {
          warned = true;
          warn(`[bugs] ${files.inbox} is full; new reports are dropped until the world-server reads it`);
        }
        return;
      }
      mkdirSync(dirname(files.inbox), { recursive: true });
      appendFileSync(files.inbox, `${JSON.stringify({ at: now(), report: clean })}\n`, "utf8");
    } catch (e) {
      if (!warned) {
        warned = true;
        warn(`[bugs] could not record a report: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  return { report, error: (kind, error, context) => report({ kind, ...bugFromError(error), ...(context ? { context } : {}) }) };
}
