import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  LEVEL_MAX,
  MEMBERS_MAX,
  PROGRESS_KEYS_MAX,
  ProgressConfigSchema,
  ProgressSchema,
  ServerMsgSchema,
  STEP_MS_MAX,
  XP_MAX,
  XP_SOURCES,
  FACT_SOURCES,
  applyFact,
  levelOf,
  levelText,
  levelView,
  newProgress,
  progressView,
  statsOf,
  xpForLevel,
} from "../src/index.ts";
import type { FactSource, Progress, ProgressConfig, ProgressFact } from "../src/index.ts";

const SINCE = 1000;
const config: ProgressConfig = ProgressConfigSchema.parse({
  version: 1,
  xp: {
    step_done: { member: 10 },
    job_passed: { member: 25, user: 15 },
    review_passed: { member: 20, user: 10 },
    branch_delivered: { user: 20 },
    plan_approved: { user: 5 },
  },
});
const DEV = "alpha/developer";
const QA = "alpha/qa";
const fact = (source: FactSource, ref: string, ts = SINCE + 1, stepMs?: number): ProgressFact => ({ source, ref, ts, ...(stepMs === undefined ? {} : { stepMs }) });

describe("levels", () => {
  it("follows 50·n·(n+1)/2", () => {
    expect([0, 1, 2, 3, 4].map(xpForLevel)).toEqual([0, 50, 150, 300, 500]);
    expect(levelText(3)).toBe("Lv 3");
  });

  it("puts the edges on the right side", () => {
    expect([0, 49, 50, 149, 150, 299, 300].map(levelOf)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(levelOf(XP_MAX)).toBe(LEVEL_MAX);
    expect(levelOf(XP_MAX * 10)).toBe(LEVEL_MAX);
    expect(levelOf(-5)).toBe(0);
    expect(levelOf(Number.NaN)).toBe(0);
  });

  it("describes where a level begins and ends", () => {
    expect(levelView(120)).toEqual({ xp: 120, level: 1, base: 50, next: 150 });
    expect(levelView(0)).toEqual({ xp: 0, level: 0, base: 0, next: 50 });
    expect(levelView(XP_MAX)).toEqual({ xp: XP_MAX, level: LEVEL_MAX, base: XP_MAX });
  });

  it("property: the level is the largest one whose threshold is reached, and never goes down with more XP", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: XP_MAX }), fc.integer({ min: 0, max: 5000 }), (xp, more) => {
        const n = levelOf(xp);
        expect(xpForLevel(n)).toBeLessThanOrEqual(xp);
        if (n < LEVEL_MAX) expect(xpForLevel(n + 1)).toBeGreaterThan(xp);
        expect(levelOf(xp + more)).toBeGreaterThanOrEqual(n);
      }),
    );
  });
});

describe("config/progress.json schema", () => {
  const ok = { version: 1, xp: { step_done: { member: 1 }, job_passed: { user: 1 }, review_passed: { member: 1 }, branch_delivered: { user: 1 }, plan_approved: { user: 1 } } };
  it("accepts a table with the five sources", () => {
    expect(ProgressConfigSchema.safeParse(ok).success).toBe(true);
  });
  it.each([
    ["a missing source", { ...ok, xp: { ...ok.xp, step_done: undefined } }],
    ["an unknown source", { ...ok, xp: { ...ok.xp, sleeping: { user: 1 } } }],
    ["a source that pays nobody", { ...ok, xp: { ...ok.xp, step_done: { member: 0, user: 0 } } }],
    ["a negative amount", { ...ok, xp: { ...ok.xp, step_done: { member: -1 } } }],
    ["an amount over 1000", { ...ok, xp: { ...ok.xp, step_done: { member: 1001 } } }],
    ["a fractional amount", { ...ok, xp: { ...ok.xp, step_done: { member: 1.5 } } }],
    ["an unknown key in an entry", { ...ok, xp: { ...ok.xp, step_done: { member: 1, boss: 3 } } }],
  ])("refuses %s", (_name, value) => {
    expect(ProgressConfigSchema.safeParse(value).success).toBe(false);
  });
});

