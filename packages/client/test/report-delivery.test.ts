import { describe, expect, it } from "vitest";
import type { Report, ServerMsg } from "@agentlife/shared";
import { ATTENTION_MS, attentionActive, attentionAlpha, attentionLift, glowAlpha } from "../src/scene/glow.ts";
import { renderMailbox } from "../src/ui/mailbox.ts";
import { MailboxState } from "../src/ui/mailbox-state.ts";
import type { PanelData } from "../src/ui/panel-state.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { newestFirst, renderReportViewer, reportFacts, reportHeadline, reportVerdict, verdictText } from "../src/ui/report-viewer.ts";
import { YOUR_TURN_TEXT, reportToastText, tabTitle, toastPlan } from "../src/ui/toast.ts";
import { fakeDoc, findAll, html, textOf } from "./fake-dom.ts";

const MARKDOWN = [
  "# AGENT LIFE report",
  "",
  "## Summary",
  "",
  "- **Goal:** `Validate todo titles`",
  "- **Task:** `Reject empty titles in addTodo`",
  "- **Done when:** `addTodo throws on an empty title`",
  "- **Verdict:** PASS",
  "",
  "## Plan",
  "",
  "1. `Reject empty titles in addTodo` (risk: low; implemented)",
  "",
  "## Change",
  "",
  "1 file changed, +3 -1.",
  "",
  "```diff",
  "--- a/src/todo.ts",
  "+++ b/src/todo.ts",
  "@@ -1,2 +1,4 @@",
  "-old line",
  "+new line",
  " context",
  "```",
  "",
  "## Tests",
  "",
  "Passed (exit code 0). Last lines of the log:",
  "",
  "```",
  "      Tests  11 passed | 1 skipped (12)",
  "```",
  "",
  "## Review",
  "",
  "Verdict: PASS, risk: low.",
  "",
  "- `Small change.`",
  "",
].join("\n");

const report = (over: Partial<Report> = {}): Report => ({
  reportId: "report-task-1",
  taskId: "task-1",
  title: "Report: Validate todo titles",
  markdown: MARKDOWN,
  verdict: "pass",
  ts: Date.UTC(2026, 10, 11, 12, 0, 0),
  ...over,
});
const reportMsg = (r: Report, resend = false): ServerMsg => ({ type: "report", report: r, ...(resend ? { resend: true as const } : {}) });

describe("report facts", () => {
  it("reads task, change, tests, review and verdict from the report Markdown", () => {
    expect(reportFacts(MARKDOWN)).toEqual({
      task: "Reject empty titles in addTodo",
      change: "1 file changed, +3 -1.",
      tests: "Passed (exit code 0)",
      review: "Verdict: PASS, risk: low.",
      verdict: "pass",
    });
  });

  it("copes with a report that has no sections", () => {
    expect(reportFacts("just text")).toEqual({});
    expect(reportFacts("")).toEqual({});
  });

  it("the server verdict wins, the Summary is the fallback, and unknown stays unknown", () => {
    expect(reportVerdict({ verdict: "fail", markdown: MARKDOWN })).toBe("fail");
    expect(reportVerdict({ markdown: MARKDOWN })).toBe("pass");
    expect(reportVerdict({ markdown: "no summary" })).toBeUndefined();
  });

  it("names the task in the list, or the title when the report does not", () => {
    expect(reportHeadline(report())).toBe("Reject empty titles in addTodo");
    expect(reportHeadline(report({ markdown: "# x" }))).toBe("Report: Validate todo titles");
  });

  it("says PASS and FAIL in words and symbols", () => {
    expect(verdictText("pass")).toBe("✓ PASS");
    expect(verdictText("fail")).toBe("✗ FAIL");
    expect(verdictText(undefined)).toContain("No verdict");
  });

  it("orders reports newest first and keeps later arrivals first when there is no time", () => {
    const a = report({ reportId: "a", ts: 1 });
    const b = report({ reportId: "b", ts: 3 });
    const c = report({ reportId: "c", ts: 2 });
    expect(newestFirst([a, b, c]).map((r) => r.reportId)).toEqual(["b", "c", "a"]);
    const { ts: _t, ...x } = report({ reportId: "x" });
    const { ts: _u, ...y } = report({ reportId: "y" });
    expect(newestFirst([x, y]).map((r) => r.reportId)).toEqual(["y", "x"]);
  });
});

