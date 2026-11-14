// Bug sack (spec bug-sack): what an error report is, how reports are grouped and how the groups are kept in memory.
// Pure code with no node imports, so the client can use it too. Masking of secrets and paths needs the leak scanner and
// lives in `bugs-node.ts`; files live in the world-server. See .kiro/specs/bug-sack/design.md.

import { z } from "zod";

// ---- limits ----
export const BUG_MESSAGE_MAX = 1000;
export const BUG_STACK_MAX = 4000;
export const BUG_NOTE_MAX = 500;
/** Longest value of one context field (floor, panel, task, step...). */
export const BUG_FIELD_MAX = 100;
/** A `bug_report` message is refused above this many bytes (it also has to fit the 16 KB message limit). */
export const BUG_REPORT_BYTES = 8192;
/** Reports one connection may send in a minute. */
export const BUG_RATE_PER_MINUTE = 20;
export const BUG_SAMPLES_MAX = 5;
export const BUG_GROUPS_MAX = 500;
export const BUG_SHOT_MAX_BYTES = 1024 * 1024;
export const BUG_INBOX_MAX_BYTES = 1024 * 1024;
export const BUG_SAVE_DEBOUNCE_MS = 500;
export const BUG_DRAIN_MS = 2000;
/** The group message shown in a list. */
export const BUG_LIST_MESSAGE_MAX = 300;

// ---- schemas ----
export const BugComponentSchema = z.enum(["game", "code"]);
export type BugComponent = z.infer<typeof BugComponentSchema>;

export const BUG_PROCESSES = ["client", "world-server", "agent-engine", "conductor", "session"] as const;
export const BugProcessSchema = z.enum(BUG_PROCESSES);
export type BugProcess = z.infer<typeof BugProcessSchema>;

export const BugKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
/** The id of a group: its fingerprint. */
export const BugIdSchema = z.string().regex(/^[0-9a-f]{16}$/);

/** The kinds the browser sends (the server refuses any other from a client). */
export const GAME_BUG_KINDS = ["uncaught", "unhandled-rejection", "console-error", "asset-load", "pixi", "protocol", "manual"] as const;
export const GameBugKindSchema = z.enum(GAME_BUG_KINDS);
export type GameBugKind = z.infer<typeof GameBugKindSchema>;

export const BugStatusSchema = z.enum(["open", "fixed", "ignored"]);
export type BugStatus = z.infer<typeof BugStatusSchema>;

const FieldSchema = z.string().max(BUG_FIELD_MAX);

/** Where it happened. Every value is plain text. */
export const BugContextSchema = z.object({
  floor: FieldSchema.optional(),
  panel: FieldSchema.optional(),
  view: FieldSchema.optional(),
  task: FieldSchema.optional(),
  step: FieldSchema.optional(),
  session: FieldSchema.optional(),
  spec: FieldSchema.optional(),
});
export type BugContext = z.infer<typeof BugContextSchema>;
export const BUG_CONTEXT_KEYS = ["floor", "panel", "view", "task", "step", "session", "spec"] as const;

/** One error as a process saw it. */
export const BugInputSchema = z.object({
  component: BugComponentSchema,
  process: BugProcessSchema,
  kind: BugKindSchema,
  message: z.string().min(1).max(BUG_MESSAGE_MAX),
  stack: z.string().max(BUG_STACK_MAX).optional(),
  note: z.string().max(BUG_NOTE_MAX).optional(),
  context: BugContextSchema.optional(),
  clientTime: z.number().int().nonnegative().optional(),
});
export type BugInput = z.infer<typeof BugInputSchema>;

export const BugSampleSchema = z.object({
  id: z.string().regex(/^b[0-9a-z]{1,24}$/),
  at: z.number().int().nonnegative(),
  message: z.string().max(BUG_MESSAGE_MAX),
  stack: z.string().max(BUG_STACK_MAX).optional(),
  note: z.string().max(BUG_NOTE_MAX).optional(),
  context: BugContextSchema,
  clientTime: z.number().int().nonnegative().optional(),
  /** A screenshot is stored for this sample (`data/bugs/<id>.png`). */
  shot: z.boolean(),
});
export type BugSample = z.infer<typeof BugSampleSchema>;

export const BugGroupSchema = z.object({
  id: BugIdSchema,
  component: BugComponentSchema,
  process: BugProcessSchema,
  kind: BugKindSchema,
  message: z.string().max(BUG_LIST_MESSAGE_MAX),
  frame: z.string().max(200),
  status: BugStatusSchema,
  count: z.number().int().positive(),
  firstSeen: z.number().int().nonnegative(),
  lastSeen: z.number().int().nonnegative(),
  reopened: z.number().int().nonnegative(),
  last: BugContextSchema,
  samples: z.array(BugSampleSchema).max(BUG_SAMPLES_MAX),
});
export type BugGroup = z.infer<typeof BugGroupSchema>;

/** A group without its samples: what a list needs. */
export const BugSummarySchema = BugGroupSchema.omit({ samples: true }).extend({ shots: z.number().int().nonnegative() });
export type BugSummary = z.infer<typeof BugSummarySchema>;

