import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NightScheduler } from "../src/night/scheduler.ts";
import { NightStore } from "../src/night/store.ts";
import { windowAt } from "../src/night/window.ts";
import { CONFIG, at, byStatus, rig, schedule, tmpDir } from "./night-helpers.ts";

describe("night window", () => {
  it("is open from the start minute up to, and not including, the end minute", () => {
    expect(windowAt(at(0, 59), CONFIG)).toBeUndefined();
    expect(windowAt(at(1, 0), CONFIG)?.key).toBe("2026-11-12");
    expect(windowAt(at(6, 59), CONFIG)?.key).toBe("2026-11-12");
    expect(windowAt(at(7, 0), CONFIG)).toBeUndefined();
    expect(windowAt(at(13, 0), CONFIG)).toBeUndefined();
  });

  it("gives the start and end instants of the window", () => {
    const w = windowAt(at(3, 0), CONFIG)!;
    expect(w.start).toBe(at(1, 0));
    expect(w.end).toBe(at(7, 0));
  });

  it("may cross midnight: the part after midnight belongs to the night that started the day before", () => {
    const wrap = { start: "22:00", end: "06:00" };
    expect(windowAt(at(21, 59), wrap)).toBeUndefined();
    expect(windowAt(at(23, 0), wrap)?.key).toBe("2026-11-12");
    const after = windowAt(at(3, 0, 1), wrap)!;
    expect(after.key).toBe("2026-11-12");
    expect(after.start).toBe(at(22, 0));
    expect(after.end).toBe(at(6, 0, 1));
    expect(windowAt(at(6, 0, 1), wrap)).toBeUndefined();
    expect(windowAt(at(12, 0), wrap)).toBeUndefined();
  });
});

describe("night schedule file", () => {
  it("keeps the schedule across a restart", () => {
    const r = rig();
    const a = schedule(r.store, { kind: "review-branch", target: "feature/x", tier: "cheap" });
    schedule(r.store, { kind: "write-tests", target: "src", preApprove: true });
    const again = new NightStore({ file: r.file });
    expect(again.jobs().map((j) => j.id)).toEqual(r.store.jobs().map((j) => j.id));
    expect(again.get(a.id)).toMatchObject({ kind: "review-branch", target: "feature/x", tier: "cheap", status: "scheduled", goal: "Review branch feature/x" });
  });

  it("writes the file atomically", () => {
    const r = rig();
    schedule(r.store);
    const text = readFileSync(r.file, "utf8");
    expect(JSON.parse(text).version).toBe(1);
    expect(existsSync(`${r.file}.${process.pid}.tmp`)).toBe(false);
  });

  it("moves an unreadable file aside instead of overwriting it", () => {
    const dir = tmpDir();
    const file = path.join(dir, "night.json");
    writeFileSync(file, "{ not json");
    const store = new NightStore({ file, now: () => 42 });
    expect(store.jobs()).toEqual([]);
    expect(existsSync(`${file}.bad-42`)).toBe(true);
    expect(readFileSync(`${file}.bad-42`, "utf8")).toBe("{ not json");
  });

  it("reorders only jobs that wait for a night, and removes jobs", () => {
    const r = rig();
    const a = schedule(r.store);
    const b = schedule(r.store);
    const c = schedule(r.store);
    r.store.update(b.id, { status: "done" });
    r.store.move(c.id, "up");
    expect(r.store.scheduled().map((j) => j.id)).toEqual([c.id, a.id]);
    r.store.move(c.id, "up");
    expect(r.store.scheduled().map((j) => j.id)).toEqual([c.id, a.id]);
    expect(() => r.store.move(b.id, "up")).toThrow(/waiting for a night/);
    r.store.remove(a.id);
    expect(r.store.get(a.id)).toBeUndefined();
    r.store.update(c.id, { status: "running" });
    expect(() => r.store.remove(c.id)).toThrow(/running/);
  });

  it("makes room by dropping the oldest finished job when the schedule is full", () => {
    const r = rig();
    const first = schedule(r.store);
    r.store.update(first.id, { status: "done" });
    for (let i = 1; i < 50; i++) schedule(r.store);
    expect(r.store.jobs()).toHaveLength(50);
    schedule(r.store);
    expect(r.store.jobs()).toHaveLength(50);
    expect(r.store.get(first.id)).toBeUndefined();
    expect(() => schedule(r.store)).toThrow(/holds 50 jobs/);
  });
});

