/**
 * Result of an `audit-deps` job (night-shift spec, requirement 3.3): the packages `npm outdated` lists and the
 * vulnerabilities `npm audit` lists. Pure data and parsers; the Docker part is `steps/audit-deps.ts`.
 * Everything here comes from the project's dependency tree, so it is untrusted text: sizes are capped and the report
 * prints names only inside code spans.
 */

export type AuditSeverity = "info" | "low" | "moderate" | "high" | "critical";
export const AUDIT_SEVERITIES: readonly AuditSeverity[] = ["critical", "high", "moderate", "low", "info"];

export interface OutdatedPackage {
  name: string;
  current?: string;
  wanted?: string;
  latest?: string;
}

export interface Vulnerability {
  name: string;
  severity: AuditSeverity;
  range?: string;
  /** npm's `fixAvailable`: a boolean, or the version that fixes it (`name@version`). */
  fix?: string;
}

export interface AuditResult {
  outdated: OutdatedPackage[];
  vulnerabilities: Vulnerability[];
  /** `npm outdated` produced a list (possibly empty). */
  outdatedOk: boolean;
  /** `npm audit` produced a list (possibly empty). */
  auditOk: boolean;
  /** Qualifications for the reader: the sandbox is offline, a command gave nothing. */
  notes: string[];
}

export const AUDIT_MAX_ITEMS = 200;
const FIELD_MAX = 100;

/** The sandbox has no network (job-types and agent-pipeline keep `--network none`), so npm answers from its cache. */
export const OFFLINE_NOTE =
  "The sandbox has no network, so npm answered from its local cache only. The lists may be stale or incomplete.";

/** Markers the audit command prints between the two outputs, so one container run gives both. */
export const MARK_OUTDATED = "@@AUDIT outdated";
export const MARK_AUDIT = "@@AUDIT audit";
export const MARK_END = "@@AUDIT end";

function cut(s: string, n = FIELD_MAX): string {
  const flat = s.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

function parseJson(text: string): unknown {
  const t = text.trim();
  if (t === "") return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorSummary(json: Record<string, unknown>): string | undefined {
  const err = json["error"];
  if (!isRecord(err)) return undefined;
  const text = typeof err["summary"] === "string" ? err["summary"] : typeof err["code"] === "string" ? err["code"] : "npm reported an error";
  return cut(text, 160);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? cut(v) : undefined;
}

/** `npm outdated --json`: an object keyed by package name; a package in several places gives an array. */
export function parseOutdated(text: string): { ok: boolean; items: OutdatedPackage[]; problem?: string } {
  const json = parseJson(text);
  if (!isRecord(json)) return { ok: false, items: [], problem: "npm outdated gave no JSON" };
  const problem = errorSummary(json);
  if (problem) return { ok: false, items: [], problem };
  const items: OutdatedPackage[] = [];
  for (const [name, value] of Object.entries(json)) {
    const entry = Array.isArray(value) ? value[0] : value;
    if (!isRecord(entry)) continue;
    const current = str(entry["current"]);
    const wanted = str(entry["wanted"]);
    const latest = str(entry["latest"]);
    items.push({ name: cut(name, 214), ...(current ? { current } : {}), ...(wanted ? { wanted } : {}), ...(latest ? { latest } : {}) });
    if (items.length >= AUDIT_MAX_ITEMS) break;
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, items };
}

function severityOf(v: unknown): AuditSeverity {
  return v === "critical" || v === "high" || v === "moderate" || v === "low" || v === "info" ? v : "info";
}

/** `npm audit --json` (npm 7 and later): `vulnerabilities` keyed by package name. */
export function parseAudit(text: string): { ok: boolean; items: Vulnerability[]; problem?: string } {
  const json = parseJson(text);
  if (!isRecord(json)) return { ok: false, items: [], problem: "npm audit gave no JSON" };
  const problem = errorSummary(json);
  if (problem) return { ok: false, items: [], problem };
  const vulns = json["vulnerabilities"];
  if (!isRecord(vulns)) return { ok: false, items: [], problem: "npm audit gave an unexpected answer" };
  const items: Vulnerability[] = [];
  for (const [name, value] of Object.entries(vulns)) {
    if (!isRecord(value)) continue;
    const fixAvailable = value["fixAvailable"];
    const fix =
      typeof fixAvailable === "string"
        ? cut(fixAvailable)
        : isRecord(fixAvailable) && typeof fixAvailable["name"] === "string" && typeof fixAvailable["version"] === "string"
          ? cut(`${fixAvailable["name"]}@${fixAvailable["version"]}`)
          : fixAvailable === true
            ? "yes"
            : undefined;
    const range = str(value["range"]);
    items.push({ name: cut(name, 214), severity: severityOf(value["severity"]), ...(range ? { range } : {}), ...(fix ? { fix } : {}) });
  }
  const order = (s: AuditSeverity): number => AUDIT_SEVERITIES.indexOf(s);
  items.sort((a, b) => order(a.severity) - order(b.severity) || a.name.localeCompare(b.name));
  return { ok: true, items: items.slice(0, AUDIT_MAX_ITEMS) };
}

/** Cuts the container output at the markers and parses both parts. */
export function parseAuditOutput(output: string): AuditResult {
  const text = output.replace(/\r\n/g, "\n");
  const iOut = text.indexOf(MARK_OUTDATED);
  const iAud = text.indexOf(MARK_AUDIT);
  const iEnd = text.indexOf(MARK_END);
  const outdated = parseOutdated(between(text, iOut, iAud));
  const audit = parseAudit(between(text, iAud, iEnd));
  const notes: string[] = [OFFLINE_NOTE];
  if (!outdated.ok) notes.push(`The list of outdated packages is missing: ${outdated.problem ?? "no data"}.`);
  if (!audit.ok) notes.push(`The list of vulnerabilities is missing: ${audit.problem ?? "no data"}.`);
  return { outdated: outdated.items, vulnerabilities: audit.items, outdatedOk: outdated.ok, auditOk: audit.ok, notes };
}

/** The text after the marker line that starts at `from`, up to the marker at `to` (or the end). Empty when `from` is missing. */
function between(text: string, from: number, to: number): string {
  if (from < 0) return "";
  const nl = text.indexOf("\n", from);
  if (nl < 0) return "";
  return text.slice(nl + 1, to > from ? Math.max(nl + 1, to) : text.length);
}

/**
 * `fail` when the audit gave no list at all, or lists a high or critical vulnerability. Outdated packages alone are
 * information, not a failure.
 */
export function auditVerdict(a: AuditResult): "pass" | "fail" {
  if (!a.outdatedOk && !a.auditOk) return "fail";
  return a.vulnerabilities.some((v) => v.severity === "high" || v.severity === "critical") ? "fail" : "pass";
}

/** One line for the activity terminal. */
export function auditLine(a: AuditResult): string {
  if (!a.outdatedOk && !a.auditOk) return "Audit: npm gave no data";
  const vulns = a.auditOk ? `${a.vulnerabilities.length} vulnerable` : "vulnerabilities unknown";
  const old = a.outdatedOk ? `${a.outdated.length} outdated` : "outdated unknown";
  return `Audit: ${old}, ${vulns}`;
}