describe("applyFact", () => {
  const start = newProgress(SINCE);

  it("pays the member and the user what the table says, and counts the fact", () => {
    const r = applyFact(start, fact("job_passed", "t1"), [DEV, QA], config);
    expect(r.progress.user.xp).toBe(15);
    expect(r.progress.members[DEV]?.xp).toBe(25);
    expect(r.progress.members[QA]?.xp).toBe(25);
    expect(r.progress.user.counts["job_passed"]).toBe(1);
    expect(r.progress.counted).toEqual(["job_passed:t1"]);
    expect(r.skipped).toBeUndefined();
  });

  it("pays a step to the member only, and a delivery to the user only", () => {
    const step = applyFact(start, fact("step_done", "t1.developer"), [DEV], config).progress;
    expect(step.members[DEV]?.xp).toBe(10);
    expect(step.user.xp).toBe(0);
    const branch = applyFact(start, fact("branch_delivered", "t1"), [DEV], config).progress;
    expect(branch.user.xp).toBe(20);
    expect(branch.members).toEqual({});
  });

  it("counts a fact once", () => {
    const once = applyFact(start, fact("plan_approved", "appr-1"), [], config).progress;
    const again = applyFact(once, fact("plan_approved", "appr-1"), [], config);
    expect(again.skipped).toBe("counted");
    expect(again.progress).toBe(once);
    expect(applyFact(once, fact("plan_approved", "appr-2"), [], config).progress.user.xp).toBe(10);
  });

  it("counts nothing that happened before the file was made", () => {
    const r = applyFact(start, fact("job_passed", "old", SINCE - 1), [DEV], config);
    expect(r.skipped).toBe("before_start");
    expect(r.progress).toBe(start);
    expect(applyFact(start, fact("job_passed", "new", SINCE), [DEV], config).progress.user.xp).toBe(15);
  });

  it.each(["", "a b", "task:1", "x".repeat(101)])("refuses the ref %j", (ref) => {
    expect(applyFact(start, fact("job_passed", ref), [DEV], config).skipped).toBe("bad_ref");
  });

  it("leaves a member out when the key is not one the file could read back", () => {
    const r = applyFact(start, fact("step_done", "t1.developer"), ["Alpha/Developer", "no-slash", DEV], config);
    expect(Object.keys(r.progress.members)).toEqual([DEV]);
  });

  it("gives the facts that happen to the user only no member entry", () => {
    for (const source of ["branch_delivered", "plan_approved", "memory_accepted", "night_summary", "night_scheduled"] as const) {
      expect(applyFact(start, fact(source, "x"), [DEV], config).progress.members).toEqual({});
    }
  });

  it("adds the time of a step, only when it is a plausible one", () => {
    let p = applyFact(start, fact("step_done", "t1.developer", SINCE + 1, 40_000), [DEV], config).progress;
    p = applyFact(p, fact("step_done", "t2.developer", SINCE + 1, 20_000), [DEV], config).progress;
    p = applyFact(p, fact("step_done", "t3.developer", SINCE + 1, STEP_MS_MAX + 1), [DEV], config).progress;
    p = applyFact(p, fact("step_done", "t4.developer", SINCE + 1, -5), [DEV], config).progress;
    p = applyFact(p, fact("step_done", "t5.developer"), [DEV], config).progress;
    expect(p.members[DEV]).toMatchObject({ stepMs: 60_000 });
    expect(p.members[DEV]?.counts["step_done"]).toBe(5);
    expect(statsOf(p.members[DEV]!).avgStepMs).toBe(12_000);
  });

  it("keeps a streak of passes, ended by a job that did not pass", () => {
    let p: Progress = start;
    const run = (source: FactSource, ref: string) => (p = applyFact(p, fact(source, ref), [DEV], config).progress);
    run("job_passed", "a");
    run("review_passed", "b");
    run("job_passed", "c");
    expect(p.members[DEV]?.streak).toBe(3);
    run("job_not_passed", "d");
    expect(p.members[DEV]?.streak).toBe(0);
    expect(p.members[DEV]?.counts["best_streak"]).toBe(3);
    run("job_passed", "e");
    expect(p.members[DEV]?.streak).toBe(1);
    expect(p.members[DEV]?.counts["best_streak"]).toBe(3);
  });

  it("notes a job that passed in the small hours (local time) as a late job", () => {
    const at = (h: number) => new Date(2026, 10, 13, h, 30).getTime();
    const late = applyFact(newProgress(0), fact("job_passed", "a", at(2)), [DEV], config).progress;
    const day = applyFact(late, fact("job_passed", "b", at(14)), [DEV], config).progress;
    expect(day.user.counts["late_job"]).toBe(1);
    expect(day.members[DEV]?.counts["late_job"]).toBe(1);
    // A review or a step in the small hours is not a late job.
    expect(applyFact(newProgress(0), fact("review_passed", "c", at(2)), [DEV], config).progress.user.counts["late_job"]).toBeUndefined();
  });

  it("reports each level that went up, for the user and for the member", () => {
    const near: Progress = { ...start, user: { ...start.user, xp: 45 }, members: { [DEV]: { ...start.user, xp: 140 } } };
    const r = applyFact(near, fact("job_passed", "t1"), [DEV], config);
    expect(r.levelUps).toEqual([
      { who: "user", from: 0, to: 1 },
      { who: { member: DEV }, from: 1, to: 2 },
    ]);
    expect(applyFact(r.progress, fact("job_passed", "t2"), [DEV], config).levelUps).toEqual([]);
  });

  it("never passes the XP limit", () => {
    const top: Progress = { ...start, user: { ...start.user, xp: XP_MAX - 1 } };
    expect(applyFact(top, fact("branch_delivered", "t1"), [], config).progress.user.xp).toBe(XP_MAX);
  });

  it("forgets the oldest keys beyond the limit, and refuses a 301st member", () => {
    const full: Progress = { ...start, counted: Array.from({ length: PROGRESS_KEYS_MAX }, (_, i) => `job_passed:k${i}`) };
    const r = applyFact(full, fact("job_passed", "next"), [], config).progress;
    expect(r.counted).toHaveLength(PROGRESS_KEYS_MAX);
    expect(r.counted.at(-1)).toBe("job_passed:next");
    expect(r.counted[0]).toBe("job_passed:k1");
    const crowded: Progress = { ...start, members: Object.fromEntries(Array.from({ length: MEMBERS_MAX }, (_, i) => [`p/m${i}`, start.user])) };
    const added = applyFact(crowded, fact("job_passed", "t1"), ["p/extra", "p/m1"], config).progress;
    expect(added.members["p/extra"]).toBeUndefined();
    expect(added.members["p/m1"]?.xp).toBe(25);
  });
});

