import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { IMPORT_MAX_BYTES, ImportUrlSchema, TemplateSchema, tierForRole, TeamRoleSchema, type Template } from "@agentlife/shared";
import { createLeakScanner, envSecretValues, groupFindings, isBlockingLeak } from "@agentlife/shared/leaks";
import { DEFAULT_CONFIG_DIR } from "../config.ts";
import { ConflictError } from "../errors.ts";

/**
 * Trusted imports (hr-desk requirement 3). Everything here is pure or takes its network function as an argument, so the
 * rules are tested without a network: which addresses are allowed, which fields of a file are kept, what is refused, and
 * the checks that run before a model looks at the text.
 */

export const IMPORT_TIMEOUT_MS = 10_000;

// ---- Allowlist ----

const SourcesFileSchema = z.object({ $comment: z.string().optional(), sources: z.array(ImportUrlSchema).max(50) });

/** The addresses imports may come from (`config/catalogue-sources.json`). A missing file means none. */
export function loadCatalogueSources(dir: string = DEFAULT_CONFIG_DIR): string[] {
  const file = path.join(dir, "catalogue-sources.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`config: cannot read ${file}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`config: catalogue-sources.json is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = SourcesFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`config: catalogue-sources.json is invalid: ${issues}`);
  }
  return parsed.data.sources.flatMap((s) => normaliseSourceUrl(s) ?? []);
}

/** The canonical form of an HTTPS address, or undefined when it is not one (other scheme, credentials in it, not a URL). */
export function normaliseSourceUrl(raw: string): string | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || u.hostname === "") return undefined;
  u.hash = "";
  return u.href;
}

/** True only when the address, after normalising, is exactly one of the listed sources. */
export function isAllowedSource(url: string, sources: readonly string[]): boolean {
  const wanted = normaliseSourceUrl(url);
  if (wanted === undefined) return false;
  return sources.some((s) => normaliseSourceUrl(s) === wanted);
}

// ---- Fetch ----

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Reads one file from an address that is already on the list. No redirects are followed (a redirect could leave the
 * list), no credentials are sent, the wait is bounded, and the body is cut off at the size cap while it is read.
 */
