import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MorningSummarySchema } from "@agentlife/shared";
import type { MorningSummary } from "@agentlife/shared";
import { z } from "zod";
import { noopLogger, type Logger } from "../log.ts";

/** The lobby mailbox lists this many nights; older summaries are dropped. */
export const MAX_SUMMARIES = 14;

const FileSchema = z.object({ version: z.literal(1), summaries: z.array(MorningSummarySchema).max(MAX_SUMMARIES) });

export interface SummaryStoreOptions {
  /** `data/night-summaries.json`. */
  file: string;
  now?: () => number;
  logger?: Logger;
}

/**
 * The morning summaries in `data/night-summaries.json` (requirement 4.1). Written like the night schedule: a temporary
 * file, then a rename; an unreadable file is moved aside and the list starts empty. One summary per night: writing the
 * same night again replaces it.
 */
export class SummaryStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly log: Logger;
  /** Oldest first. */
  private list: MorningSummary[] = [];

  constructor(opts: SummaryStoreOptions) {
    this.file = opts.file;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? noopLogger;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      this.list = FileSchema.parse(JSON.parse(readFileSync(this.file, "utf8"))).summaries;
    } catch (e) {
      const aside = `${this.file}.bad-${this.now()}`;
      this.log.error("morning summaries unreadable, moved aside", { file: aside, error: e instanceof Error ? e.message : String(e) });
      try {
        renameSync(this.file, aside);
      } catch {
        // The next save overwrites it; nothing better can be done here.
      }
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, summaries: this.list }, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }

  /** Newest first. */
  all(): MorningSummary[] {
    return [...this.list].reverse();
  }

  get(nightKey: string): MorningSummary | undefined {
    return this.list.find((s) => s.nightKey === nightKey);
  }

  /** Stores the summary of a night (replacing the one of the same night) and keeps the newest `MAX_SUMMARIES`. */
  put(summary: MorningSummary): void {
    this.list = this.list.filter((s) => s.nightKey !== summary.nightKey);
    this.list.push(summary);
    this.list.sort((a, b) => a.writtenAt - b.writtenAt);
    if (this.list.length > MAX_SUMMARIES) this.list.splice(0, this.list.length - MAX_SUMMARIES);
    this.save();
  }
}
