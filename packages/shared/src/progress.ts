import { z } from "zod";
import { GRANT_AMOUNT_MAX, GrantRefSchema, keepLast } from "./economy.ts";
import { StaffIdSchema } from "./room.ts";

/**
 * XP, levels and stats of the user and of the team members (team-progress). Everything here is pure: the world-server
 * keeps the file and decides which events are facts; this module says what a fact does to the file. See the spec's
 * design.md. A fact is counted once, by its key `<source>:<ref>`, the same idea as a grant in `economy.ts`.
 */

// ---- levels ----

export const LEVEL_MAX = 50;

/** Total XP needed to reach level `n`: 50·n·(n+1)/2. Level 1 needs 50, level 2 needs 150, level 3 needs 300. */
export function xpForLevel(n: number): number {
  return 25 * n * (n + 1);
}

/** XP never passes the threshold of the last level, so every number in the file is bounded. */
export const XP_MAX = xpForLevel(LEVEL_MAX);

/** The largest level whose threshold is at most `xp` (0 below the first threshold), capped at `LEVEL_MAX`. */
export function levelOf(xp: number): number {
  const x = Math.min(Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0)), XP_MAX);
  let n = Math.floor((Math.sqrt(1 + (4 * x) / 25) - 1) / 2);
  // The square root can be off by one at the edges: settle it with the exact thresholds.
  while (n < LEVEL_MAX && xpForLevel(n + 1) <= x) n++;
  while (n > 0 && xpForLevel(n) > x) n--;
  return n;
}

export const LevelViewSchema = z.object({
  xp: z.number().int().min(0).max(XP_MAX),
  level: z.number().int().min(0).max(LEVEL_MAX),
  /** XP at which the current level began. */
  base: z.number().int().min(0).max(XP_MAX),
  /** XP at which the next level begins. Absent at the last level. */
  next: z.number().int().min(1).max(XP_MAX).optional(),
});
export type LevelView = z.infer<typeof LevelViewSchema>;

export function levelView(xp: number): LevelView {
  const clamped = Math.min(Math.max(0, Math.floor(xp)), XP_MAX);
  const level = levelOf(clamped);
  return { xp: clamped, level, base: xpForLevel(level), ...(level < LEVEL_MAX ? { next: xpForLevel(level + 1) } : {}) };
}

// ---- facts ----

/** Facts that can pay XP (amounts in `config/progress.json`). */
export const XP_SOURCES = ["step_done", "job_passed", "review_passed", "branch_delivered", "plan_approved"] as const;
export type XpSource = (typeof XP_SOURCES)[number];

/** Every kind of fact. The ones that are not XP sources only move counters (stats, badges, quests). */
export const FACT_SOURCES = [...XP_SOURCES, "job_not_passed", "review_finished", "memory_accepted", "night_summary", "night_scheduled"] as const;
export const FactSourceSchema = z.enum(FACT_SOURCES);
export type FactSource = z.infer<typeof FactSourceSchema>;

/** Facts that happen to a team member (the others happen to the user only). */
export const MEMBER_SOURCES: readonly FactSource[] = ["step_done", "job_passed", "review_passed", "job_not_passed", "review_finished"];

/** Facts that count as a job that passed. */
const PASSES: readonly FactSource[] = ["job_passed", "review_passed"];
/** Facts that end a job (its stats). */
const JOB_ENDS: readonly FactSource[] = ["job_passed", "review_passed", "job_not_passed"];

export const MEMBERS_MAX = 300;
/** Keys of facts already counted, newest last. A job makes about seven; the gateway replays 50 jobs after a restart. */
export const PROGRESS_KEYS_MAX = 4000;
export const COUNT_MAX = 1_000_000;
/** A step that took longer than this is not timed (a clock that jumped, a job that was left waiting). */
export const STEP_MS_MAX = 24 * 60 * 60 * 1000;
const STEP_MS_TOTAL_MAX = 10_000_000_000;

const XpAmountSchema = z.number().int().min(0).max(1000);
const XpEntrySchema = z
  .object({ member: XpAmountSchema.optional(), user: XpAmountSchema.optional() })
  .strict()
  .refine((e) => (e.member ?? 0) + (e.user ?? 0) > 0, "an XP source pays someone");

/** `config/progress.json`. */
export const ProgressConfigSchema = z.object({
  version: z.literal(1),
  xp: z
    .object({
      step_done: XpEntrySchema,
      job_passed: XpEntrySchema,
      review_passed: XpEntrySchema,
      branch_delivered: XpEntrySchema,
      plan_approved: XpEntrySchema,
    })
    .strict(),
});
export type ProgressConfig = z.infer<typeof ProgressConfigSchema>;