describe("report toast", () => {
  const unread = { reportId: "r1", verdict: "pass" as const };

  it("says the verdict in the text", () => {
    expect(reportToastText("pass")).toBe("Report ready: PASS");
    expect(reportToastText("fail")).toBe("Report ready: FAIL");
    expect(reportToastText(undefined)).toBe("Report ready");
  });

  it("shows while a report is unread and the mailbox is closed, with an Open report button", () => {
    expect(toastPlan({ pending: 0, openPanel: null, unreadReport: unread })).toEqual([{ kind: "report", text: "Report ready: PASS", action: "Open report" }]);
    expect(toastPlan({ pending: 0, openPanel: "board", unreadReport: unread })).toHaveLength(1);
  });

  it("hides when the mailbox is open or the report was opened, and comes back if the mailbox closes with it unread", () => {
    expect(toastPlan({ pending: 0, openPanel: "mailbox", unreadReport: unread })).toEqual([]);
    expect(toastPlan({ pending: 0, openPanel: null, unreadReport: undefined })).toEqual([]);
    expect(toastPlan({ pending: 0, openPanel: null, unreadReport: unread })).toHaveLength(1);
  });

  it("stacks the your-turn toast first when both apply", () => {
    const plan = toastPlan({ pending: 1, openPanel: null, unreadReport: unread });
    expect(plan.map((t) => t.kind)).toEqual(["your-turn", "report"]);
    expect(plan[0]?.text).toBe(YOUR_TURN_TEXT);
  });

  it("counts waiting approvals and unread reports in the tab title", () => {
    expect(tabTitle(0)).toBe("AGENT LIFE");
    expect(tabTitle(2)).toBe("(2) AGENT LIFE");
  });
});

describe("MailboxState and reports", () => {
  it("a delivered report is unread until it is opened in the viewer", () => {
    const m = new MailboxState();
    const msg = reportMsg(report());
    expect(m.isFresh(msg)).toBe(true);
    expect(m.apply(msg, null)).toBe(true);
    expect(m.unreadCount).toBe(1);
    expect(m.latestUnread()).toBe("report-task-1");
    expect(m.unseenReport).toBe(true);
    // Opening the mailbox clears the dot on the 3D mailbox, not the unread mark of the report.
    m.apply({ type: "open_panel", panel: "mailbox" }, null);
    expect(m.unseenReport).toBe(false);
    expect(m.unreadCount).toBe(1);
    expect(m.markRead("report-task-1")).toBe(true);
    expect(m.unreadCount).toBe(0);
    expect(m.markRead("report-task-1")).toBe(false);
  });

  it("a report sent again when the mailbox opens is not news and is not unread", () => {
    const m = new MailboxState();
    const again = reportMsg(report(), true);
    expect(m.isFresh(again)).toBe(false);
    m.apply(again, null);
    expect(m.unreadCount).toBe(0);
    // Once seen, the same report is not fresh any more even without the flag.
    expect(m.isFresh(reportMsg(report()))).toBe(false);
  });

  it("a report that arrives while the mailbox is open is still unread", () => {
    const m = new MailboxState();
    m.apply(reportMsg(report()), "mailbox");
    expect(m.unseenReport).toBe(false);
    expect(m.unreadCount).toBe(1);
  });

  it("forgets unread reports on welcome and when another job starts", () => {
    const m = new MailboxState();
    const job = (taskId: string): ServerMsg => ({ type: "job_update", job: { taskId, repoId: "r", goal: "g", state: "created", timeline: [] } });
    m.apply(job("task-1"), null);
    m.apply(reportMsg(report()), null);
    expect(m.unreadCount).toBe(1);
    m.apply(job("task-2"), null);
    expect(m.unreadCount).toBe(0);
    m.apply(reportMsg(report({ reportId: "r2", taskId: "task-2" })), null);
    m.apply({ type: "welcome", protocol: 1 } as unknown as ServerMsg, null);
    expect(m.unreadCount).toBe(0);
  });
});

