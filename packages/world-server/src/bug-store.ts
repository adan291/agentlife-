import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  BUG_DRAIN_MS,
  BUG_SAVE_DEBOUNCE_MS,
  BUG_SHOT_MAX_BYTES,
  BugBook,
  bugSummary,
  type BugContext,
  type BugGroup,
  type BugInput,
  type BugListFilter,
  type BugOpenCount,
  type BugRecordResult,
  type BugStatus,
  type BugSummary,
} from "@agentlife/shared";
import {
  bugFromError,
  bugFiles,
  cleanBugInput,
  loadBugFile,
  readInboxFile,
  serializeBugFile,
  writeTextAtomic,
  type BugFiles,
  type BugMaskOptions,
} from "@agentlife/shared/bugs-node";

export interface BugStoreOptions {
  /** Default: `data/bugs.jsonl` and its neighbours, or the names next to `AGENTLIFE_BUGS_FILE`. */
  files?: BugFiles;
  now?: () => number;
  onLog?: (message: string) => void;
  /** Milliseconds a change waits before the file is rewritten (changes within it are written once). 0 writes at once. */
  debounceMs?: number;
  /** Secrets and roots to mask (tests). */
  mask?: BugMaskOptions;
  random?: () => number;
}

export type BugChange = { kind: "new" | "repeat" | "reopened" | "status"; group: BugGroup };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True for bytes that are a PNG no bigger than the limit. */
export function isAcceptableScreenshot(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && bytes.length <= BUG_SHOT_MAX_BYTES && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * The Bug sack's keeper (spec bug-sack): the groups of `data/bugs.jsonl`, their screenshots and the inbox that other
 * processes append to. It is the only writer of those files. Every text is masked before it is kept (`cleanBugInput`),
 * whoever sent it. Nothing here throws at a caller that is reporting an error.
 */
export class BugStore {
  private readonly book: BugBook;
  private readonly files: BugFiles;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly debounceMs: number;
  private readonly mask: BugMaskOptions | undefined;
  private readonly random: () => number;
  private readonly listeners = new Set<(change: BugChange) => void>();
  private dirty = false;
  /** The inbox was read and applied, but the file that holds the groups could not be written yet: keep `.draining` until it is. */
  private pendingDrain = false;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setInterval> | undefined;
  private lastSaveError = "";

  constructor(opts: BugStoreOptions = {}) {
    this.files = opts.files ?? bugFiles();
    this.now = opts.now ?? Date.now;
    this.log = opts.onLog ?? (() => undefined);
    this.debounceMs = opts.debounceMs ?? BUG_SAVE_DEBOUNCE_MS;
    this.mask = opts.mask;
    this.random = opts.random ?? Math.random;
    this.book = new BugBook(loadBugFile(this.files.file, { now: this.now, onLog: this.log }));
  }

  /** Where the screenshot of a sample is (or would be). */
  screenshotPath(sampleId: string): string {
    return join(this.files.shots, `${sampleId}.png`);
  }

  list(filter: BugListFilter = {}): BugGroup[] {
    return this.book.list(filter);
  }

  summaries(filter: BugListFilter = {}): BugSummary[] {
    return this.book.list(filter).map(bugSummary);
  }

  get(id: string): BugGroup | undefined {
    return this.book.get(id);
  }

  openCount(): BugOpenCount {
    return this.book.openCount();
  }

  onChange(listener: (change: BugChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(change: BugChange): void {
    for (const l of this.listeners) {
      try {
        l(change);
      } catch {
        // A listener that fails must not stop the report.
      }
    }
  }

  private sampleId(at: number): string {
    return `b${at.toString(36)}${Math.floor(this.random() * 36 ** 4).toString(36).padStart(4, "0")}`;
  }

  /**
   * Keeps one report (masked, capped). A screenshot that is not a PNG or is too big is left out and the report is kept
   * without it. Returns the group.
   */
  record(input: BugInput, opts: { screenshot?: Uint8Array; at?: number } = {}): BugRecordResult {
    const at = opts.at ?? this.now();
    const clean = cleanBugInput(input, this.mask);
    const sampleId = this.sampleId(at);
    let shot = false;
    if (opts.screenshot && isAcceptableScreenshot(opts.screenshot)) {
      try {
        writeTextAtomic(this.screenshotPath(sampleId), opts.screenshot);
        shot = true;
      } catch (e) {
        this.log(`cannot write the screenshot of a bug: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const result = this.book.record(clean, at, sampleId, shot);
    for (const id of result.dropped) this.removeShot(id);
    this.markDirty();
    this.emit({ kind: result.created ? "new" : result.reopened ? "reopened" : "repeat", group: result.group });
    return result;
  }

  /** Records something thrown in the world-server. Never throws. */
  recordError(kind: string, error: unknown, context?: BugContext): void {
    try {
      this.record({ component: "code", process: "world-server", kind, ...bugFromError(error), ...(context ? { context } : {}) });
    } catch {
      // Reporting an error must never make things worse.
    }
  }

  /** Marks a group fixed, ignored or open again. Undefined when there is no such group. */
  setStatus(id: string, status: BugStatus): BugGroup | undefined {
    const before = this.book.get(id);
    const group = this.book.setStatus(id, status);
    if (group && before?.status !== status) {
      this.markDirty();
      this.emit({ kind: "status", group });
    }
    return group;
  }

  private removeShot(sampleId: string): void {
    try {
      rmSync(this.screenshotPath(sampleId), { force: true });
    } catch {
      // A screenshot that stays is only disk space.
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.debounceMs <= 0) {
      this.flush();
      return;
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, this.debounceMs);
    this.saveTimer.unref?.();
  }

  /** Writes the file now when something changed. True when nothing is left unwritten. A failed write stays dirty for the next try. */
  flush(): boolean {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.dirty) {
      try {
        writeTextAtomic(this.files.file, serializeBugFile(this.book.all(), this.now()));
        this.dirty = false;
        this.lastSaveError = "";
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        if (reason !== this.lastSaveError) this.log(`cannot write ${this.files.file}: ${reason}`);
        this.lastSaveError = reason;
        return false;
      }
    }
    if (this.pendingDrain) {
      try {
        rmSync(this.files.draining, { force: true });
        this.pendingDrain = false;
      } catch {
        // Next flush tries again; the groups are saved, so a repeat read only counts the same reports twice.
      }
    }
    return true;
  }

  /**
   * Takes in the reports that other processes appended to the inbox. A leftover `.draining` file (a crash in the middle) is
   * read first. Returns how many reports were recorded.
   */
  drainInbox(): number {
    if (this.dirty || this.pendingDrain) this.flush();
    if (this.pendingDrain) return 0;
    const { inbox, draining } = this.files;
    if (!existsSync(draining)) {
      if (!existsSync(inbox)) return 0;
      try {
        renameSync(inbox, draining);
      } catch {
        // A writer holds it for a moment (EBUSY on Windows): the next tick.
        return 0;
      }
    }
    let records: ReturnType<typeof readInboxFile>["records"];
    try {
      const read = readInboxFile(draining);
      records = read.records;
      if (read.bad > 0) this.log(`${read.bad} line(s) of the bug inbox were not valid and were skipped`);
    } catch (e) {
      this.log(`cannot read ${draining}: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
    for (const r of records) {
      try {
        this.record(r.report, { at: r.at });
      } catch (e) {
        this.log(`a report of the inbox was refused: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    this.pendingDrain = true;
    this.dirty = true;
    this.flush();
    return records.length;
  }

  /** Reads the inbox now and every `ms` after that. Returns a function that stops it. */
  startDraining(ms: number = BUG_DRAIN_MS): () => void {
    this.drainInbox();
    this.drainTimer = setInterval(() => {
      try {
        this.drainInbox();
      } catch (e) {
        this.log(`bug inbox: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, ms);
    this.drainTimer.unref?.();
    return () => this.stopDraining();
  }

  private stopDraining(): void {
    if (this.drainTimer) clearInterval(this.drainTimer);
    this.drainTimer = undefined;
  }

  /** Stops the timers and writes what is left. */
  close(): void {
    this.stopDraining();
    this.flush();
  }
}
