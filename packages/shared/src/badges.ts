import { z } from "zod";
import { GRANT_AMOUNT_MAX } from "./economy.ts";
import { FACT_SOURCES, MEMBER_SOURCES, QUESTS_PER_DAY, QuestIdSchema, levelOf } from "./progress.ts";
import type { Entity } from "./progress.ts";

/**
 * Badges and daily quests (team-progress task 2). Pure rules over the counters of `progress.ts`; the world-server owns
 * the files and the payout. See the spec's design.md.
 */

// ---- badges (config/badges.json) ----

/** The pictures a badge can have. Each is drawn in code by the client (`ui/badge-icons.ts`); there are no image files. */
export const BADGE_SHAPES = ["star", "moon", "book", "branch", "check", "flame", "envelope", "bolt", "crown", "ghost", "clock", "medal"] as const;
export const BadgeShapeSchema = z.enum(BADGE_SHAPES);
export type BadgeShape = z.infer<typeof BadgeShapeSchema>;

export const BADGE_SCOPES = ["user", "member"] as const;
export type BadgeScope = (typeof BADGE_SCOPES)[number];

/** Counters beyond the fact sources: `late_job` (a job passed in the small hours), `best_streak` and `level` (derived from XP). */
const DERIVED_COUNTERS = ["late_job", "best_streak", "level"] as const;
/** What a badge of the user can count. */
export const USER_COUNTERS: readonly string[] = [...FACT_SOURCES, ...DERIVED_COUNTERS];
/** What a badge of a team member can count: the facts that happen to members. */
export const MEMBER_COUNTERS: readonly string[] = [...MEMBER_SOURCES, ...DERIVED_COUNTERS];
const COUNTERS = [...FACT_SOURCES, ...DERIVED_COUNTERS] as const;

export const BADGE_MIN = 12;
export const BADGES_MAX = 60;
export const BADGE_AT_LEAST_MAX = 100_000;

export const BadgeIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const BadgeDefSchema = z
  .object({
    id: BadgeIdSchema,
    name: z.string().min(1).max(30),
    description: z.string().min(1).max(120),
    scope: z.enum(BADGE_SCOPES),
    rule: z.object({ counter: z.enum(COUNTERS), atLeast: z.number().int().min(1).max(BADGE_AT_LEAST_MAX) }).strict(),
    icon: z.object({ shape: BadgeShapeSchema, colour: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict(),
  })
  .strict();
export type BadgeDef = z.infer<typeof BadgeDefSchema>;

export const BadgesFileSchema = z.object({ version: z.literal(1), badges: z.array(BadgeDefSchema).max(BADGES_MAX) }).strict();

/** Problems of a badge list, in words. Empty when it is fine. */
export function checkBadges(defs: readonly BadgeDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) problems.push(`badge ${d.id} appears twice`);
    seen.add(d.id);
    const allowed = d.scope === "user" ? USER_COUNTERS : MEMBER_COUNTERS;
    if (!allowed.includes(d.rule.counter)) problems.push(`badge ${d.id}: a ${d.scope} badge cannot count ${d.rule.counter}`);
  }
  if (defs.length < BADGE_MIN) problems.push(`there must be at least ${BADGE_MIN} badges, found ${defs.length}`);
  for (const scope of BADGE_SCOPES) if (!defs.some((d) => d.scope === scope)) problems.push(`there is no badge for scope ${scope}`);
  return problems;
}

/** The value of a counter for an entity. `level` comes from its XP. */
export function counterValue(e: Entity, counter: string): number {
  return counter === "level" ? levelOf(e.xp) : (e.counts[counter] ?? 0);
}

/**
 * Gives an entity every badge of its scope whose rule is met and that it does not have yet, stamped `ts`. Returns the
 * same entity when nothing was earned.
 */
export function evaluateBadges(e: Entity, scope: BadgeScope, defs: readonly BadgeDef[], ts: number): { entity: Entity; earned: BadgeDef[] } {
  const earned = defs.filter((d) => d.scope === scope && e.badges[d.id] === undefined && counterValue(e, d.rule.counter) >= d.rule.atLeast);
  if (earned.length === 0) return { entity: e, earned };
  return { entity: { ...e, badges: { ...e.badges, ...Object.fromEntries(earned.map((d) => [d.id, ts])) } }, earned };
}

// ---- daily quests (config/quests.json) ----

export const QUEST_POOL_MIN = 6;
export const QUESTS_MAX = 40;

export const QuestDefSchema = z
  .object({
    id: QuestIdSchema,
    title: z.string().min(1).max(60),
    /** The fact source it counts, from today's facts. */
    counter: z.enum(FACT_SOURCES),
    target: z.number().int().min(1).max(1000),
    /** Ecto, paid once. */
    reward: z.number().int().min(1).max(GRANT_AMOUNT_MAX),
  })
  .strict();
export type QuestDef = z.infer<typeof QuestDefSchema>;

export const QuestsFileSchema = z.object({ version: z.literal(1), quests: z.array(QuestDefSchema).max(QUESTS_MAX) }).strict();

export function checkQuests(defs: readonly QuestDef[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const d of defs) {
    if (seen.has(d.id)) problems.push(`quest ${d.id} appears twice`);
    seen.add(d.id);
  }
  if (defs.length < QUEST_POOL_MIN) problems.push(`the quest pool needs at least ${QUEST_POOL_MIN} quests, found ${defs.length}`);
  return problems;
}

/** The local date `YYYY-MM-DD` of an epoch ms. */
export function localDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** FNV-1a over the characters of a string: a stable seed. */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small seeded generator (mulberry32): the same seed always gives the same numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The quests of a day: `count` different ones from the pool, chosen with the date as the seed. The pool is sorted by id
 * first, so the choice does not depend on the order of the file. The same date and pool always give the same quests.
 */
export function pickQuests(day: string, pool: readonly QuestDef[], count: number = QUESTS_PER_DAY): QuestDef[] {
  const sorted = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next = mulberry32(seedOf(day));
  const out: QuestDef[] = [];
  for (let i = 0; i < Math.min(count, sorted.length); i++) {
    const j = i + Math.floor(next() * (sorted.length - i));
    [sorted[i], sorted[j]] = [sorted[j]!, sorted[i]!];
    out.push(sorted[i]!);
  }
  return out;
}

/** What the client shows of one quest. */
export const QuestViewSchema = z.object({
  id: QuestIdSchema,
  title: z.string(),
  progress: z.number().int().nonnegative(),
  target: z.number().int().positive(),
  reward: z.number().int().positive(),
  done: z.boolean(),
});
export type QuestView = z.infer<typeof QuestViewSchema>;
