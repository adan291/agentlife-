// Maps kiro-cli stream-json lines to build-crew events (see .kiro/specs/build-crew).
// Pure functions only: the runner does the HTTP. Text sent to the engine never contains
// absolute paths, secrets or command arguments.

import type { Activity, CrewEvent } from "../packages/shared/src/crew.ts";

export const MAX_TEXT = 80;
const MAX_COMMIT_TEXT = 60;

/** Commands whose second word (a sub-command such as `check` or `add`) is safe and useful to show. */
const SUBCOMMAND_TOOLS = new Set(["pnpm", "npm", "npx", "git", "docker", "kiro-cli", "node", "yarn", "gh"]);

/** Removes absolute paths and secret-looking tokens, collapses whitespace and caps the length. */
export function sanitize(text: string, max = MAX_TEXT): string {
  let out = text;
  for (let i = 0; i < 5; i++) {
    const before = out;
    out = out
      .replace(/[A-Za-z]:[\\/]\S*/g, "") // drive-letter paths
      .replace(/(^|\s)[\\/]{1,2}[^\s]*/g, "$1") // rooted or UNC paths
      .replace(/ksk_\w*/gi, "");
    if (out === before) break;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** Last segment of a path, accepting both separators. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? "";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function firstPath(update: Record<string, unknown>): string | undefined {
  const locs = update["locations"];
  if (Array.isArray(locs)) {
    const p = str((locs[0] as { path?: unknown } | undefined)?.path);
    if (p) return p;
  }
  const raw = update["rawInput"];
  if (raw && typeof raw === "object") return str((raw as { path?: unknown }).path);
  return undefined;
}

/** First simple command of a shell line, skipping `cd x;` prefixes. Returns "" when unusable. */
export function commandLabel(command: string): string {
  const segments = command.split(/[;&|]+|\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
  const seg = segments.find((s) => !/^cd(\s|$)/i.test(s)) ?? "";
  const words = seg.split(/\s+/).filter((w) => w.length > 0);
  const first = words[0];
  if (!first) return "";
  const tool = baseName(first).replace(/\.(exe|cmd|ps1)$/i, "");
  const second = words[1];
  if (second && SUBCOMMAND_TOOLS.has(tool.toLowerCase()) && /^[a-z][\w:-]*$/i.test(second)) return `${tool} ${second}`;
  return tool;
}

/** Message of `git commit -m "..."`, first MAX_COMMIT_TEXT chars; undefined when there is none. */
export function commitMessage(command: string): string | undefined {
  const m = /\bgit\s+commit\b[^\n]*?\s-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command);
  const msg = m?.[1] ?? m?.[2] ?? m?.[3];
  return msg ? sanitize(msg, MAX_COMMIT_TEXT) : undefined;
}

function activity(session: string, a: Activity, text?: string): CrewEvent {
  const clean = text ? sanitize(text) : "";
  return { kind: "activity", session, activity: a, ...(clean ? { text: clean } : {}) };
}

/** Maps one stream-json line to a crew event, or null when the line is not progress worth showing. */
export function crewEventFromLine(line: string, session = "S?"): CrewEvent | null {
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object") return null;
  const r = rec as { type?: unknown; data?: { update?: Record<string, unknown> } };
  if (r.type !== "sessionUpdate") return null;
  const update = r.data?.update;
  if (!update || typeof update !== "object") return null;

  const kind = update["sessionUpdate"];
  if (kind === "agent_thought_chunk") return activity(session, "think");
  if (kind !== "tool_call") return null;

  const toolKind = str(update["kind"]);
  const title = str(update["title"]);
  const file = firstPath(update);
  const name = file ? baseName(file) : "";
  const raw = update["rawInput"] as { command?: unknown } | undefined;

  switch (toolKind) {
    case "read":
      return activity(session, "read", name ? `reading ${name}` : "reading");
    case "edit":
    case "write":
      return activity(session, "edit", name ? `editing ${name}` : "editing");
    case "delete":
      return activity(session, "edit", name ? `deleting ${name}` : "deleting");
    case "execute": {
      const command = str(raw?.command) ?? "";
      if (/\bgit\s+commit\b/.test(command)) {
        const msg = commitMessage(command);
        return activity(session, "commit", msg ? `committing: ${msg}` : "committing");
      }
      const label = commandLabel(command);
      return activity(session, "run", label ? `running ${label}` : "running a command");
    }
    default:
      return activity(session, "think", (title ?? toolKind ?? "").toLowerCase());
  }
}

/**
 * Rate limiter for the runner: stream-json has one line per token, so only forward an event when it
 * differs from the previous one or enough time has passed. Frequent `think` events (no text) are limited
 * to one per `minGapMs`; tool calls are always forwarded unless identical to the last one just sent.
 */
export function createSendGate(minGapMs = 1000): (ev: CrewEvent, nowMs: number) => boolean {
  let lastKey = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  return (ev, nowMs) => {
    const key = `${ev.kind}|${ev.activity ?? ""}|${ev.text ?? ""}`;
    if (key === lastKey && nowMs - lastAt < minGapMs * 5) return false;
    if (ev.activity === "think" && nowMs - lastAt < minGapMs) return false;
    lastKey = key;
    lastAt = nowMs;
    return true;
  };
}
