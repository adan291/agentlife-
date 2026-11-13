import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BADGE_MIN,
  BADGE_SHAPES,
  BadgeDefSchema,
  BadgesFileSchema,
  FACT_SOURCES,
  PAYOUTS_MAX,
  ProgressConfigSchema,
  ProgressSchema,
  QUESTS_PER_DAY,
  QUEST_POOL_MIN,
  QuestDefSchema,
  ServerMsgSchema,
  applyFactWithRules,
  checkBadges,
  checkQuests,
  counterValue,
  evaluateBadges,
  localDay,
  newEntity,
  newProgress,
  payoutRef,
  pickQuests,
  progressView,
  questViews,
  settlePayout,
} from "../src/index.ts";
import type { BadgeDef, FactSource, Progress, ProgressConfig, ProgressFact, ProgressRules, QuestDef } from "../src/index.ts";

const badge = (id: string, over: Partial<BadgeDef> = {}): BadgeDef => ({
  id,
  name: id,
  description: `The ${id} badge.`,
  scope: "user",
  rule: { counter: "branch_delivered", atLeast: 1 },
  icon: { shape: "star", colour: "#ffd75e" },
  ...over,
});
const many = (n: number, scope: "user" | "member" = "user"): BadgeDef[] => Array.from({ length: n }, (_, i) => badge(`b${i}`, { scope }));
const quest = (id: string, counter: FactSource = "job_passed", over: Partial<QuestDef> = {}): QuestDef => ({ id, title: `Do ${id}`, counter, target: 1, reward: 10, ...over });
const pool: QuestDef[] = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => quest(id));

describe("badge definitions", () => {
  it("accepts a well-formed badge and refuses the malformed ones", () => {
    expect(BadgeDefSchema.safeParse(badge("first_delivery")).success).toBe(true);
    for (const bad of [
      badge("Bad Id"),
      badge("x", { name: "" }),
      badge("x", { description: "y".repeat(121) }),
      badge("x", { icon: { shape: "star", colour: "gold" } }),
      badge("x", { icon: { shape: "banana" as never, colour: "#ffffff" } }),
      badge("x", { rule: { counter: "branch_delivered", atLeast: 0 } }),
      badge("x", { rule: { counter: "nonsense" as never, atLeast: 1 } }),
      { ...badge("x"), extra: 1 },
    ]) {
      expect(BadgeDefSchema.safeParse(bad).success).toBe(false);
    }
    expect(BadgesFileSchema.safeParse({ version: 1, badges: [badge("a")] }).success).toBe(true);
    expect(BadgesFileSchema.safeParse({ version: 2, badges: [] }).success).toBe(false);
  });

  it("has a shape for every picture the client draws", () => {
    expect(BADGE_SHAPES.length).toBeGreaterThanOrEqual(10);
  });

  it("checks a list: enough badges, both scopes, no duplicate, no counter a scope cannot have", () => {
    const ok = [...many(BADGE_MIN - 2), ...many(2, "member").map((b, i) => ({ ...b, id: `m${i}`, rule: { counter: "step_done" as const, atLeast: 3 } }))];
    expect(checkBadges(ok)).toEqual([]);
    expect(checkBadges(ok.slice(0, 3)).join("\n")).toContain(`at least ${BADGE_MIN}`);
    expect(checkBadges([...ok, badge("b0")]).join("\n")).toContain("appears twice");
    expect(checkBadges(many(BADGE_MIN)).join("\n")).toContain("no badge for scope member");
    // A member never gets a plan approved or a branch delivered: those happen to the user.
    const bad = [...ok, badge("m_bad", { scope: "member", rule: { counter: "branch_delivered", atLeast: 1 } })];
    expect(checkBadges(bad).join("\n")).toContain("a member badge cannot count branch_delivered");
  });
});

