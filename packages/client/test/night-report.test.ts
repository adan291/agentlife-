import { describe, expect, it } from "vitest";
import type { Report } from "@agentlife/shared";
import { renderMailbox } from "../src/ui/mailbox.ts";
import type { PanelData } from "../src/ui/panel-state.ts";
import { renderReportViewer, reportBadge } from "../src/ui/report-viewer.ts";
import { reportToastText, toastPlan } from "../src/ui/toast.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const NIGHT: Report = {
  reportId: "night-2026-11-12",
  taskId: "night-2026-11-12",
  title: "Morning summary 2026-11-12",
  markdown: "# Morning summary 2026-11-12\n\n2 jobs: 1 done, 1 waiting for you.\n\n## Jobs\n\n- demo, Dependency audit: Audit dependencies. done (pass), 3 min.\n",
  ts: 1000,
  kind: "night",
};

const JOB: Report = { reportId: "r1", taskId: "t1", title: "Report", markdown: "## Summary\n\n- Task: Fix it\n- Verdict: PASS\n", verdict: "pass", ts: 500 };

const data = (reports: Report[]): PanelData => ({ repos: [], projects: [], job: null, approvals: [], reports, details: null });
const actions = { decide: () => {}, openReport: () => {}, back: () => {} };

describe("morning summary in the mailbox", () => {
  it("has a Night badge instead of a verdict", () => {
    expect(textOf(reportBadge(fakeDoc(), NIGHT))).toBe("☾ Night");
    expect(textOf(reportBadge(fakeDoc(), JOB))).toBe("✓ PASS");
    expect(reportBadge(fakeDoc(), NIGHT).dataset["verdict"]).toBe("night");
  });

  it("lists it with the title and the badge, next to job reports", () => {
    const root = renderMailbox(fakeDoc(), data([JOB, NIGHT]), actions, { reading: null, unread: new Set([NIGHT.reportId]) });
    const items = findAll(root, (e) => e.className === "al-report-item");
    expect(items.map((i) => i.dataset["report"])).toEqual(["night-2026-11-12", "r1"]);
    expect(textOf(items[0]!)).toContain("☾ Night");
    expect(textOf(items[0]!)).toContain("Morning summary 2026-11-12");
    expect(items[0]?.dataset["unread"]).toBe("true");
    expect(textOf(items[1]!)).toContain("Fix it");
  });

  it("opens in the viewer with its text and no delivery or verdict", () => {
    const root = renderReportViewer(fakeDoc(), NIGHT, { back: () => {} });
    const text = textOf(root);
    expect(text).toContain("☾ Night");
    expect(text).toContain("2 jobs: 1 done, 1 waiting for you.");
    expect(text).not.toContain("No verdict");
    expect(findAll(root, (e) => e.className.includes("al-delivery"))).toHaveLength(0);
  });

  it("announces itself with its own toast text", () => {
    expect(reportToastText(undefined, true)).toBe("Your morning summary is ready");
    expect(reportToastText("pass")).toBe("Report ready: PASS");
    const plan = toastPlan({ pending: 0, openPanel: null, unreadReport: { reportId: NIGHT.reportId, verdict: undefined, night: true } });
    expect(plan).toEqual([{ kind: "report", text: "Your morning summary is ready", action: "Open report" }]);
  });
});