describe("report viewer", () => {
  it("shows the verdict badge first, then the title, the facts and every section", () => {
    const root = renderReportViewer(fakeDoc(), report(), { back: () => undefined });
    const out = html(root);
    const badge = findAll(root, (e) => e.className === "al-badge")[0];
    expect(badge?.dataset["verdict"]).toBe("pass");
    expect(badge?.textContent).toBe("✓ PASS");
    // The badge comes before the title in the header.
    expect(out.indexOf("al-badge")).toBeLessThan(out.indexOf("Report: Validate todo titles"));
    const text = textOf(root);
    for (const part of ["Task: Reject empty titles in addTodo", "Change: 1 file changed, +3 -1.", "Tests: Passed (exit code 0)", "Review: Verdict: PASS, risk: low."]) {
      expect(text).toContain(part);
    }
    // Sections become headings (the Markdown renderer turns ## into h4).
    const headings = findAll(root, (e) => /^h\d$/.test(e.tagName)).map((e) => e.textContent);
    expect(headings).toEqual(expect.arrayContaining(["Summary", "Plan", "Change", "Tests", "Review"]));
  });

  it("colours the diff lines green and red", () => {
    const out = html(renderReportViewer(fakeDoc(), report(), { back: () => undefined }));
    expect(out).toContain("al-diff-add");
    expect(out).toContain("al-diff-del");
    expect(out).toContain("al-diff-hunk");
  });

  it("shows FAIL for a failed job", () => {
    const root = renderReportViewer(fakeDoc(), report({ verdict: "fail" }), { back: () => undefined });
    expect(findAll(root, (e) => e.className === "al-badge")[0]?.dataset["verdict"]).toBe("fail");
    expect(textOf(root)).toContain("✗ FAIL");
  });

  it("does not turn raw HTML in a report into elements", () => {
    const evil = '<img src=x onerror="alert(1)"> <script>boom()</script>';
    const md = `# ${evil}\n\n## Summary\n\n- **Task:** ${evil}\n\n${evil}\n\n\`\`\`diff\n+${evil}\n\`\`\`\n`;
    const out = html(renderReportViewer(fakeDoc(), report({ title: evil, markdown: md }), { back: () => undefined }));
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img");
  });

  it("has a way back to the mailbox", () => {
    let backs = 0;
    const root = renderReportViewer(fakeDoc(), report(), { back: () => void backs++ });
    findAll(root, (e) => e.tagName === "button")[0]?.click();
    expect(backs).toBe(1);
  });
});

describe("mailbox list", () => {
  const data = (reports: Report[]): PanelData => ({ repos: [], projects: [], job: null, approvals: [], reports, details: null });
  const actions = () => {
    const calls: string[] = [];
    return { calls, decide: () => undefined, openReport: (id: string) => calls.push(`open:${id}`), back: () => calls.push("back") };
  };

  it("lists reports newest first, each with badge, task title and time, and marks the unread ones", () => {
    const older = report({ reportId: "old", ts: Date.UTC(2026, 10, 11, 10, 0, 0), verdict: "fail", markdown: "# x", title: "Report: older goal" });
    const newer = report({ reportId: "new", ts: Date.UTC(2026, 10, 11, 12, 0, 0) });
    const a = actions();
    const root = renderMailbox(fakeDoc(), data([older, newer]), a, { reading: null, unread: new Set(["new"]) });
    const items = findAll(root, (e) => e.className === "al-report-item");
    expect(items.map((i) => i.dataset["report"])).toEqual(["new", "old"]);
    expect(items[0]?.dataset["unread"]).toBe("true");
    expect(items[1]?.dataset["unread"]).toBe("false");
    expect(textOf(items[0])).toContain("✓ PASS");
    expect(textOf(items[0])).toContain("Reject empty titles in addTodo");
    expect(textOf(items[0])).toContain("NEW");
    expect(textOf(items[0])).toMatch(/\d\d:\d\d:\d\d/);
    expect(textOf(items[1])).toContain("✗ FAIL");
    expect(textOf(items[1])).toContain("Report: older goal");
    expect(textOf(items[1])).not.toContain("NEW");
    items[1]?.click();
    expect(a.calls).toEqual(["open:old"]);
  });

  it("shows the viewer instead of the list for the report being read", () => {
    const root = renderMailbox(fakeDoc(), data([report()]), actions(), { reading: "report-task-1", unread: new Set() });
    expect(findAll(root, (e) => e.className === "al-report")).toHaveLength(1);
    expect(findAll(root, (e) => e.className === "al-report-item")).toHaveLength(0);
  });

  it("falls back to the list when the report being read is gone", () => {
    const root = renderMailbox(fakeDoc(), data([report()]), actions(), { reading: "missing", unread: new Set() });
    expect(findAll(root, (e) => e.className === "al-report-item")).toHaveLength(1);
  });

  it("says so when there are no reports", () => {
    expect(textOf(renderMailbox(fakeDoc(), data([]), actions()))).toContain("No reports yet.");
  });
});

