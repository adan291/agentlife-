import { describe, expect, it } from "vitest";
import { WISPS_PER_DAY, WISPS_PER_JOB } from "@agentlife/shared";
import type { LedgerEntry } from "@agentlife/shared";
import { Wisps } from "../src/wisps.ts";
import type { WispOptions } from "../src/wisps.ts";

const NOON = new Date(2026, 10, 13, 12, 0, 0).getTime();
const TILES = [
  { x: 1, y: 1 },
  { x: 2, y: 2 },
  { x: 3, y: 3 },
];
const SPOT = { roomId: "project:alpha", taskId: "task-1" };

/** A wallet that remembers what was paid, and a clock the test moves. */
function setup(options: WispOptions = {}) {
  let t = NOON;
  const paid = new Set<string>();
  const ledger: LedgerEntry[] = [];
  const wallet = { hasGranted: (_reason: string, ref: string) => paid.has(ref), ledger };
  const wisps = new Wisps(wallet as never, { now: () => t, random: () => 0, lifeMs: 8000, graceMs: 1000, ...options });
  const pay = (ref: string, ts = t) => {
    paid.add(ref);
    ledger.push({ ts, amount: 1, reason: "wisp_caught", ref });
  };
  return { wisps, pay, ledger, advance: (ms: number) => (t += ms), now: () => t };
}

describe("when a wisp may appear", () => {
  it("appears during a job on the user's floor, on one of the free tiles", () => {
    const { wisps } = setup({ random: () => 0.5 });
    const wisp = wisps.spawn(SPOT, TILES);
    expect(wisp).toMatchObject({ roomId: "project:alpha", taskId: "task-1", x: 2, y: 2, id: "wisp-1" });
    expect(wisps.current).toBe(wisp);
  });

  it("never appears without a job, without a user or without a free tile", () => {
    const { wisps } = setup();
    expect(wisps.spawn({ roomId: "project:alpha", taskId: undefined }, TILES)).toBeUndefined();
    expect(wisps.spawn({ roomId: undefined, taskId: undefined }, TILES)).toBeUndefined();
    expect(wisps.spawn(SPOT, [])).toBeUndefined();
    expect(wisps.current).toBeUndefined();
  });

  it("is one at a time, and another one can come once the first is over", () => {
    const { wisps, advance } = setup();
    expect(wisps.spawn(SPOT, TILES)).toBeDefined();
    expect(wisps.spawn(SPOT, TILES)).toBeUndefined();
    advance(8000 + 1000);
    expect(wisps.spawn(SPOT, TILES)).toBeUndefined(); // still inside the grace
    advance(1);
    expect(wisps.spawn(SPOT, TILES)?.id).toBe("wisp-2");
  });

  it("waits 20 to 60 s between tries", () => {
    const low = setup({ random: () => 0 });
    expect(low.wisps.nextDelay()).toBe(20_000);
    const high = setup({ random: () => 0.999999 });
    expect(high.wisps.nextDelay()).toBeGreaterThan(59_990);
    expect(high.wisps.nextDelay()).toBeLessThanOrEqual(60_000);
    const quick = setup({ minMs: 300, maxMs: 500, random: () => 0.5 });
    expect(quick.wisps.nextDelay()).toBe(400);
  });
});

