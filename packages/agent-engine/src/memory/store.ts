import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  MEMORY_ENTRIES_MAX,
  MEMORY_PENDING_MAX,
  MEMORY_PROPOSALS_MAX,
  MemoryEntrySchema,
  MemoryKindSchema,
  MemoryProposalSchema,
  type MemoryDraft,
  type MemoryEntry,
  type MemoryKind,
  type MemoryProposal,
} from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { noopLogger, type Logger } from "../log.ts";
import { checkMemoryText, MemoryRejectedError, rejection } from "./safety.ts";

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;

export interface MemoryStoreOptions {
  /** `data/memory`. */
  dir: string;
  logger?: Logger;
  now?: () => number;
  /** Ids are `mem-<suffix>` and `prop-<suffix>`. Tests pass a counter. */
  newSuffix?: () => string;
  /** Exact secret values to refuse in a text, besides the key formats. Default: the well-known variables of this machine. */
  secrets?: readonly string[];
}

const ProposalsFileSchema = z.array(MemoryProposalSchema);
const SettingsFileSchema = z.record(z.string(), z.object({ autoRemember: z.boolean() }));

const sameText = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * The Library on disk (project-memory requirement 1): `<dir>/<projectId>.jsonl`, one entry per line, in the order they
 * were added. Next to it, `<projectId>.proposals.json` holds what finished jobs suggested and the user has not decided
 * on, and `_settings.json` the per-project "auto-remember" switch. Ids of projects are checked here, so a name can never
 * leave the folder.
 *
 * Every text goes through `checkMemoryText` before it is stored, on the way in and when it is edited. A line of the file
 * that cannot be read is skipped; before the file is rewritten the original is copied to `<file>.bad-<time>`, so a
 * damaged file never loses data silently. All calls are synchronous: the engine is a single process.
 */
export class MemoryStore {
  private readonly dir: string;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly newSuffix: () => string;
  private readonly secrets: readonly string[] | undefined;

  constructor(opts: MemoryStoreOptions) {
    this.dir = opts.dir;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? noopLogger;
    this.newSuffix = opts.newSuffix ?? (() => randomUUID().replace(/-/g, "").slice(0, 10));
    this.secrets = opts.secrets;
  }

  // ---- files ----

  private file(projectId: string, ext: "jsonl" | "proposals.json"): string {
    if (!PROJECT_ID_RE.test(projectId)) throw new Error("invalid project id");
    return path.join(this.dir, `${projectId}.${ext}`);
  }

  private settingsFile(): string {
    return path.join(this.dir, "_settings.json");
  }