export function bugSummary(g: BugGroup): BugSummary {
  const { samples, ...rest } = g;
  return { ...rest, shots: samples.filter((s) => s.shot).length };
}

/** Open groups per component, for the "Bugs (n)" label. */
export const BugOpenCountSchema = z.object({ game: z.number().int().nonnegative(), code: z.number().int().nonnegative() });
export type BugOpenCount = z.infer<typeof BugOpenCountSchema>;

/** The fields a browser may send in a `bug_report` message (the server decides component and process). */
export const BugReportFieldsSchema = z.object({
  kind: GameBugKindSchema,
  message: z.string().min(1).max(BUG_MESSAGE_MAX),
  stack: z.string().max(BUG_STACK_MAX).optional(),
  note: z.string().max(BUG_NOTE_MAX).optional(),
  floor: FieldSchema.optional(),
  panel: FieldSchema.optional(),
  view: z.enum(["hotel", "list"]).optional(),
  clientTime: z.number().int().nonnegative().optional(),
});
export type BugReportFields = z.infer<typeof BugReportFieldsSchema>;

// ---- fingerprint ----

/** First line of a message with what changes between two occurrences of one error taken out. */
export function normalizeBugMessage(message: string): string {
  const first = message.split(/\r?\n/)[0] ?? "";
  return first
    .replace(/(https?:\/\/[^\s?#)'"]*)[?#][^\s)'"]*/g, "$1")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<time>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    // A hex run needs a digit and a letter: a plain number is a number, whatever its length.
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "<id>")
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function fileBase(loc: string): string {
  const noQuery = loc.replace(/[?#].*$/, "").replace(/(?::\d+){1,2}$/, "");
  const base = noQuery.slice(Math.max(noQuery.lastIndexOf("/"), noQuery.lastIndexOf("\\")) + 1);
  // The 8 character hash Vite adds to a built file: `index-AbC123de.js` is `index.js`.
  return base.replace(/-(?=[A-Za-z0-9_-]*[0-9A-Z])[A-Za-z0-9_-]{8}(?=\.[a-z]+$)/, "");
}

/** The first stack line that is a frame (V8 or Firefox/Safari style), as `function@file` with no line or column. */
export function firstBugFrame(stack: string | undefined): string {
  if (!stack) return "";
  for (const raw of stack.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("at ")) {
      const rest = line.slice(3).replace(/^async\s+/, "");
      let fn = "";
      let loc = rest;
      const open = rest.endsWith(")") ? rest.indexOf(" (") : -1;
      if (open >= 0) {
        fn = rest.slice(0, open);
        loc = rest.slice(open + 2, -1);
      }
      return `${fn}@${fileBase(loc)}`.slice(0, 200);
    }
    const at = line.indexOf("@");
    if (at >= 0 && !/^[A-Za-z]*Error\b/.test(line) && /[/\\]|:\d+/.test(line.slice(at + 1))) {
      return `${line.slice(0, at)}@${fileBase(line.slice(at + 1))}`.slice(0, 200);
    }
  }
  return "";
}

function fnv32(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const hex8 = (n: number): string => n.toString(16).padStart(8, "0");

/** The group an error belongs to: 16 hex characters of its component, process, kind, normalised message and first frame. */
export function bugFingerprint(input: Pick<BugInput, "component" | "process" | "kind" | "message" | "stack">): string {
  const key = [input.component, input.process, input.kind, normalizeBugMessage(input.message), firstBugFrame(input.stack)].join("|");
  return hex8(fnv32(key, 0x811c9dc5)) + hex8(fnv32(key, 0x9747b28c));
}

// ---- the book ----

export interface BugRecordResult {
  group: BugGroup;
  created: boolean;
  /** The group was fixed and came back. */
  reopened: boolean;
  /** Sample ids that left the book (past the cap of 5, or in an evicted group): their screenshots can go. */
  dropped: string[];
}

export interface BugListFilter {
  component?: BugComponent;
  /** Default: every status. */
  status?: BugStatus;
  /** Case-insensitive text looked for in the message, kind, frame, where and the notes. */
  search?: string;
}

function contextOf(input: BugInput): BugContext {
  const out: BugContext = {};
  for (const key of BUG_CONTEXT_KEYS) {
    const v = input.context?.[key];
    if (v) out[key] = v;
  }
  return out;
}

const STATUS_RANK: Record<BugStatus, number> = { fixed: 0, ignored: 0, open: 1 };

/**
 * The groups, in memory. The only code that changes them, so the world-server and `pnpm bugs` agree.
 * The input is trusted to be clean (see `cleanBugInput`).
 */
export class BugBook {
  private readonly groups = new Map<string, BugGroup>();

  constructor(groups: readonly BugGroup[] = []) {
    for (const g of groups) this.groups.set(g.id, g);
  }

  get size(): number {
    return this.groups.size;
  }

  get(id: string): BugGroup | undefined {
    return this.groups.get(id);
  }

  /** Every group, newest `lastSeen` first. */
  all(): BugGroup[] {
    return [...this.groups.values()].sort((a, b) => b.lastSeen - a.lastSeen || (a.id < b.id ? -1 : 1));
  }

  list(filter: BugListFilter = {}): BugGroup[] {
    const needle = filter.search?.trim().toLowerCase();
    return this.all().filter((g) => {
      if (filter.component && g.component !== filter.component) return false;
      if (filter.status && g.status !== filter.status) return false;
      if (!needle) return true;
      const hay = [g.message, g.kind, g.frame, g.process, ...Object.values(g.last), ...g.samples.map((s) => s.note ?? "")].join("\n").toLowerCase();
      return hay.includes(needle);
    });
  }

  openCount(): BugOpenCount {
    const out = { game: 0, code: 0 };
    for (const g of this.groups.values()) if (g.status === "open") out[g.component] += 1;
    return out;
  }

  record(input: BugInput, now: number, sampleId: string, shot = false): BugRecordResult {
    const id = bugFingerprint(input);
    const context = contextOf(input);
    const sample: BugSample = {
      id: sampleId,
      at: now,
      message: input.message,
      ...(input.stack ? { stack: input.stack } : {}),
      ...(input.note ? { note: input.note } : {}),
      context,
      ...(input.clientTime === undefined ? {} : { clientTime: input.clientTime }),
      shot,
    };
    const dropped: string[] = [];
    const existing = this.groups.get(id);
    if (existing) {
      const reopened = existing.status === "fixed";
      const samples = [...existing.samples, sample];
      while (samples.length > BUG_SAMPLES_MAX) dropped.push(samples.shift()!.id);
      const group: BugGroup = {
        ...existing,
        status: reopened ? "open" : existing.status,
        count: existing.count + 1,
        lastSeen: now,
        reopened: existing.reopened + (reopened ? 1 : 0),
        last: context,
        samples,
      };
      this.groups.set(id, group);
      return { group, created: false, reopened, dropped };
    }
    const group: BugGroup = {
      id,
      component: input.component,
      process: input.process,
      kind: input.kind,
      message: (input.message.split(/\r?\n/)[0] ?? "").slice(0, BUG_LIST_MESSAGE_MAX) || input.kind,
      frame: firstBugFrame(input.stack),
      status: "open",
      count: 1,
      firstSeen: now,
      lastSeen: now,
      reopened: 0,
      last: context,
      samples: [sample],
    };
    this.groups.set(id, group);
    while (this.groups.size > BUG_GROUPS_MAX) {
      const victim = this.evictionCandidate(id);
      if (!victim) break;
      for (const s of victim.samples) dropped.push(s.id);
      this.groups.delete(victim.id);
    }
    return { group, created: true, reopened: false, dropped };
  }

  /** Oldest `lastSeen` among fixed and ignored groups first, then among the open ones. Never the group just made. */
  private evictionCandidate(except: string): BugGroup | undefined {
    let best: BugGroup | undefined;
    for (const g of this.groups.values()) {
      if (g.id === except) continue;
      if (!best) best = g;
      else {
        const r = STATUS_RANK[g.status] - STATUS_RANK[best.status];
        if (r < 0 || (r === 0 && (g.lastSeen < best.lastSeen || (g.lastSeen === best.lastSeen && g.id < best.id)))) best = g;
      }
    }
    return best;
  }

  /** Marks a group fixed, ignored or open again. Undefined when there is no such group. */
  setStatus(id: string, status: BugStatus): BugGroup | undefined {
    const g = this.groups.get(id);
    if (!g) return undefined;
    const next = g.status === status ? g : { ...g, status };
    this.groups.set(id, next);
    return next;
  }
}

// ---- Markdown ----

function utc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function fence(text: string): string[] {
  return ["```text", text.replaceAll("```", "'''"), "```"];
}

function where(g: BugGroup): string {
  const names: [keyof BugContext, string][] = [["floor", "floor"], ["panel", "panel"], ["view", "view"], ["task", "task"], ["step", "step"], ["session", "session"], ["spec", "spec"]];
  return names.flatMap(([key, label]) => (g.last[key] ? [`${label} \`${g.last[key]}\``] : [])).join(", ");
}

/** Groups as Markdown to paste into a chat. No screenshots; the texts were masked before they were stored. */
export function groupsToMarkdown(groups: readonly BugGroup[], title = "Bugs"): string {
  const out: string[] = [`# ${title} (${groups.length})`, ""];
  for (const g of groups) {
    out.push(`## [${g.component}/${g.process}] ${g.kind}: ${g.message}`, "");
    out.push(`- id \`${g.id}\`, ${g.status}, ${g.count} time${g.count === 1 ? "" : "s"}${g.reopened > 0 ? `, reopened ${g.reopened}` : ""}`);
    out.push(`- first seen ${utc(g.firstSeen)}, last seen ${utc(g.lastSeen)}`);
    const w = where(g);
    if (w) out.push(`- where: ${w}`);
    if (g.frame) out.push(`- first frame: \`${g.frame}\``);
    const sample = g.samples[g.samples.length - 1];
    if (sample?.note) out.push(`- note: ${sample.note.replace(/\s+/g, " ")}`);
    if (sample?.stack) out.push("", "Latest stack:", ...fence(sample.stack));
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
