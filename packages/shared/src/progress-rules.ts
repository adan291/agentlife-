import { z } from "zod";
import { BadgeDefSchema, QuestViewSchema, evaluateBadges, localDay, pickQuests } from "./badges.ts";
import type { BadgeDef, QuestDef, QuestView } from "./badges.ts";
import { EntityViewSchema, MEMBERS_MAX, MEMBER_SOURCES, MemberViewSchema, PAYOUTS_MAX, QUESTS_PER_DAY, applyFact, entityView, memberViews, newQuestState } from "./progress.ts";
import type { FactResult, Payout, Progress, ProgressConfig, ProgressFact } from "./progress.ts";
import { keepLast } from "./economy.ts";

/**
 * Facts with badges and daily quests on top (team-progress task 2). `applyFact` moves counters and XP; this module then
 * grants the badges whose rule is met and moves the quests of the day. Pure, like `applyFact`.
 */

export interface ProgressRules {
  badges: readonly BadgeDef[];
  /** The pool the day's quests are chosen from. */
  quests: readonly QuestDef[];
  /** The local day, `YYYY-MM-DD`. A fact counts for quests only when it happened on this day. */
  today: string;
}

export interface EarnedBadge {
  who: "user" | { member: string };
  badge: BadgeDef;
}

/** A quest this fact completed. Its Ecto waits in `payouts` until the wallet has it. */
export interface QuestDone {
  id: string;
  title: string;
  reward: number;
  ref: string;
}

export interface RulesResult extends FactResult {
  badges: EarnedBadge[];
  questsDone: QuestDone[];
}

export function payoutRef(day: string, questId: string): string {
  return `${day}.${questId}`;
}

/** Counts a fact (see `applyFact`), then grants badges and moves today's quests. Nothing changes when the fact is not counted. */
export function applyFactWithRules(progress: Progress, fact: ProgressFact, members: readonly string[], config: ProgressConfig, rules: ProgressRules): RulesResult {
  const base = applyFact(progress, fact, members, config);
  if (base.progress === progress) return { ...base, badges: [], questsDone: [] };
  let next = base.progress;
  const badges: EarnedBadge[] = [];

  const user = evaluateBadges(next.user, "user", rules.badges, fact.ts);
  if (user.earned.length > 0) {
    next = { ...next, user: user.entity };
    badges.push(...user.earned.map((badge): EarnedBadge => ({ who: "user", badge })));
  }
  if (MEMBER_SOURCES.includes(fact.source)) {
    const changed: Progress["members"] = {};
    for (const key of new Set(members)) {
      const entity = next.members[key];
      if (!entity) continue; // not a valid key, or the file was full
      const r = evaluateBadges(entity, "member", rules.badges, fact.ts);
      if (r.earned.length === 0) continue;
      changed[key] = r.entity;
      badges.push(...r.earned.map((badge): EarnedBadge => ({ who: { member: key }, badge })));
    }
    if (Object.keys(changed).length > 0) next = { ...next, members: { ...next.members, ...changed } };
  }

  // Quests: a new day starts again from zero. Only a fact of today moves them.
  const today = rules.today;
  let quests = next.quests.day === today ? next.quests : { ...newQuestState(), day: today };
  let payouts = next.payouts;
  const questsDone: QuestDone[] = [];
  if (localDay(fact.ts) === today) {
    for (const q of pickQuests(today, rules.quests, QUESTS_PER_DAY)) {
      if (q.counter !== fact.source || quests.done.includes(q.id)) continue;
      const progressNow = Math.min(100_000, (quests.progress[q.id] ?? 0) + 1);
      const done = progressNow >= q.target;
      quests = { ...quests, progress: { ...quests.progress, [q.id]: progressNow }, done: done ? [...quests.done, q.id] : quests.done };
      if (!done) continue;
      const ref = payoutRef(today, q.id);
      questsDone.push({ id: q.id, title: q.title, reward: q.reward, ref });
      if (!payouts.some((p) => p.ref === ref)) payouts = keepLast([...payouts, { ref, reward: q.reward }], PAYOUTS_MAX);
    }
  }
  if (quests !== next.quests || payouts !== next.payouts) next = { ...next, quests, payouts };
  return { ...base, progress: next, badges, questsDone };
}

/** The payout is in the wallet: take it off the list. Returns the same file when it was not there. */
export function settlePayout(progress: Progress, ref: string): Progress {
  if (!progress.payouts.some((p) => p.ref === ref)) return progress;
  return { ...progress, payouts: progress.payouts.filter((p) => p.ref !== ref) };
}

export function pendingPayouts(progress: Progress): readonly Payout[] {
  return progress.payouts;
}

/** Today's quests with their progress. A stored day that is not today counts as no progress. */
export function questViews(progress: Progress, rules: Pick<ProgressRules, "quests" | "today">): QuestView[] {
  const state = progress.quests.day === rules.today ? progress.quests : newQuestState();
  return pickQuests(rules.today, rules.quests, QUESTS_PER_DAY).map((q) => ({
    id: q.id,
    title: q.title,
    progress: Math.min(state.progress[q.id] ?? 0, q.target),
    target: q.target,
    reward: q.reward,
    done: state.done.includes(q.id),
  }));
}

export const ProgressViewSchema = z.object({
  user: EntityViewSchema,
  members: z.array(MemberViewSchema).max(MEMBERS_MAX),
  /** Every badge there is, so the Profile panel can show the ones not earned yet. */
  badgeDefs: z.array(BadgeDefSchema).max(60).default([]),
  /** Today's quests. */
  quests: z.object({ day: z.string().max(10), items: z.array(QuestViewSchema).max(QUESTS_PER_DAY) }).default({ day: "", items: [] }),
});
export type ProgressView = z.infer<typeof ProgressViewSchema>;

export function progressView(p: Progress, rules?: ProgressRules): ProgressView {
  return {
    user: entityView(p.user),
    members: memberViews(p),
    badgeDefs: rules ? [...rules.badges] : [],
    quests: rules ? { day: rules.today, items: questViews(p, rules) } : { day: "", items: [] },
  };
}