describe("the file and what the client gets", () => {
  it("round-trips through the schema, and a new file is empty", () => {
    const p = applyFact(newProgress(SINCE), fact("job_passed", "t1"), [DEV], config).progress;
    expect(ProgressSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(ProgressSchema.parse(newProgress(5))).toEqual({
      version: 1,
      since: 5,
      user: { xp: 0, counts: {}, stepMs: 0, streak: 0, badges: {} },
      members: {},
      counted: [],
      quests: { day: "", progress: {}, done: [] },
      payouts: [],
    });
  });

  it("reads a file written by task 1, without quests and payouts", () => {
    const old = { version: 1, since: 5, user: { xp: 0, counts: {}, stepMs: 0, streak: 0 }, members: {}, counted: [] };
    expect(ProgressSchema.parse(old)).toEqual(newProgress(5));
  });

  it("gives levels and stats for the user and each member", () => {
    let p = newProgress(SINCE);
    p = applyFact(p, fact("step_done", "t1.developer", SINCE + 1, 30_000), [DEV], config).progress;
    p = applyFact(p, fact("job_passed", "t1"), [DEV], config).progress;
    p = applyFact(p, fact("job_not_passed", "t2"), [DEV], config).progress;
    const view = progressView(p);
    expect(view.user).toMatchObject({ level: 0, xp: 15, jobs: 2, passed: 1, passRate: 0.5 });
    expect(view.members).toEqual([
      { projectId: "alpha", memberId: "developer", xp: 35, level: 0, base: 0, next: 50, jobs: 2, passed: 1, steps: 1, passRate: 0.5, avgStepMs: 30_000, badges: [] },
    ]);
    expect(ServerMsgSchema.safeParse({ type: "progress", state: view }).success).toBe(true);
  });

  it("has no pass rate or step time before there is anything to average", () => {
    expect(statsOf(newProgress(0).user)).toEqual({ jobs: 0, passed: 0, steps: 0 });
  });

  it("accepts the level_up message and refuses a bad one", () => {
    expect(ServerMsgSchema.safeParse({ type: "level_up", who: "member", name: "Ada", level: 2, slot: "developer" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "level_up", who: "user", name: "You", level: 0 }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "level_up", who: "robot", name: "x", level: 1 }).success).toBe(false);
  });
});

describe("properties", () => {
  const factArb = fc
    .record({
      source: fc.constantFrom(...FACT_SOURCES),
      ref: fc.constantFrom("a", "b", "c", "d", "e"),
      ts: fc.integer({ min: SINCE - 50, max: SINCE + 50 }),
      stepMs: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: undefined }),
    })
    .map((r): ProgressFact => ({ source: r.source, ref: r.ref, ts: r.ts, ...(r.stepMs === undefined ? {} : { stepMs: r.stepMs }) }));
  const membersArb = fc.subarray([DEV, QA, "alpha/architect"]);
  const stepArb = fc.record({ fact: factArb, members: membersArb });

  const apply = (p: Progress, steps: { fact: ProgressFact; members: string[] }[]): Progress =>
    steps.reduce((acc, s) => applyFact(acc, s.fact, s.members, config).progress, p);

  it("replaying the same facts changes nothing", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 30 }), (steps) => {
        const once = apply(newProgress(SINCE), steps);
        expect(apply(once, steps)).toEqual(once);
        expect(apply(apply(newProgress(SINCE), steps), steps)).toEqual(apply(newProgress(SINCE), [...steps, ...steps]));
      }),
    );
  });

  it("XP and levels never go down, and stay inside the limits", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        let p = newProgress(SINCE);
        for (const s of steps) {
          const next = apply(p, [s]);
          expect(next.user.xp).toBeGreaterThanOrEqual(p.user.xp);
          expect(levelOf(next.user.xp)).toBeGreaterThanOrEqual(levelOf(p.user.xp));
          for (const [k, m] of Object.entries(p.members)) expect(next.members[k]!.xp).toBeGreaterThanOrEqual(m.xp);
          p = next;
        }
        expect(p.user.xp).toBeLessThanOrEqual(XP_MAX);
        expect(ProgressSchema.safeParse(p).success).toBe(true);
      }),
    );
  });

  it("only XP sources pay XP", () => {
    for (const source of FACT_SOURCES) {
      const r = applyFact(newProgress(SINCE), fact(source, "x"), [DEV], config).progress;
      const paid = r.user.xp + (r.members[DEV]?.xp ?? 0) > 0;
      expect(paid).toBe((XP_SOURCES as readonly string[]).includes(source));
    }
  });
});