describe("night scheduler", () => {
  it("starts nothing outside the window and starts the first job inside it", async () => {
    const r = rig(CONFIG, at(0, 30));
    const a = schedule(r.store);
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(0);
    expect(r.store.night()).toBeUndefined();

    r.now = at(1, 0);
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(1);
    expect(r.store.get(a.id)).toMatchObject({ status: "running", taskId: "task-1", nightKey: "2026-11-12", startedAt: at(1, 0) });
    expect(r.store.night()).toMatchObject({ key: "2026-11-12", openedAt: at(1, 0), windowEnd: at(7, 0) });
  });

  it("runs one job at a time and starts the next one when the first has ended", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    const b = schedule(r.store);
    await r.scheduler.tick();
    r.now = at(1, 5);
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(1);

    r.port.set("task-1", "delivered", { verdict: "pass" });
    r.now = at(1, 10);
    await r.scheduler.tick();
    expect(r.store.get(a.id)).toMatchObject({ status: "done", verdict: "pass", endedAt: at(1, 10) });
    // The next job starts in the same pass that saw the first one end.
    expect(r.port.started).toHaveLength(2);
    expect(r.store.get(b.id)?.status).toBe("running");
  });

  it("runs the jobs in the order of the schedule", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    const b = schedule(r.store, { kind: "review-branch", target: "feature/y" });
    r.store.move(b.id, "up");
    await r.scheduler.tick();
    expect(r.port.started[0]?.goal).toBe("Review branch feature/y");
    expect(r.store.get(a.id)?.status).toBe("scheduled");
  });

  it("records a failing verdict as failed", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    await r.scheduler.tick();
    r.port.set("task-1", "delivered", { verdict: "fail" });
    await r.scheduler.tick();
    expect(r.store.get(a.id)).toMatchObject({ status: "failed", verdict: "fail" });
  });

  it("starts at most maxJobsPerNight jobs and skips the rest with the reason when the window ends", async () => {
    const r = rig({ ...CONFIG, maxJobsPerNight: 2 }, at(1, 0));
    schedule(r.store);
    schedule(r.store);
    const third = schedule(r.store);
    for (let i = 1; i <= 2; i++) {
      await r.scheduler.tick();
      r.port.set(`task-${i}`, "delivered", { verdict: "pass" });
    }
    r.now = at(3, 0);
    await r.scheduler.tick();
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(2);
    expect(r.store.get(third.id)?.status).toBe("scheduled");

    r.now = at(7, 0);
    await r.scheduler.tick();
    expect(r.store.get(third.id)).toMatchObject({ status: "skipped", reason: "The night limit of 2 jobs was reached.", nightKey: "2026-11-12" });
    expect(r.store.night()?.closedAt).toBe(at(7, 0));
  });

  it("does not start while a daytime job is running, and starts when it has ended", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    r.port.daytime("day-1", "other", "developing");
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(0);
    expect(r.store.night()?.daytimeBlocked).toBe(true);

    r.port.set("day-1", "delivered");
    r.now = at(1, 1);
    await r.scheduler.tick();
    expect(r.store.get(a.id)?.status).toBe("running");
  });

  it("ignores a daytime plan that only waits for its approval", async () => {
    const r = rig(CONFIG, at(1, 0));
    schedule(r.store);
    r.port.daytime("day-1", "other", "awaiting_plan_approval");
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(1);
  });

  it("skips a job that never found a free hotel and says why", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    r.port.daytime("day-1", "other", "testing");
    await r.scheduler.tick();
    r.now = at(7, 0);
    await r.scheduler.tick();
    expect(r.store.get(a.id)).toMatchObject({ status: "skipped", reason: "A daytime job kept the hotel busy." });
  });

  it("stops starting new jobs when the window ends and says the window was the reason", async () => {
    const r = rig(CONFIG, at(6, 59));
    schedule(r.store);
    const b = schedule(r.store);
    await r.scheduler.tick();
    r.port.set("task-1", "delivered", { verdict: "pass" });
    r.now = at(7, 1);
    await r.scheduler.tick();
    expect(r.port.started).toHaveLength(1);
    expect(r.store.get(b.id)).toMatchObject({ status: "skipped", reason: "The night window ended before it could start." });
  });

  it("lets the running job finish after the window ends and closes the night afterwards", async () => {
    const r = rig(CONFIG, at(6, 50));
    const a = schedule(r.store);
    await r.scheduler.tick();
    r.now = at(7, 5);
    await r.scheduler.tick();
    expect(r.port.cancelled).toEqual([]);
    expect(r.store.get(a.id)?.status).toBe("running");
    expect(r.store.night()?.closedAt).toBeUndefined();

    r.port.set("task-1", "delivered", { verdict: "pass" });
    r.now = at(7, 6);
    await r.scheduler.tick();
    expect(r.store.get(a.id)?.status).toBe("done");
    expect(r.store.night()?.closedAt).toBe(at(7, 6));
  });

  it("keeps a job added after the window ended for the next night", async () => {
    const r = rig(CONFIG, at(6, 50));
    schedule(r.store);
    await r.scheduler.tick();
    r.now = at(7, 5);
    await r.scheduler.tick();
    const later = schedule(r.store);
    r.now = at(7, 10);
    await r.scheduler.tick();
    expect(r.store.get(later.id)?.status).toBe("scheduled");
  });

  it("cancels a job that runs longer than the time limit and records it as timed out", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    await r.scheduler.tick();
    r.now = at(1, 19);
    await r.scheduler.tick();
    expect(r.port.cancelled).toEqual([]);

    r.now = at(1, 21);
    await r.scheduler.tick();
    expect(r.port.cancelled).toEqual(["task-1"]);
    expect(r.store.get(a.id)?.status).toBe("running");

    r.port.set("task-1", "cancelled");
    r.now = at(1, 22);
    await r.scheduler.tick();
    expect(r.store.get(a.id)).toMatchObject({ status: "timed_out", reason: "Stopped after 20 minutes." });
  });

  it("records a job the user cancelled as cancelled, not timed out", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    await r.scheduler.tick();
    r.port.set("task-1", "cancelled");
    await r.scheduler.tick();
    expect(r.store.get(a.id)?.status).toBe("cancelled");
  });

  it("goes on trying to cancel when the job could not be cancelled yet", async () => {
    const r = rig(CONFIG, at(1, 0));
    schedule(r.store);
    await r.scheduler.tick();
    r.port.cancelError = new Error("not cancellable");
    r.now = at(1, 30);
    await r.scheduler.tick();
    r.port.cancelError = undefined;
    await r.scheduler.tick();
    expect(r.port.cancelled).toEqual(["task-1"]);
  });

  it("skips a job whose project is gone or busy and goes on with the next one", async () => {
    const r = rig(CONFIG, at(1, 0));
    const gone = schedule(r.store, { repoId: "removed" });
    const busy = schedule(r.store, { repoId: "other" });
    const ok = schedule(r.store, { repoId: "demo" });
    r.port.busyProjects.add("other");
    await r.scheduler.tick();
    expect(r.store.get(gone.id)).toMatchObject({ status: "skipped", reason: "The project is no longer registered." });
    expect(r.store.get(busy.id)).toMatchObject({ status: "skipped", reason: "The project already had a job running." });
    expect(r.store.get(ok.id)?.status).toBe("running");
  });

  it("picks up a running job after a restart", async () => {
    const r = rig(CONFIG, at(1, 0));
    const a = schedule(r.store);
    await r.scheduler.tick();
    // A new process: new store and scheduler over the same file; the engine's job is now finished.
    const store2 = new NightStore({ file: r.file, now: r.clock });
    const scheduler2 = new NightScheduler({ store: store2, port: r.port, config: CONFIG, now: r.clock });
    r.port.set("task-1", "delivered", { verdict: "pass" });
    r.now = at(1, 30);
    await scheduler2.tick();
    expect(store2.get(a.id)?.status).toBe("done");
  });

  it("closes a night that was never closed when the next window opens", async () => {
    const r = rig(CONFIG, at(2, 0));
    schedule(r.store);
    await r.scheduler.tick();
    r.port.set("task-1", "delivered", { verdict: "pass" });
    // The engine was off until the next night.
    schedule(r.store);
    r.now = at(2, 0, 1);
    await r.scheduler.tick();
    expect(byStatus(r.store, "done")).toHaveLength(1);
    expect(r.store.night()).toMatchObject({ key: "2026-11-13" });
    expect(r.port.started).toHaveLength(2);
  });

  it("does not open a night when nothing is scheduled", async () => {
    const r = rig(CONFIG, at(2, 0));
    await r.scheduler.tick();
    expect(r.store.night()).toBeUndefined();
  });

  it("never overlaps two passes", async () => {
    const r = rig(CONFIG, at(1, 0));
    schedule(r.store);
    schedule(r.store);
    await Promise.all([r.scheduler.tick(), r.scheduler.tick(), r.scheduler.tick()]);
    expect(r.port.started).toHaveLength(1);
  });
});
