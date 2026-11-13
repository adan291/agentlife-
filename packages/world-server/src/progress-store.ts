import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgressConfigSchema, ProgressSchema, applyFact, newProgress, progressView } from "@agentlife/shared";
import type { LevelUp, Progress, ProgressConfig, ProgressFact, ProgressView } from "@agentlife/shared";
import { readJsonFile, writeJsonFile } from "./json-file.ts";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(here, "..", "config");
const DATA_DIR = join(here, "..", "..", "..", "data");

/** `data/progress.json` at the repository root, or `AGENTLIFE_PROGRESS_FILE`. */
export function defaultProgressFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_PROGRESS_FILE"] ?? join(DATA_DIR, "progress.json");
}

/** Reads and checks `config/progress.json`. Throws with the reason when it is wrong. */
export function loadProgressConfig(file: string = join(CONFIG_DIR, "progress.json")): ProgressConfig {
  return ProgressConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export interface ProgressStoreOptions {
  file: string;
  config: ProgressConfig;
  now?: () => number;
  onLog?: (message: string) => void;
}

/** What `record` did. `changed` is false when nothing was counted (already counted, too old, or the file could not be written). */
export interface RecordResult {
  changed: boolean;
  levelUps: LevelUp[];
}

/**
 * XP, levels and stats of the user and the team members, in `data/progress.json`. The rules are the shared ones
 * (`applyFact`); this class owns the file. A file that has none yet is created and written at once, so its `since` (the
 * moment older events stop counting) survives a restart even before the first fact.
 */
export class ProgressStore {
  private state: Progress;
  private readonly file: string;
  private readonly config: ProgressConfig;
  private readonly log: (message: string) => void;

  constructor(opts: ProgressStoreOptions) {
    this.file = opts.file;
    this.config = opts.config;
    this.log = opts.onLog ?? (() => undefined);
    const now = opts.now ?? Date.now;
    const loaded = readJsonFile(this.file, ProgressSchema, { now, onLog: this.log });
    this.state = loaded ?? newProgress(now());
    if (!loaded) this.save(this.state);
  }

  /** Epoch ms from which events count. */
  get since(): number {
    return this.state.since;
  }

  /** The whole file, read only. */
  get snapshot(): Readonly<Progress> {
    return this.state;
  }

  view(): ProgressView {
    return progressView(this.state);
  }

  private save(next: Progress): boolean {
    try {
      writeJsonFile(this.file, next);
      return true;
    } catch (e) {
      this.log(`cannot write ${this.file}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * Counts a fact once for the user and for the members with these keys. When the file cannot be written nothing is
   * counted (the change is undone in memory), so a later replay tries again.
   */
  record(fact: ProgressFact, members: readonly string[]): RecordResult {
    const result = applyFact(this.state, fact, members, this.config);
    if (result.progress === this.state) return { changed: false, levelUps: [] };
    if (!this.save(result.progress)) return { changed: false, levelUps: [] };
    this.state = result.progress;
    return { changed: true, levelUps: result.levelUps };
  }
}
