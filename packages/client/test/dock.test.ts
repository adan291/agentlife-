import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ActivityLine } from "@agentlife/shared";
import { TERMINAL_MAX_LINES, TerminalModel, collapsedSummary, unreadText } from "../src/ui/terminal.ts";

const line = (n: number, agentId: ActivityLine["agentId"] = "architect"): ActivityLine => ({ agentId, ts: Date.UTC(2026, 0, 1, 10, 0, n), text: `line ${n}` });

describe("collapsed dock header", () => {
  it("counts only lines that arrive while collapsed", () => {
    const m = new TerminalModel();
    m.push(line(1));
    expect(m.unread).toBe(0);
    m.push(line(2), true);
    m.push(line(3), true);
    expect(m.unread).toBe(2);
    m.markRead();
    expect(m.unread).toBe(0);
  });

  it("seeded lines count as read", () => {
    const m = new TerminalModel();
    m.push(line(1), true);
    m.seed([line(1), line(2)]);
    expect(m.unread).toBe(0);
    expect(m.size).toBe(2);
  });

  it("the unread count never exceeds the buffer size (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 600 }), (flags) => {
        const m = new TerminalModel();
        flags.forEach((unseen, i) => m.push(line(i % 60), unseen));
        expect(m.unread).toBeLessThanOrEqual(TERMINAL_MAX_LINES);
        expect(m.unread).toBeLessThanOrEqual(flags.filter(Boolean).length);
      }),
    );
  });

  it("latest ignores the agent filter", () => {
    const m = new TerminalModel();
    m.push(line(1, "architect"));
    m.push(line(2, "qa"));
    m.filter = "architect";
    expect(m.latest()?.text).toBe("line 2");
    expect(m.visible()).toHaveLength(1);
  });

  it("summary shows time, role and text, or a hint when empty", () => {
    expect(collapsedSummary(undefined)).toBe("No activity yet");
    const s = collapsedSummary(line(5, "qa"));
    expect(s).toContain("QA");
    expect(s).toContain("line 5");
  });

  it("unread text is empty for zero", () => {
    expect(unreadText(0)).toBe("");
    expect(unreadText(3)).toBe("3 new");
  });
});
