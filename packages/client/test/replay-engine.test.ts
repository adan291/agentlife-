import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RunExportSchema } from "@agentlife/shared";
import type { AgentEvent, RunExport } from "@agentlife/shared";
import { ReplayEngine } from "../src/replay/engine.ts";
import { GAP_COMPRESSED_MS, GAP_MAX_MS, buildSchedule, compressGap, gapsAtSpeed } from "../src/replay/schedule.ts";

function eventsFromGaps(gaps: number[], start = 1_000_000): AgentEvent[] {
  let ts = start;
  return gaps.map((gap, seq) => {
    ts += gap;
    return { seq, ts, taskId: "t1", type: "task.state_changed", state: "analyzing" } as AgentEvent;
  });
}

const gapsArb = fc.array(fc.integer({ min: 0, max: 300_000 }), { minLength: 1, maxLength: 60 });

describe("schedule", () => {
  it("is monotonic and keeps the recorded order", () => {
    fc.assert(
      fc.property(gapsArb, (gaps) => {
        const events = eventsFromGaps(gaps);
        // Shuffled input must still come out in seq order.
        const shuffled = [...events].reverse();
        const { items } = buildSchedule(shuffled);
        expect(items.map((i) => i.event.seq)).toEqual(events.map((e) => e.seq));
        for (let i = 1; i < items.length; i++) expect(items[i]!.at).toBeGreaterThanOrEqual(items[i - 1]!.at);
        expect(items[0]!.at).toBe(0);
      }),
    );
  });

  it("never leaves a gap above 10 s / speed", () => {
    fc.assert(
      fc.property(gapsArb, fc.constantFrom(1, 4, 16), (gaps, speed) => {
        const { items } = buildSchedule(eventsFromGaps(gaps));
        for (const g of gapsAtSpeed(items, speed)) expect(g).toBeLessThanOrEqual(GAP_MAX_MS / speed);
      }),
    );
  });

  it("keeps short gaps and shortens long ones to 2 s", () => {
    expect(compressGap(0)).toBe(0);
    expect(compressGap(GAP_MAX_MS)).toBe(GAP_MAX_MS);
    expect(compressGap(GAP_MAX_MS + 1)).toBe(GAP_COMPRESSED_MS);
    expect(compressGap(90_851)).toBe(GAP_COMPRESSED_MS);
    const { items } = buildSchedule(eventsFromGaps([0, 500, 60_000, 9_000]));
    expect(items.map((i) => i.at)).toEqual([0, 500, 2_500, 11_500]);
  });

  it("maps recorded timestamps onto the compressed timeline", () => {
    const events = eventsFromGaps([0, 1_000, 50_000]);
    const s = buildSchedule(events);
    expect(s.offsetOf(events[0]!.ts - 5_000)).toBe(0);
    expect(s.offsetOf(events[1]!.ts)).toBe(1_000);
    expect(s.offsetOf(events[2]!.ts)).toBe(3_000);
    // Halfway through the long gap is halfway through the 2 s it became.
    expect(s.offsetOf(events[1]!.ts + 25_000)).toBe(2_000);
    expect(s.offsetOf(events[2]!.ts + 1e9)).toBe(s.total);
  });
});

function approvalRun(): RunExport {
  const base = { taskId: "t1" };
  const events = [
    { ...base, seq: 0, ts: 1000, type: "task.created", repoId: "r", goal: "g" },
    { ...base, seq: 1, ts: 1500, type: "approval.requested", approvalId: "a1", kind: "plan", summary: "s" },
    { ...base, seq: 2, ts: 91_500, type: "approval.resolved", approvalId: "a1", decision: "approve" },
    { ...base, seq: 3, ts: 92_500, type: "task.completed" },
  ] as AgentEvent[];
  return {
    version: 1,
    recordedAt: 1,
    job: { taskId: "t1", repoId: "r", goal: "g", state: "delivered", steps: [], approvals: [], artifacts: [] },
    events,
    artifacts: [],
  };
}

describe("ReplayEngine", () => {
  it("emits nothing before start and plays events on the virtual clock", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    expect(e.advance(10_000)).toEqual([]);
    expect(e.start().map((x) => x.type)).toEqual(["task.created"]);
    expect(e.advance(499)).toEqual([]);
    expect(e.advance(1).map((x) => x.type)).toEqual(["approval.requested"]);
  });

  it("pauses at the approval until it is resolved, however much time passes", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    e.start();
    e.advance(500);
    expect(e.waitingApproval).toBe("a1");
    expect(e.advance(10 * 60_000)).toEqual([]);
    expect(e.finished).toBe(false);
  });

  it("resumes with the recorded resolution, then the rest on schedule", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    e.start();
    e.advance(500);
    const r = e.resolveApproval("a1", "approve");
    expect(r).toMatchObject({ accepted: true, overridden: false });
    expect(r.events.map((x) => x.type)).toEqual(["approval.resolved"]);
    expect(e.waitingApproval).toBeNull();
    expect(e.advance(999)).toEqual([]);
    expect(e.advance(1).map((x) => x.type)).toEqual(["task.completed"]);
    expect(e.finished).toBe(true);
  });

  it("flags a Reject as overridden and still continues", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    e.start();
    e.advance(500);
    const r = e.resolveApproval("a1", "reject");
    expect(r.overridden).toBe(true);
    expect(r.events.map((x) => x.type)).toEqual(["approval.resolved"]);
    expect(r.events[0]).toMatchObject({ decision: "approve" });
  });

  it("ignores unknown or repeated approvals", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    e.start();
    expect(e.resolveApproval("a1", "approve").accepted).toBe(false);
    e.advance(500);
    expect(e.resolveApproval("nope", "approve").accepted).toBe(false);
    expect(e.resolveApproval("a1", "approve").accepted).toBe(true);
    expect(e.resolveApproval("a1", "approve").accepted).toBe(false);
  });

  it("speed divides the waiting time", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    e.setSpeed(16);
    e.start();
    expect(e.advance(500 / 16).map((x) => x.type)).toEqual(["approval.requested"]);
  });

  it("rebases timestamps onto the wall clock given as base", () => {
    const e = new ReplayEngine(approvalRun(), 5_000_000);
    const [first] = e.start();
    expect(first!.ts).toBe(5_000_000);
    const [second] = e.advance(500);
    expect(second!.ts).toBe(5_000_500);
  });

  it("restart goes back to the beginning", () => {
    const e = new ReplayEngine(approvalRun(), 0);
    e.start();
    e.advance(500);
    e.restart(0);
    expect(e.started).toBe(false);
    expect(e.waitingApproval).toBeNull();
    expect(e.start().map((x) => x.type)).toEqual(["task.created"]);
  });

  it("plays the recorded demo run to the end with every approval resolved by the user", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const exp = RunExportSchema.parse(JSON.parse(readFileSync(join(here, "..", "public", "demo", "run-001.json"), "utf8")));
    const e = new ReplayEngine(exp, 0);
    e.setSpeed(16);
    const seen: AgentEvent[] = [...e.start()];
    let guard = 0;
    while (!e.finished && guard++ < 10_000) {
      if (e.waitingApproval) seen.push(...e.resolveApproval(e.waitingApproval, "approve").events);
      else seen.push(...e.advance(100));
    }
    expect(e.finished).toBe(true);
    expect(seen.map((x) => x.seq)).toEqual(exp.events.map((x) => x.seq).sort((a, b) => a - b));
    expect(seen.at(-1)!.ts).toBeLessThan(10 * 60_000);
  });
});
