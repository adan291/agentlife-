import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BadgesFileSchema,
  ProgressConfigSchema,
  ProgressSchema,
  QuestsFileSchema,
  applyFactWithRules,
  checkBadges,
  checkQuests,
  localDay,
  newProgress,
  progressView,
  settlePayout,
} from "@agentlife/shared";
import type { BadgeDef, EarnedBadge, LevelUp, Payout, Progress, ProgressConfig, ProgressFact, ProgressView, QuestDef, QuestDone } from "@agentlife/shared";
import { readJsonFile, writeJsonFile } from "./json-file.ts";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(here, "..", "config");
const DATA_DIR = join(here, "..", "..", "..", "data");

/** `data/progress.json` at the repository root, or `AGENTLIFE_PROGRESS_FILE`. */
export function defaultProgressFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_PROGRESS_FILE"] ?? join(DATA_DIR, "progress.json");
}

/** `config/quests.json`, or `AGENTLIFE_QUESTS_FILE` (tests and Playwright use a pool they can finish with one scripted job). */
export function defaultQuestsFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_QUESTS_FILE"] ?? join(CONFIG_DIR, "quests.json");
}

/** Reads and checks `config/progress.json`. Throws with the reason when it is wrong. */
export function loadProgressConfig(file: string = join(CONFIG_DIR, "progress.json")): ProgressConfig {
  return ProgressConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Reads and checks `config/badges.json`. Throws with every problem when it is wrong. */
export function loadBadges(file: string = join(CONFIG_DIR, "badges.json")): BadgeDef[] {
  const badges = BadgesFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).badges;
  const problems = checkBadges(badges);
  if (problems.length > 0) throw new Error(`${file}:\n  ${problems.join("\n  ")}`);
  return badges;
}

/** Reads and checks the quest pool. Throws with every problem when it is wrong. */
export function loadQuests(file: string = defaultQuestsFile()): QuestDef[] {
  const quests = QuestsFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).quests;
  const problems = checkQuests(quests);
  if (problems.length > 0) throw new Error(`${file}:\n  ${problems.join("\n  ")}`);
  return quests;
}

export interface ProgressStoreOptions {
  file: string;
  config: ProgressConfig;
  /** Every badge. Default: none (task 1 tests). */
  badges?: readonly BadgeDef[];
  /** The pool the daily quests come from. Default: none, so there are no quests. */
  quests?: readonly QuestDef[];
  now?: () => number;
  onLog?: (message: string) => void;
}

/** What `record` did. `changed` is false when nothing was counted (already counted, too old, or the file could not be written). */
export interface RecordResult {
  changed: boolean;
  levelUps: LevelUp[];
  badges: EarnedBadge[];
  questsDone: QuestDone[];
}

const NOTHING: RecordResult = { changed: false, levelUps: [], badges: [], questsDone: [] };

/**
 * XP, levels, stats, badges and daily quests of the user and the team members, in `data/progress.json`. The rules are
 * the shared ones (`applyFactWithRules`); this class owns the file. A file that has none yet is created and written at
 * once, so its `since` (the moment older events stop counting) survives a restart even before the first fact.
 */
export class ProgressStore {
  private state: Progress;
  private readonly file: string;
  private readonly config: ProgressConfig;
  private readonly badges: readonly BadgeDef[];
  private readonly quests: readonly QuestDef[];
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(opts: ProgressStoreOptions) {
    this.file = opts.file;
    this.config = opts.config;
    this.badges = opts.badges ?? [];
    this.quests = opts.quests ?? [];
    this.now = opts.now ?? Date.now;
    this.log = opts.onLog ?? (() => undefined);
    const loaded = readJsonFile(this.file, ProgressSchema, { now: this.now, onLog: this.log });
    this.state = loaded ?? newProgress(this.now());
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

  private rules() {
    return { badges: this.badges, quests: this.quests, today: localDay(this.now()) };
  }

  view(): ProgressView {
    return progressView(this.state, this.rules());
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
   * Counts a fact once for the user and for the members with these keys, grants the badges it earned and moves today's
   * quests. When the file cannot be written nothing is counted (the change is undone in memory), so a later replay
   * tries again.
   */
  record(fact: ProgressFact, members: readonly string[]): RecordResult {
    const result = applyFactWithRules(this.state, fact, members, this.config, this.rules());
    if (result.progress === this.state) return NOTHING;
    if (!this.save(result.progress)) return NOTHING;
    this.state = result.progress;
    return { changed: true, levelUps: result.levelUps, badges: result.badges, questsDone: result.questsDone };
  }

  /** Ecto that completed quests have earned and the wallet does not have yet. */
  payouts(): readonly Payout[] {
    return this.state.payouts;
  }

  /** The payout is in the wallet. Returns false when it was not there or the file could not be written (it stays and is tried again). */
  settle(ref: string): boolean {
    const next = settlePayout(this.state, ref);
    if (next === this.state) return false;
    if (!this.save(next)) return false;
    this.state = next;
    return true;
  }
}