describe("report flow end to end (state only)", () => {
  it("report.ready: unread count, toast with the verdict, then read after opening", () => {
    const mailbox = new MailboxState();
    const panels = new PanelState();
    const msg = reportMsg(report());
    const fresh = mailbox.isFresh(msg);
    mailbox.apply(msg, panels.open);
    panels.apply(msg);
    expect(fresh).toBe(true);
    expect(mailbox.unreadCount).toBe(1);
    const id = mailbox.latestUnread()!;
    const r = panels.data.reports.find((x) => x.reportId === id)!;
    const plan = toastPlan({ pending: mailbox.pendingCount, openPanel: panels.open, unreadReport: { reportId: r.reportId, verdict: reportVerdict(r) } });
    expect(plan).toEqual([{ kind: "report", text: "Report ready: PASS", action: "Open report" }]);

    // "Open report": the mailbox opens with the report in the viewer.
    panels.apply({ type: "open_panel", panel: "mailbox" });
    panels.view(id);
    mailbox.markRead(id);
    expect(mailbox.unreadCount).toBe(0);
    expect(toastPlan({ pending: 0, openPanel: panels.open, unreadReport: undefined })).toEqual([]);
    const viewer = renderMailbox(fakeDoc(), panels.data, { decide: () => undefined, openReport: () => undefined, back: () => undefined }, { reading: panels.viewing, unread: mailbox.unreadIds() });
    const out = html(viewer);
    expect(out).toContain('data-verdict="pass"');
    expect(out).toContain("al-diff-add");
    expect(out).not.toContain("<script");
  });
});

describe("mailbox attention", () => {
  it("is active for a few seconds after the report and never before it", () => {
    expect(attentionActive(1_000, null)).toBe(false);
    expect(attentionActive(999, 1_000)).toBe(false);
    expect(attentionActive(1_000, 1_000)).toBe(true);
    expect(attentionActive(1_000 + ATTENTION_MS - 1, 1_000)).toBe(true);
    expect(attentionActive(1_000 + ATTENTION_MS, 1_000)).toBe(false);
  });

  it("glows brighter than the normal pulse and bounces upwards", () => {
    for (let t = 1_000; t < 1_000 + ATTENTION_MS; t += 137) {
      const a = attentionAlpha(t, 1_000, false)!;
      expect(a).toBeGreaterThanOrEqual(0.6);
      expect(a).toBeLessThanOrEqual(0.95);
      expect(a).toBeGreaterThan(glowAlpha(t, false, false) - 0.0001);
      expect(attentionLift(t, 1_000, false)).toBeLessThanOrEqual(0);
    }
    expect(attentionAlpha(1_000 + ATTENTION_MS, 1_000, false)).toBeUndefined();
    expect(attentionLift(1_000 + ATTENTION_MS, 1_000, false)).toBe(0);
  });

  it("under reduced motion the glow is steady and nothing moves", () => {
    expect(attentionAlpha(2_000, 1_000, true)).toBe(0.95);
    expect(attentionAlpha(2_345, 1_000, true)).toBe(0.95);
    expect(attentionLift(2_345, 1_000, true)).toBe(0);
  });
});