export interface ProgressFact {
  source: FactSource;
  /** What it happened to: a task id, an approval id, a night key. No colon, so `<source>:<ref>` is unambiguous. */
  ref: string;
  /** Epoch ms of the event. */
  ts: number;
  /** `step_done`: how long the step took, when known. */
  stepMs?: number;
}

export function factKey(source: FactSource, ref: string): string {
  return `${source}:${ref}`;
}

// ---- the file (data/progress.json) ----

export const MEMBER_KEY_RE = /^[a-z0-9][a-z0-9-]{0,59}\/[a-z0-9][a-z0-9-]{0,29}$/;
export const MemberKeySchema = z.string().regex(MEMBER_KEY_RE);

export function memberKey(projectId: string, memberId: string): string {
  return `${projectId}/${memberId}`;
}

/** The user, or one team member. */
export const EntitySchema = z.object({
  xp: z.number().int().min(0).max(XP_MAX),
  /** How many facts of each source (and the derived counters `late_job` and `best_streak`) happened to it. */
  counts: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.number().int().min(0).max(COUNT_MAX)),
  /** Sum of the time of the steps that finished, in ms. */
  stepMs: z.number().int().min(0).max(STEP_MS_TOTAL_MAX),
  /** Jobs that passed in a row. */
  streak: z.number().int().min(0).max(COUNT_MAX),
  /** Badge id to the epoch ms it was earned (team-progress task 2). */
  badges: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.number().int().nonnegative()).default({}),
});
export type Entity = z.infer<typeof EntitySchema>;

export function newEntity(): Entity {
  return { xp: 0, counts: {}, stepMs: 0, streak: 0, badges: {} };
}

export const QUESTS_PER_DAY = 3;
/** Payouts that wait to be paid (a quest is paid at once; more than this means the wallet cannot be written for days). */
export const PAYOUTS_MAX = 30;
export const QuestIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** Today's quests, their progress and which are done (team-progress task 2). */
export const QuestStateSchema = z.object({
  /** The local day the numbers belong to. Empty before the first fact. */
  day: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  progress: z.record(QuestIdSchema, z.number().int().min(0).max(100_000)),
  done: z.array(QuestIdSchema).max(QUESTS_PER_DAY),
});
export type QuestState = z.infer<typeof QuestStateSchema>;

/** Ecto a completed quest has earned and that is not in the wallet yet. */
export const PayoutSchema = z.object({ ref: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), reward: z.number().int().min(1).max(GRANT_AMOUNT_MAX) });
export type Payout = z.infer<typeof PayoutSchema>;

export function newQuestState(): QuestState {
  return { day: "", progress: {}, done: [] };
}

export const ProgressSchema = z.object({
  version: z.literal(1),
  /** Epoch ms when the file was created: older events count for nothing. */
  since: z.number().int().nonnegative(),
  user: EntitySchema,
  members: z.record(MemberKeySchema, EntitySchema).refine((m) => Object.keys(m).length <= MEMBERS_MAX, "too many members"),
  counted: z.array(z.string().min(3).max(140)).max(PROGRESS_KEYS_MAX),
  /** Daily quests and the payouts they wait for. A file written before task 2 has neither. */
  quests: QuestStateSchema.default({ day: "", progress: {}, done: [] }),
  payouts: z.array(PayoutSchema).max(PAYOUTS_MAX).default([]),
});
export type Progress = z.infer<typeof ProgressSchema>;

export function newProgress(since: number): Progress {
  return { version: 1, since, user: newEntity(), members: {}, counted: [], quests: newQuestState(), payouts: [] };
}

export type FactSkip = "counted" | "before_start" | "bad_ref";

/** A level that went up: the user, or the member with that key. */
export interface LevelUp {
  who: "user" | { member: string };
  from: number;
  to: number;
}

export interface FactResult {
  progress: Progress;
  /** Present when nothing was counted. */
  skipped?: FactSkip;
  levelUps: LevelUp[];
}

const count = (e: Entity, name: string): number => e.counts[name] ?? 0;
const capCount = (n: number): number => Math.min(n, COUNT_MAX);

/** What a fact does to one entity: its counter, its XP, its streak, the derived counters, its time in steps. */
function bump(e: Entity, fact: ProgressFact, xp: number, forMember: boolean): Entity {
  const counts = { ...e.counts, [fact.source]: capCount(count(e, fact.source) + 1) };
  let streak = e.streak;
  if (PASSES.includes(fact.source)) streak = capCount(streak + 1);
  else if (fact.source === "job_not_passed") streak = 0;
  if (streak > count({ ...e, counts }, "best_streak")) counts["best_streak"] = streak;
  // The Night owl: a job that passed in the small hours, local time.
  if (fact.source === "job_passed" && new Date(fact.ts).getHours() < 5) counts["late_job"] = capCount(count(e, "late_job") + 1);
  const timed = forMember && fact.source === "step_done" && fact.stepMs !== undefined && fact.stepMs >= 0 && fact.stepMs <= STEP_MS_MAX;
  return {
    ...e,
    xp: Math.min(XP_MAX, e.xp + xp),
    counts,
    stepMs: timed ? Math.min(STEP_MS_TOTAL_MAX, e.stepMs + Math.round(fact.stepMs ?? 0)) : e.stepMs,
    streak,
  };
}