describe("evaluateBadges", () => {
  const defs = [
    badge("first", { rule: { counter: "branch_delivered", atLeast: 1 } }),
    badge("ten", { rule: { counter: "branch_delivered", atLeast: 10 } }),
    badge("lvl", { rule: { counter: "level", atLeast: 1 } }),
    badge("mem", { scope: "member", rule: { counter: "step_done", atLeast: 1 } }),
  ];

  it("grants each badge whose rule is met, stamped, and only its own scope", () => {
    const e = { ...newEntity(), xp: 60, counts: { branch_delivered: 3, step_done: 5 } };
    const r = evaluateBadges(e, "user", defs, 777);
    expect(r.earned.map((d) => d.id)).toEqual(["first", "lvl"]);
    expect(r.entity.badges).toEqual({ first: 777, lvl: 777 });
    expect(evaluateBadges(e, "member", defs, 5).earned.map((d) => d.id)).toEqual(["mem"]);
  });

  it("grants a badge once: the same entity comes back untouched the second time", () => {
    const e = { ...newEntity(), counts: { branch_delivered: 1 } };
    const once = evaluateBadges(e, "user", defs, 1).entity;
    const twice = evaluateBadges(once, "user", defs, 2);
    expect(twice.earned).toEqual([]);
    expect(twice.entity).toBe(once);
    expect(twice.entity.badges["first"]).toBe(1);
  });

  it("reads the level from the XP", () => {
    expect(counterValue({ ...newEntity(), xp: 150 }, "level")).toBe(2);
    expect(counterValue(newEntity(), "step_done")).toBe(0);
  });
});

describe("daily quests", () => {
  it("accepts a quest and refuses the malformed ones", () => {
    expect(QuestDefSchema.safeParse(quest("a")).success).toBe(true);
    for (const bad of [quest("A"), quest("a", "nonsense" as never), quest("a", "job_passed", { target: 0 }), quest("a", "job_passed", { reward: 0 }), quest("a", "job_passed", { reward: 1001 }), { ...quest("a"), x: 1 }]) {
      expect(QuestDefSchema.safeParse(bad).success).toBe(false);
    }
    expect(checkQuests(pool)).toEqual([]);
    expect(checkQuests(pool.slice(0, QUEST_POOL_MIN - 1)).join("\n")).toContain("needs at least");
    expect(checkQuests([...pool, quest("a")]).join("\n")).toContain("appears twice");
  });

  it("takes the local date from a time", () => {
    expect(localDay(new Date(2026, 10, 3, 23, 59).getTime())).toBe("2026-11-03");
    expect(localDay(new Date(2026, 0, 9, 0, 1).getTime())).toBe("2026-01-09");
  });

  it("picks three different quests, the same ones for the same date, whatever the order of the pool", () => {
    const a = pickQuests("2026-11-13", pool);
    expect(a).toHaveLength(QUESTS_PER_DAY);
    expect(new Set(a.map((q) => q.id)).size).toBe(QUESTS_PER_DAY);
    expect(pickQuests("2026-11-13", pool)).toEqual(a);
    expect(pickQuests("2026-11-13", [...pool].reverse())).toEqual(a);
    expect(pickQuests("2026-11-14", pool).map((q) => q.id)).not.toEqual(a.map((q) => q.id));
  });

  it("property: three distinct quests of the pool for any date, always the same for that date", () => {
    const dayArb = fc.date({ min: new Date(2020, 0, 1), max: new Date(2040, 0, 1), noInvalidDate: true }).map((d) => localDay(d.getTime()));
    fc.assert(
      fc.property(dayArb, (day) => {
        const picked = pickQuests(day, pool);
        expect(picked).toHaveLength(QUESTS_PER_DAY);
        expect(new Set(picked.map((q) => q.id)).size).toBe(QUESTS_PER_DAY);
        for (const q of picked) expect(pool.map((p) => p.id)).toContain(q.id);
        expect(pickQuests(day, pool)).toEqual(picked);
      }),
    );
  });

  it("varies from day to day over a month", () => {
    const sets = new Set<string>();
    for (let d = 1; d <= 30; d++) sets.add(
      pickQuests(localDay(new Date(2026, 10, d).getTime()), pool)
        .map((q) => q.id)
        .sort()
        .join(),
    );
    expect(sets.size).toBeGreaterThan(10);
  });

  it("gives a smaller pool all it has", () => {
    expect(pickQuests("2026-11-13", pool.slice(0, 2))).toHaveLength(2);
  });
});