  private writeAtomic(file: string, text: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, file);
  }

  /** Entries in file order (oldest first) and whether some line could not be read. */
  private readEntries(projectId: string): { entries: MemoryEntry[]; damaged: boolean } {
    const file = this.file(projectId, "jsonl");
    if (!existsSync(file)) return { entries: [], damaged: false };
    const entries: MemoryEntry[] = [];
    let damaged = false;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (line.trim() === "") continue;
      try {
        const parsed = MemoryEntrySchema.safeParse(JSON.parse(line));
        if (parsed.success) entries.push(parsed.data);
        else damaged = true;
      } catch {
        damaged = true;
      }
    }
    if (damaged) this.log.warn("memory file has lines that cannot be read", { projectId });
    return { entries, damaged };
  }

  private rewrite(projectId: string, entries: readonly MemoryEntry[], damaged: boolean): void {
    const file = this.file(projectId, "jsonl");
    if (damaged && existsSync(file)) copyFileSync(file, `${file}.bad-${this.now()}`);
    this.writeAtomic(file, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
  }

  // ---- entries ----

  /** The entries of a project, newest first. */
  list(projectId: string): MemoryEntry[] {
    const { entries } = this.readEntries(projectId);
    // Stable: entries added in the same millisecond keep "later is newer".
    return entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.createdAt - a.e.createdAt || b.i - a.i).map((x) => x.e);
  }

  get(projectId: string, id: string): MemoryEntry | undefined {
    return this.readEntries(projectId).entries.find((e) => e.id === id);
  }

  /** Stores a new entry. Throws `MemoryRejectedError` for a text that is empty, too long, unsafe, repeated, or when the Library is full. */
  add(projectId: string, input: { kind: MemoryKind; text: string; sourceTaskId: string }): MemoryEntry {
    const kind = MemoryKindSchema.parse(input.kind);
    const text = checkMemoryText(input.text, this.secrets);
    const { entries, damaged } = this.readEntries(projectId);
    if (entries.some((e) => sameText(e.text, text))) throw rejection("duplicate");
    if (entries.length >= MEMORY_ENTRIES_MAX) throw rejection("full");
    const entry = MemoryEntrySchema.parse({
      id: `mem-${this.newSuffix()}`,
      kind,
      text,
      sourceTaskId: input.sourceTaskId,
      createdAt: this.now(),
    });
    if (damaged) {
      this.rewrite(projectId, [...entries, entry], true);
    } else {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file(projectId, "jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    }
    return entry;
  }

  /** Changes the text and/or the kind of an entry. The date and the source job stay. */
  update(projectId: string, id: string, patch: { kind?: MemoryKind; text?: string }): MemoryEntry {
    const { entries, damaged } = this.readEntries(projectId);
    const i = entries.findIndex((e) => e.id === id);
    const old = entries[i];
    if (i < 0 || !old) throw new NotFoundError("unknown entry");
    const text = patch.text === undefined ? old.text : checkMemoryText(patch.text, this.secrets);
    if (entries.some((e) => e.id !== id && sameText(e.text, text))) throw rejection("duplicate");
    const next: MemoryEntry = MemoryEntrySchema.parse({ ...old, text, kind: patch.kind === undefined ? old.kind : MemoryKindSchema.parse(patch.kind) });
    const out = entries.slice();
    out[i] = next;
    this.rewrite(projectId, out, damaged);
    return next;
  }

  remove(projectId: string, id: string): void {
    const { entries, damaged } = this.readEntries(projectId);
    const rest = entries.filter((e) => e.id !== id);
    if (rest.length === entries.length) throw new NotFoundError("unknown entry");
    this.rewrite(projectId, rest, damaged);
  }

  /** Deletes everything the Library holds for a project (the project was removed from the hotel). */
  removeProject(projectId: string): void {
    for (const f of [this.file(projectId, "jsonl"), this.file(projectId, "proposals.json")]) rmSync(f, { force: true });
    const settings = this.readSettings();
    if (Object.hasOwn(settings, projectId)) {
      const { [projectId]: _gone, ...rest } = settings;
      this.writeAtomic(this.settingsFile(), `${JSON.stringify(rest, null, 2)}\n`);
    }
  }

  // ---- proposals ----

  private readProposals(projectId: string): MemoryProposal[] {
    const file = this.file(projectId, "proposals.json");
    if (!existsSync(file)) return [];
    try {
      return ProposalsFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch (e) {
      const aside = `${file}.bad-${this.now()}`;
      this.log.error("memory proposals unreadable, moved aside", { projectId, file: aside, error: e instanceof Error ? e.message : String(e) });
      try {
        renameSync(file, aside);
      } catch {
        // The next save overwrites it; proposals are only suggestions.
      }
      return [];
    }
  }

  private writeProposals(projectId: string, proposals: readonly MemoryProposal[]): void {
    const file = this.file(projectId, "proposals.json");
    if (proposals.length === 0) rmSync(file, { force: true });
    else this.writeAtomic(file, `${JSON.stringify(proposals, null, 2)}\n`);
  }

  /** Proposals waiting for the user, newest first. */
  proposals(projectId: string, taskId?: string): MemoryProposal[] {
    return this.readProposals(projectId)
      .filter((p) => taskId === undefined || p.sourceTaskId === taskId)
      .reverse();
  }

  /**
   * Keeps what a job suggested: at most `MEMORY_PROPOSALS_MAX`, each one checked like a stored entry, without repeats of
   * what the Library holds or of another proposal. A draft that fails the check is dropped (and counted in the log, never
   * quoted). A second call for the same job replaces its earlier proposals.
   */
  propose(projectId: string, taskId: string, drafts: readonly MemoryDraft[]): MemoryProposal[] {
    const stored = this.readEntries(projectId).entries;
    const others = this.readProposals(projectId).filter((p) => p.sourceTaskId !== taskId);
    const kept: MemoryProposal[] = [];
    let dropped = 0;
    for (const d of drafts) {
      if (kept.length >= MEMORY_PROPOSALS_MAX) {
        dropped += 1;
        continue;
      }
      try {
        const text = checkMemoryText(d.text, this.secrets);
        const taken = [...stored, ...others, ...kept];
        if (taken.some((e) => sameText(e.text, text))) throw rejection("duplicate");
        kept.push(MemoryProposalSchema.parse({ id: `prop-${this.newSuffix()}`, kind: d.kind, text, sourceTaskId: taskId, createdAt: this.now() }));
      } catch (e) {
        if (!(e instanceof MemoryRejectedError)) throw e;
        dropped += 1;
      }
    }
    if (dropped > 0) this.log.info("memory proposals dropped", { projectId, taskId, dropped });
    this.writeProposals(projectId, [...others, ...kept].slice(-MEMORY_PENDING_MAX));
    return kept.slice().reverse();
  }

  /** The user accepts a proposal: it becomes an entry (checked again) and stops being pending. The user may have edited the text. */
  accept(projectId: string, proposalId: string, edit?: { kind?: MemoryKind; text?: string }): MemoryEntry {
    const all = this.readProposals(projectId);
    const p = all.find((x) => x.id === proposalId);
    if (!p) throw new NotFoundError("unknown proposal");
    const entry = this.add(projectId, {
      kind: edit?.kind ?? p.kind,
      text: edit?.text ?? p.text,
      sourceTaskId: p.sourceTaskId,
    });
    this.writeProposals(projectId, all.filter((x) => x.id !== proposalId));
    return entry;
  }

  /** The user says no to a proposal. */
  dismiss(projectId: string, proposalId: string): void {
    const all = this.readProposals(projectId);
    const rest = all.filter((x) => x.id !== proposalId);
    if (rest.length === all.length) throw new NotFoundError("unknown proposal");
    this.writeProposals(projectId, rest);
  }

  // ---- settings ----

  private readSettings(): z.infer<typeof SettingsFileSchema> {
    const file = this.settingsFile();
    if (!existsSync(file)) return {};
    try {
      return SettingsFileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch (e) {
      const aside = `${file}.bad-${this.now()}`;
      this.log.error("memory settings unreadable, moved aside", { file: aside, error: e instanceof Error ? e.message : String(e) });
      try {
        renameSync(file, aside);
      } catch {
        // Nothing better to do; the switch starts off.
      }
      return {};
    }
  }

  /** True when proposals of this project are stored without asking. Off unless the user switched it on. */
  autoRemember(projectId: string): boolean {
    if (!PROJECT_ID_RE.test(projectId)) return false;
    const s = this.readSettings();
    return Object.hasOwn(s, projectId) && s[projectId]?.autoRemember === true;
  }

  setAutoRemember(projectId: string, on: boolean): void {
    this.file(projectId, "jsonl"); // checks the id
    this.writeAtomic(this.settingsFile(), `${JSON.stringify({ ...this.readSettings(), [projectId]: { autoRemember: on } }, null, 2)}\n`);
  }
}