describe("catching a wisp", () => {
  it("pays once, with the first catch number of the job", () => {
    const { wisps } = setup();
    const wisp = wisps.spawn(SPOT, TILES)!;
    expect(wisps.take(wisp.id, SPOT)).toMatchObject({ ok: true, ref: "task-1.1" });
    // The wisp is used up: a second click finds nothing.
    expect(wisps.take(wisp.id, SPOT)).toEqual({ ok: false });
    expect(wisps.current).toBeUndefined();
  });

  it("refuses a wisp that is not there, another id, or a click that came after the grace", () => {
    const { wisps, advance } = setup();
    expect(wisps.take("wisp-1", SPOT)).toEqual({ ok: false });
    const wisp = wisps.spawn(SPOT, TILES)!;
    expect(wisps.take("wisp-99", SPOT)).toEqual({ ok: false });
    expect(wisps.current).toBe(wisp);
    advance(8000 + 1000); // the grace still counts
    expect(wisps.take(wisp.id, SPOT).ok).toBe(true);
    const later = wisps.spawn(SPOT, TILES)!;
    advance(8000 + 1001);
    expect(wisps.take(later.id, SPOT)).toEqual({ ok: false });
    expect(wisps.current).toBeUndefined();
  });

  it("refuses a click from another floor or for another job", () => {
    const { wisps } = setup();
    const wisp = wisps.spawn(SPOT, TILES)!;
    expect(wisps.take(wisp.id, { roomId: "lobby", taskId: undefined })).toEqual({ ok: false });
    expect(wisps.take(wisp.id, { roomId: "project:alpha", taskId: "task-2" })).toEqual({ ok: false });
    expect(wisps.take(wisp.id, { roomId: "project:alpha", taskId: undefined })).toEqual({ ok: false });
    expect(wisps.current).toBe(wisp);
  });

  it("stops after ten paid catches of a job, and the next job starts again", () => {
    const { wisps, pay } = setup();
    for (let n = 1; n <= WISPS_PER_JOB; n++) {
      const wisp = wisps.spawn(SPOT, TILES)!;
      const taken = wisps.take(wisp.id, SPOT);
      expect(taken).toMatchObject({ ok: true, ref: `task-1.${n}` });
      if (taken.ok) pay(taken.ref);
    }
    expect(wisps.canPay("task-1")).toBe(false);
    expect(wisps.spawn(SPOT, TILES)).toBeUndefined();
    expect(wisps.spawn({ roomId: "project:alpha", taskId: "task-2" }, TILES)).toBeDefined();
  });

  it("stops after 50 paid catches in a day, and the next day starts again", () => {
    const { wisps, pay, advance, now } = setup();
    for (let n = 0; n < WISPS_PER_DAY; n++) pay(`old-job-${Math.floor(n / 10)}.${(n % 10) + 1}`);
    expect(wisps.canPay("task-9")).toBe(false);
    expect(wisps.spawn({ roomId: "project:alpha", taskId: "task-9" }, TILES)).toBeUndefined();
    // A wisp that already exists cannot be caught either once the day is full.
    advance(24 * 3_600_000);
    expect(new Date(now()).getDate()).not.toBe(new Date(NOON).getDate());
    expect(wisps.canPay("task-9")).toBe(true);
    expect(wisps.spawn({ roomId: "project:alpha", taskId: "task-9" }, TILES)).toBeDefined();
  });

  it("refuses a catch when the day filled up while the wisp was there", () => {
    const { wisps, pay } = setup();
    const wisp = wisps.spawn(SPOT, TILES)!;
    for (let n = 0; n < WISPS_PER_DAY; n++) pay(`other-${Math.floor(n / 10)}.${(n % 10) + 1}`);
    expect(wisps.take(wisp.id, SPOT)).toEqual({ ok: false });
  });

  it("does not spawn for a task id too long to carry the catch number", () => {
    const { wisps } = setup();
    expect(wisps.spawn({ roomId: "project:alpha", taskId: "t".repeat(95) }, TILES)).toBeUndefined();
  });
});

describe("ending a wisp", () => {
  it("sweep drops it only after life and grace, clear drops it at once", () => {
    const { wisps, advance } = setup();
    wisps.spawn(SPOT, TILES);
    expect(wisps.sweep()).toBeUndefined();
    advance(9001);
    expect(wisps.sweep()?.id).toBe("wisp-1");
    expect(wisps.current).toBeUndefined();
    wisps.spawn(SPOT, TILES);
    expect(wisps.clear()?.id).toBe("wisp-2");
    expect(wisps.clear()).toBeUndefined();
  });
});