/**
 * Counts a fact once. `members` are the keys of the team members it happened to (already worked out by the caller:
 * the one who finished the step, or the ones who did the job). Nothing happens when the key was counted before, when
 * the event is older than the file, or when the ref is not valid. The user is always an entity of the fact; a member
 * is one only for the sources in `MEMBER_SOURCES`.
 */
export function applyFact(progress: Progress, fact: ProgressFact, members: readonly string[], config: ProgressConfig): FactResult {
  if (!GrantRefSchema.safeParse(fact.ref).success) return { progress, skipped: "bad_ref", levelUps: [] };
  const key = factKey(fact.source, fact.ref);
  if (progress.counted.includes(key)) return { progress, skipped: "counted", levelUps: [] };
  if (fact.ts < progress.since) return { progress, skipped: "before_start", levelUps: [] };
  const pay = (XP_SOURCES as readonly string[]).includes(fact.source) ? config.xp[fact.source as XpSource] : undefined;
  const levelUps: LevelUp[] = [];
  const user = bump(progress.user, fact, pay?.user ?? 0, false);
  if (levelOf(user.xp) > levelOf(progress.user.xp)) levelUps.push({ who: "user", from: levelOf(progress.user.xp), to: levelOf(user.xp) });
  let next: Record<string, Entity> = progress.members;
  if (MEMBER_SOURCES.includes(fact.source)) {
    next = { ...progress.members };
    for (const m of new Set(members)) {
      if (!MEMBER_KEY_RE.test(m)) continue; // a key the file would refuse to read back
      const before = next[m];
      if (!before && Object.keys(next).length >= MEMBERS_MAX) continue;
      const after = bump(before ?? newEntity(), fact, pay?.member ?? 0, true);
      next[m] = after;
      const from = levelOf(before?.xp ?? 0);
      if (levelOf(after.xp) > from) levelUps.push({ who: { member: m }, from, to: levelOf(after.xp) });
    }
  }
  return {
    progress: { ...progress, user, members: next, counted: keepLast([...progress.counted, key], PROGRESS_KEYS_MAX) },
    levelUps,
  };
}

// ---- stats ----

export interface EntityStats {
  /** Jobs that ended (passed or not). */
  jobs: number;
  passed: number;
  /** Steps that finished. */
  steps: number;
  /** `passed / jobs`, 0 to 1. Absent before the first job. */
  passRate?: number;
  /** Average time of a step in ms. Absent when no step was timed. */
  avgStepMs?: number;
}

export function statsOf(e: Entity): EntityStats {
  const jobs = JOB_ENDS.reduce((sum, s) => sum + count(e, s), 0);
  const passed = PASSES.reduce((sum, s) => sum + count(e, s), 0);
  const steps = count(e, "step_done");
  return {
    jobs,
    passed,
    steps,
    ...(jobs > 0 ? { passRate: passed / jobs } : {}),
    ...(steps > 0 && e.stepMs > 0 ? { avgStepMs: Math.round(e.stepMs / steps) } : {}),
  };
}

// ---- what the client gets ----

export const EntityViewSchema = LevelViewSchema.extend({
  jobs: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1).optional(),
  avgStepMs: z.number().int().nonnegative().optional(),
  /** Badges earned, oldest first, with the epoch ms they were earned (team-progress task 2). */
  badges: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), at: z.number().int().nonnegative() })).max(60).default([]),
});
export type EntityView = z.infer<typeof EntityViewSchema>;

export const MemberViewSchema = EntityViewSchema.extend({
  projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  memberId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,29}$/),
});
export type MemberView = z.infer<typeof MemberViewSchema>;

export function entityView(e: Entity): EntityView {
  const badges = Object.entries(e.badges)
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return { ...levelView(e.xp), ...statsOf(e), badges };
}

export function memberViews(p: Progress): MemberView[] {
  return Object.entries(p.members).map(([key, e]) => {
    const i = key.indexOf("/");
    return { projectId: key.slice(0, i), memberId: key.slice(i + 1), ...entityView(e) };
  });
}

/** A level-up for the client: the effect over the ghost (`slot`, when it stands on the user's floor) and the toast. */
export const LevelUpMsgSchema = z.object({
  type: z.literal("level_up"),
  who: z.enum(["user", "member"]),
  name: z.string().min(1).max(60),
  level: z.number().int().min(1).max(LEVEL_MAX),
  slot: StaffIdSchema.optional(),
});

/** "Lv 3". */
export function levelText(level: number): string {
  return `Lv ${level}`;
}
