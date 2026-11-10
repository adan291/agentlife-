import { describe, expect, it } from "vitest";
import type { ServerMsg } from "@agentlife/shared";
import { bounceOffset, glowAlpha } from "../src/scene/glow.ts";
import { MailboxState } from "../src/ui/mailbox-state.ts";

const approval = (id: string, taskId: string, status: "pending" | "approved" | "rejected"): ServerMsg => ({
  type: "approval",
  approval: { approvalId: id, taskId, kind: "plan", summary: "s", status },
});
const report: ServerMsg = { type: "report", report: { reportId: "r1", taskId: "t1", title: "T", markdown: "m" } };
const job = (taskId: string, state: "created" | "analyzing" | "delivered" | "cancelled" | "failed"): ServerMsg => ({
  type: "job_update",
  job: { taskId, repoId: "r", goal: "g", state, timeline: [] },
});

describe("MailboxState", () => {
  it("counts pending approvals and drops them when resolved", () => {
    const s = new MailboxState();
    expect(s.apply(approval("a1", "t1", "pending"), null)).toBe(true);
    expect(s.pendingCount).toBe(1);
    expect(s.apply(approval("a1", "t1", "pending"), null)).toBe(false);
    s.apply(approval("a2", "t1", "pending"), null);
    expect(s.pendingCount).toBe(2);
    s.apply(approval("a1", "t1", "approved"), null);
    expect(s.pendingCount).toBe(1);
    s.apply(approval("a2", "t1", "rejected"), null);
    expect(s.pendingCount).toBe(0);
  });

  it("drops the approvals of a job that ended or of an older job", () => {
    const s = new MailboxState();
    s.apply(approval("a1", "t1", "pending"), null);
    expect(s.apply(job("t1", "analyzing"), null)).toBe(false);
    expect(s.pendingCount).toBe(1);
    s.apply(job("t1", "cancelled"), null);
    expect(s.pendingCount).toBe(0);
    s.apply(approval("a2", "t1", "pending"), null);
    s.apply(job("t2", "created"), null);
    expect(s.pendingCount).toBe(0);
  });

  it("shows the report dot until the mailbox is opened", () => {
    const s = new MailboxState();
    s.apply(report, null);
    expect(s.unseenReport).toBe(true);
    s.apply({ type: "open_panel", panel: "board" }, null);
    expect(s.unseenReport).toBe(true);
    s.apply({ type: "open_panel", panel: "mailbox" }, null);
    expect(s.unseenReport).toBe(false);
  });

  it("does not raise the dot for a report that arrives while the mailbox is open", () => {
    const s = new MailboxState();
    expect(s.apply(report, "mailbox")).toBe(false);
    expect(s.unseenReport).toBe(false);
  });

  it("a welcome (reconnect) clears everything", () => {
    const s = new MailboxState();
    s.apply(approval("a1", "t1", "pending"), null);
    s.apply(report, null);
    s.apply({ type: "welcome" } as ServerMsg, null);
    expect(s.pendingCount).toBe(0);
    expect(s.unseenReport).toBe(false);
  });
});

describe("glow", () => {
  it("pulses between 0.25 and 0.5 and is stronger on hover", () => {
    for (let t = 0; t < 4000; t += 50) {
      const a = glowAlpha(t, false, false);
      expect(a).toBeGreaterThanOrEqual(0.25 - 1e-9);
      expect(a).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(glowAlpha(t, true, false)).toBeGreaterThan(a);
    }
    expect(new Set([0, 500, 1000, 1500].map((t) => glowAlpha(t, false, false))).size).toBeGreaterThan(1);
  });

  it("is static under reduced motion", () => {
    const values = new Set([0, 333, 1000, 1777].map((t) => glowAlpha(t, false, true)));
    expect(values.size).toBe(1);
    expect(bounceOffset(300, true)).toBe(0);
    expect(bounceOffset(300, false)).toBeLessThan(0);
  });
});