export async function fetchImportText(url: string, opts: FetchOptions = {}): Promise<string> {
  const fetchFn = opts.fetch ?? ((u, init) => fetch(u, init));
  const maxBytes = opts.maxBytes ?? IMPORT_MAX_BYTES;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? IMPORT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, { method: "GET", redirect: "manual", credentials: "omit", signal: timeout, headers: { accept: "application/json" } });
  } catch {
    throw new ConflictError("fetch_failed", timeout.aborted ? "The source did not answer in time." : "The source could not be reached.");
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    throw new ConflictError("fetch_failed", "The source sent the request somewhere else. Redirects are not followed; list the final address instead.");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new ConflictError("fetch_failed", `The source answered ${res.status}.`);
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new ConflictError("import_too_large", `The file is larger than ${Math.round(maxBytes / 1024)} KB.`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ConflictError("import_too_large", `The file is larger than ${Math.round(maxBytes / 1024)} KB.`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ConflictError) throw e;
    throw new ConflictError("fetch_failed", timeout.aborted ? "The source did not answer in time." : "The answer of the source was cut off.");
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ---- Parsing ----

/** The fields of an imported file that are read. Everything else is dropped. */
const CONTENT_FIELDS = ["id", "name", "role", "persona", "description", "defaultModel"] as const;
/** Fields the engine sets itself; a file that carries them is not reported unless it contradicts the engine. */
const DERIVED_FIELDS = ["tier", "source"] as const;
const MAX_IGNORED = 30;
const SAFE_FIELD_NAME = /^[A-Za-z0-9_$.-]{1,60}$/;
// Control characters other than tab, newline and carriage return; zero-width, direction-changing and byte-order characters.
// eslint-disable-next-line no-control-regex
const HIDDEN_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

export type ParsedImport = { ok: true; template: Template; ignored: string[] } | { ok: false; reason: string };

function issueText(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`)
    .join("; ");
}

/**
 * Turns the parsed JSON of an imported file into a template. Only the content fields are copied; every other field
 * (`tools`, `permissions`, `mcpServers`, `hooks`, `resources`, anything unknown) is dropped and its name returned in
 * `ignored`. The tier is computed from the role and the source is the address, never what the file says. The text is
 * refused when it is too long, holds hidden characters, or looks like it holds a secret or an e-mail address.
 */
export function parseImport(raw: unknown, url: string): ParsedImport {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, reason: "The file must be one JSON object." };
  const obj = raw as Record<string, unknown>;
  const known = new Set<string>([...CONTENT_FIELDS, ...DERIVED_FIELDS]);
  const ignored: string[] = [];
  for (const key of Object.keys(obj)) {
    if (known.has(key)) continue;
    const shown = SAFE_FIELD_NAME.test(key) ? key : "(field with an unusual name)";
    if (!ignored.includes(shown) && ignored.length < MAX_IGNORED) ignored.push(shown);
  }

  const picked: Record<string, unknown> = {};
  for (const f of CONTENT_FIELDS) if (Object.hasOwn(obj, f)) picked[f] = obj[f];
  for (const f of CONTENT_FIELDS) {
    const v = picked[f];
    if (typeof v === "string" && HIDDEN_CHARS.test(v)) return { ok: false, reason: `${f}: contains hidden or control characters.` };
  }

  const role = TeamRoleSchema.safeParse(picked["role"]);
  const expectedTier = role.success ? tierForRole(role.data) : undefined;
  if (Object.hasOwn(obj, "tier") && obj["tier"] !== expectedTier) ignored.push("tier");

  const parsed = TemplateSchema.safeParse({ ...picked, tier: expectedTier, source: url });
  if (!parsed.success) return { ok: false, reason: issueText(parsed.error) };
  const template = parsed.data;

  const scanner = createLeakScanner({ secrets: envSecretValues() });
  scanner.scanText(template.name, "name");
  scanner.scanText(template.description, "description");
  scanner.scanText(template.persona, "persona");
  const blocking = groupFindings(scanner.findings).filter((g) => isBlockingLeak(g.finding));
  if (blocking.length > 0) {
    const kinds = [...new Set(blocking.map((g) => g.finding.kind))].join(", ");
    return { ok: false, reason: `The text holds something that looks like a secret or personal data (${kinds}).` };
  }
  return { ok: true, template, ignored };
}

/** What the user approves is identified by this: any change to any field gives another hash. */
export function templateHash(t: Template): string {
  return createHash("sha256")
    .update(JSON.stringify([t.id, t.name, t.role, t.persona, t.description, t.defaultModel, t.tier, t.source]))
    .digest("hex");
}

// ---- Fixed checks ----

const PATTERNS: readonly { flag: string; re: RegExp }[] = [
  {
    flag: "asks the agent to ignore its earlier instructions or rules",
    re: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?|constraints?|restrictions?)\b/,
  },
  { flag: "claims a new role or a special mode", re: /\b(you are now|from now on,? you|new instructions?|developer mode|jailbreak|do anything now)\b/ },
  { flag: "talks about the system prompt", re: /\bsystem prompt\b/ },
  {
    flag: "asks for secrets, keys or environment variables",
    re: /\b(reveal|print|show|send|leak|exfiltrate|upload|post|echo|output|share|read)\b[^.\n]{0,50}\b(env(ironment)?( variables?)?|secrets?|api[ _-]?keys?|tokens?|credentials?|passwords?|private keys?)\b/,
  },
  {
    flag: "asks to run commands or to use the network",
    re: /\b(run|execute|launch|invoke)\b[^.\n]{0,30}\b(shell|commands?|bash|powershell|cmd|scripts?|terminal)\b|\b(use|enable|call|open)\b[^.\n]{0,20}\b(shell|network|internet|web[_ ]?fetch|browser)\b/,
  },
  {
    flag: "asks for more permissions or to switch safety off",
    re: /\b(grant|give|enable|unlock|request)\b[^.\n]{0,30}\b(permissions?|access|write access|admin|root|sudo)\b|\btrust[- ]all\b|\bbypass\b[^.\n]{0,30}\b(permissions?|sandbox|approval|safety|security|review)\b|\bdisable\b[^.\n]{0,30}\b(sandbox|safety|security|approval|permissions?)\b/,
  },
  { flag: "asks to skip the user's approval", re: /\b(without asking|without (the )?(user'?s? )?approval|skip (the )?(user'?s? )?approval|no need (for|to ask))\b/ },
  { flag: "contains a web address", re: /https?:\/\/|\bwww\./ },
  {
    flag: "asks to send data somewhere",
    re: /\b(send|post|upload|forward|transmit)\b[^.\n]{0,40}\b(to|at)\b[^.\n]{0,20}\b(server|url|address|endpoint|webhook|http)/,
  },
];

/**
 * Looks for the usual signs of prompt injection and of requests for tools or permissions in the text of a template.
 * It is a fixed list of patterns, free and the same every time; the security agent's review comes on top of it.
 */
export function checkTemplateText(t: Pick<Template, "name" | "description" | "persona">): string[] {
  const text = `${t.name}\n${t.description}\n${t.persona}`.toLowerCase().replace(/\s+/g, " ");
  const flags: string[] = [];
  for (const p of PATTERNS) if (p.re.test(text)) flags.push(p.flag);
  return flags;
}