describe("applyFactWithRules", () => {
  const config: ProgressConfig = ProgressConfigSchema.parse({
    version: 1,
    xp: { step_done: { member: 10 }, job_passed: { member: 25, user: 15 }, review_passed: { member: 20, user: 10 }, branch_delivered: { user: 20 }, plan_approved: { user: 5 } },
  });
  const DEV = "alpha/developer";
  const NOW = new Date(2026, 10, 13, 12, 0).getTime();
  const SINCE = NOW - 3_600_000;
  const TODAY = localDay(NOW);
  const mine = pickQuests(TODAY, pool);
  const rules: ProgressRules = { badges: [badge("first_job", { scope: "member", rule: { counter: "job_passed", atLeast: 1 } }), badge("first_branch")], quests: pool, today: TODAY };
  const fact = (source: FactSource, ref: string, ts = NOW): ProgressFact => ({ source, ref, ts });
  const start = newProgress(SINCE);

  it("grants the user's and the member's badges when the rule is met, and tells who earned what", () => {
    const r = applyFactWithRules(start, fact("job_passed", "t1"), [DEV], config, rules);
    expect(r.badges.map((b) => [b.who, b.badge.id])).toEqual([[{ member: DEV }, "first_job"]]);
    expect(r.progress.members[DEV]?.badges).toEqual({ first_job: NOW });
    const d = applyFactWithRules(r.progress, fact("branch_delivered", "t1"), [], config, rules);
    expect(d.badges.map((b) => [b.who, b.badge.id])).toEqual([["user", "first_branch"]]);
    // The same badge is not granted again.
    expect(applyFactWithRules(d.progress, fact("branch_delivered", "t2"), [], config, rules).badges).toEqual([]);
  });

  it("changes nothing for a fact that was counted before", () => {
    const once = applyFactWithRules(start, fact("job_passed", "t1"), [DEV], config, rules).progress;
    const again = applyFactWithRules(once, fact("job_passed", "t1"), [DEV], config, rules);
    expect(again.progress).toBe(once);
    expect(again.badges).toEqual([]);
    expect(again.questsDone).toEqual([]);
  });

  it("completes a quest once, with a payout, and only for the facts of today", () => {
    const q = mine[0]!;
    const source = q.counter;
    // A fact from yesterday does not move today's quest.
    const old = applyFactWithRules(start, fact(source, "old", NOW - 86_400_000), [DEV], config, { ...rules, today: TODAY });
    expect(old.progress.quests.progress[q.id]).toBeUndefined();
    const r = applyFactWithRules({ ...start, since: 0 }, fact(source, "t1"), [DEV], config, rules);
    const done = r.questsDone.filter((d) => d.id === q.id);
    expect(done).toEqual([{ id: q.id, title: q.title, reward: q.reward, ref: payoutRef(TODAY, q.id) }]);
    expect(r.progress.quests.done).toContain(q.id);
    expect(r.progress.payouts).toContainEqual({ ref: payoutRef(TODAY, q.id), reward: q.reward });
    // Another fact of the same kind later pays nothing more.
    const more = applyFactWithRules(r.progress, fact(source, "t2"), [DEV], config, rules);
    expect(more.questsDone.filter((d) => d.id === q.id)).toEqual([]);
    expect(more.progress.payouts.filter((p) => p.ref === payoutRef(TODAY, q.id))).toHaveLength(1);
  });

  it("counts toward a quest with a target above one, and completes it on the second fact", () => {
    const two: QuestDef[] = [quest("a", "job_passed", { target: 2 }), ...pool.slice(1)];
    // Find a day on which the pool picks the quest "a".
    let day = NOW;
    for (let d = 0; d < 60 && !pickQuests(localDay(day), two).some((q) => q.id === "a"); d++) day = NOW + (d + 1) * 86_400_000;
    const on = { ...rules, quests: two, today: localDay(day) };
    expect(pickQuests(on.today, two).some((q) => q.id === "a")).toBe(true);
    const open = { ...start, since: 0 };
    const r1 = applyFactWithRules(open, fact("job_passed", "a1", day), [DEV], config, on);
    expect(r1.progress.quests.progress["a"]).toBe(1);
    expect(r1.progress.quests.done).not.toContain("a");
    const r2 = applyFactWithRules(r1.progress, fact("job_passed", "a2", day), [DEV], config, on);
    expect(r2.progress.quests.done).toContain("a");
    expect(r2.questsDone.map((d) => d.id)).toContain("a");
  });

  it("rolls the quests over when the stored day is not today", () => {
    const yesterday: Progress = { ...start, since: 0, quests: { day: "2026-11-12", progress: { [mine[0]!.id]: 1 }, done: [mine[0]!.id] } };
    const r = applyFactWithRules(yesterday, fact("step_done", "t1.developer"), [DEV], config, rules);
    expect(r.progress.quests.day).toBe(TODAY);
    expect(r.progress.quests.done.filter((id) => id === mine[0]!.id).length).toBeLessThanOrEqual(1);
    const view = questViews(yesterday, rules);
    expect(view.every((v) => v.progress === 0 && !v.done)).toBe(true);
  });

  it("settles a payout once and forgets it", () => {
    const p: Progress = { ...start, payouts: [{ ref: "2026-11-13.a", reward: 10 }, { ref: "2026-11-13.b", reward: 5 }] };
    const s = settlePayout(p, "2026-11-13.a");
    expect(s.payouts).toEqual([{ ref: "2026-11-13.b", reward: 5 }]);
    expect(settlePayout(s, "2026-11-13.a")).toBe(s);
  });

  it("never keeps more payouts than the limit", () => {
    let p: Progress = { ...start, since: 0, payouts: Array.from({ length: PAYOUTS_MAX }, (_, i) => ({ ref: `old.q${i}`, reward: 1 })) };
    p = applyFactWithRules(p, fact(mine[0]!.counter, "t1"), [DEV], config, rules).progress;
    expect(p.payouts.length).toBeLessThanOrEqual(PAYOUTS_MAX);
  });

  it("builds the view with the badge list and today's quests, and the file stays valid", () => {
    const r = applyFactWithRules({ ...start, since: 0 }, fact("job_passed", "t1"), [DEV], config, rules).progress;
    const view = progressView(r, rules);
    expect(view.badgeDefs.map((b) => b.id)).toEqual(["first_job", "first_branch"]);
    expect(view.quests.day).toBe(TODAY);
    expect(view.quests.items).toHaveLength(QUESTS_PER_DAY);
    expect(view.members[0]?.badges).toEqual([{ id: "first_job", at: NOW }]);
    expect(ServerMsgSchema.safeParse({ type: "progress", state: view }).success).toBe(true);
    expect(ProgressSchema.safeParse(r).success).toBe(true);
    expect(progressView(r).quests).toEqual({ day: "", items: [] });
  });

  it("property: replaying the same facts changes nothing, with badges and quests on", () => {
    const factArb = fc.record({ source: fc.constantFrom(...FACT_SOURCES), ref: fc.constantFrom("a", "b", "c"), ts: fc.constantFrom(NOW, NOW - 86_400_000, SINCE - 1) });
    fc.assert(
      fc.property(fc.array(factArb, { maxLength: 25 }), (facts) => {
        const run = (p: Progress): Progress => facts.reduce((acc, f) => applyFactWithRules(acc, f, [DEV], config, rules).progress, p);
        const once = run(start);
        expect(run(once)).toEqual(once);
        expect(ProgressSchema.safeParse(once).success).toBe(true);
      }),
    );
  });
});
