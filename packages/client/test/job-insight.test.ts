import { describe, expect, it } from "vitest";
import type { ActivityLine, AgentWork, ArtifactView, JobDetails, JobView, ServerMsg, StepRecord, WelcomeMsg } from "@agentlife/shared";
import { renderArtifact, stripAnsi } from "../src/ui/artifact-viewer.ts";
import { CREDITS_LINE, chosenTask, documentLinks, renderJobPanel, stepRows } from "../src/ui/job-panel.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { TeamModel } from "../src/ui/team-bar.ts";
import { collapsedSummary, formatLine } from "../src/ui/terminal.ts";
import { agentTooltip } from "../src/ui/tooltip.ts";
import { WorkModel, filesText, lineTag, taskTag, workTooltipLines, workView, workVisible } from "../src/ui/work.ts";
import { fakeDoc, findAll, html, textOf } from "./fake-dom.ts";

const work = (over: Partial<AgentWork> = {}): AgentWork => ({
  taskId: "task-d232d369",
  step: "develop",
  title: "Fix isOverdue",
  model: "claude-test",
  contextPct: 24.4,
  filesRead: 2,
  filesEdited: 1,
  startedAt: 1_000,
  ...over,
});

const welcome = (agents: WelcomeMsg["agents"] = []): ServerMsg =>
  ({ type: "welcome", protocol: 1, room: {}, you: 1, avatars: [], agents }) as unknown as ServerMsg;

describe("task tags", () => {
  it("shortens a task id to # and four characters", () => {
    expect(taskTag("task-d232d369")).toBe("#d232");
    expect(taskTag("task-1")).toBe("#1");
  });
  it("gives nothing for Builder sessions and missing ids", () => {
    expect(taskTag("build:S9")).toBe("");
    expect(taskTag(undefined)).toBe("");
    expect(taskTag("task-")).toBe("");
  });
  it("adds the step when the line has one", () => {
    expect(lineTag({ taskId: "task-d232d369", step: "develop" })).toBe("#d232 develop");
    expect(lineTag({ taskId: "task-d232d369" })).toBe("#d232");
    expect(lineTag({ taskId: "build:S9", step: "develop" })).toBe("");
  });
});

describe("terminal lines carry the job and the step", () => {
  const line: ActivityLine = { ts: Date.UTC(2026, 0, 1, 10, 0, 5), agentId: "developer", text: "Patch ready", taskId: "task-d232d369", step: "develop" };

  it("formatLine and the collapsed summary include the tag", () => {
    expect(formatLine(line).tag).toBe("#d232 develop");
    expect(collapsedSummary(line)).toContain("Developer  #d232 develop  Patch ready");
  });
  it("a line without a job has no tag and no extra spaces", () => {
    const plain: ActivityLine = { ts: line.ts, agentId: "builder", text: "Started S9", taskId: "build:S9" };
    expect(formatLine(plain).tag).toBe("");
    expect(collapsedSummary(plain)).toMatch(/Builder  Started S9$/);
  });
  it("two jobs give different tags", () => {
    expect(lineTag({ taskId: "task-aaaa1111" })).not.toBe(lineTag({ taskId: "task-bbbb2222" }));
  });
});

describe("WorkModel", () => {
  it("keeps the work of a welcome, replaces it on work messages and forgets an agent that goes home", () => {
    const m = new WorkModel();
    expect(m.apply(welcome([{ agentId: "developer", state: "working", work: work() }]))).toBe(true);
    expect(m.get("developer")?.title).toBe("Fix isOverdue");
    expect(m.apply({ type: "work", agentId: "developer", work: work({ filesRead: 5 }) })).toBe(true);
    expect(m.get("developer")?.filesRead).toBe(5);
    expect(m.apply({ type: "agent_state", agentId: "developer", state: "done" })).toBe(false);
    expect(m.get("developer")).toBeDefined();
    expect(m.apply({ type: "agent_state", agentId: "developer", state: "idle" })).toBe(true);
    expect(m.get("developer")).toBeUndefined();
    expect(m.apply({ type: "agent_state", agentId: "qa", state: "idle" })).toBe(false);
  });

  it("a welcome without work clears what was there", () => {
    const m = new WorkModel();
    m.apply({ type: "work", agentId: "qa", work: work({ step: "review" }) });
    expect(m.apply(welcome([{ agentId: "qa", state: "idle" }]))).toBe(true);
    expect(m.get("qa")).toBeUndefined();
  });
});

describe("work block", () => {
  it("shows for busy states only", () => {
    for (const s of ["working", "thinking", "error", "blocked", "walking"] as const) expect(workVisible(s)).toBe(true);
    for (const s of ["idle", "done", "waiting_approval", undefined] as const) expect(workVisible(s)).toBe(false);
  });

  it("formats title, step, elapsed time, context and file counts", () => {
    const v = workView(work(), 13_400);
    expect(v).toMatchObject({ title: "Fix isOverdue", step: "develop", elapsed: "12s", context: 24.4, contextText: "24%", files: "2 read · 1 edited", model: "claude-test" });
    expect(workView(work({ startedAt: 50_000 }), 1_000).elapsed).toBe("0.0s"); // clock skew never goes negative
  });

  it("says n/a when the runtime reports no context", () => {
    const { contextPct: _drop, ...noCtx } = work();
    const v = workView(noCtx, 2_000);
    expect(v.contextText).toBe("n/a");
    expect(v.context).toBeUndefined();
  });

  it("counts read and edited files", () => {
    expect(filesText(0, 0)).toBe("0 read · 0 edited");
    expect(filesText(12, 3)).toBe("12 read · 3 edited");
  });

  it("the team model offers the work only while the agent is busy", () => {
    const t = new TeamModel(0);
    t.apply({ type: "agent_state", agentId: "developer", state: "working", text: "Editing files" }, 10);
    t.apply({ type: "work", agentId: "developer", work: work() }, 10);
    expect(t.workOf("developer")?.title).toBe("Fix isOverdue");
    t.apply({ type: "agent_state", agentId: "developer", state: "done" }, 20);
    expect(t.workOf("developer")).toBeUndefined();
    expect(t.workOf("qa")).toBeUndefined();
  });

  it("a work message alone changes the team model", () => {
    const t = new TeamModel(0);
    expect(t.apply({ type: "work", agentId: "architect", work: work({ step: "analyze" }) })).toBe(true);
  });
});

describe("agent tooltip shows the work", () => {
  it("adds task, step, context and files while the agent is busy", () => {
    const tip = agentTooltip("developer", "working", "Editing files", "claude-test", work(), 13_400);
    expect(tip.lines).toEqual([
      "Implements the approved task in an isolated copy",
      "State: working - Editing files",
      "Model: claude-test",
      ...workTooltipLines(work(), 13_400),
    ]);
    expect(tip.lines).toContain("Working on: Fix isOverdue");
    expect(tip.lines).toContain("Step: develop · 12s · claude-test");
    expect(tip.lines).toContain("Context: 24%");
    expect(tip.lines).toContain("Files: 2 read · 1 edited");
  });

  it("leaves the work out when the agent is not busy", () => {
    const idle = agentTooltip("developer", "idle", undefined, undefined, work());
    expect(idle.lines).toHaveLength(2);
    expect(idle.lines.join("\n")).not.toContain("Working on");
    expect(agentTooltip("developer", "done", "Patch ready", undefined, work()).lines.join("\n")).not.toContain("Working on");
  });
});

const step = (over: Partial<StepRecord>): StepRecord => ({ step: "analyze", startedAt: 1_000, status: "ok", ...over });

describe("steps table rows", () => {
  it("maps agent, model, status, time, context and files, with a dash for what is unknown", () => {
    const rows = stepRows([
      step({ step: "analyze", durationMs: 25_000, model: "m1", contextPeak: 31.6, filesRead: 7, filesEdited: 0 }),
      step({ step: "test", durationMs: 1_400 }),
    ]);
    expect(rows[0]).toEqual({ agent: "Architect", step: "analyze", model: "m1", status: "✓ ok", duration: "25s", context: "32%", files: "7 read · 0 edited", attempt: 1 });
    expect(rows[1]).toMatchObject({ agent: "QA", model: "—", context: "—", files: "—", duration: "1.4s" });
  });

  it("numbers the attempts of a repeated step", () => {
    const rows = stepRows([step({ step: "develop" }), step({ step: "test" }), step({ step: "develop" }), step({ step: "test" })]);
    expect(rows.map((r) => `${r.step}${r.attempt}`)).toEqual(["develop1", "test1", "develop2", "test2"]);
  });

  it("shows the running time of a step that has not ended and the failed status", () => {
    const rows = stepRows([step({ status: "running", startedAt: 1_000 }), step({ status: "failed", durationMs: 100 })], 6_000);
    expect(rows[0]).toMatchObject({ status: "… running", duration: "5.0s" });
    expect(rows[1]?.status).toBe("✗ failed");
  });
});

const PLAN = {
  tasks: [
    { id: "t1", title: "Fix isOverdue", why: "Off by one", files: ["src/todo.ts"], acceptance: "All tests pass", risk: "low" },
    { id: "t2", title: "Second", why: "w", files: [], acceptance: "a", risk: "low" },
  ],
};
const art = (kind: string, title: string, content: string, id = `a-${kind}`): ArtifactView => ({ artifactId: id, kind, title, content, truncated: false });
const details = (over: Partial<JobDetails> = {}): JobDetails => ({
  job: {
    taskId: "task-1",
    repoId: "haunted-todo",
    goal: "Fix the overdue bug",
    state: "delivered",
    steps: [step({ step: "analyze", durationMs: 25_000, model: "m1" })],
    approvals: [],
    artifacts: [],
    branch: "agentlife/task-1",
  },
  artifacts: [art("plan", "Plan", JSON.stringify(PLAN)), art("diff", "Patch (attempt 1)", "--- a\n+++ b\n-old\n+new\n"), art("report", "Report: Fix", "# Report\n\n**PASS**")],
  ...over,
});
const jobView = (): JobView => ({ taskId: "task-1", repoId: "haunted-todo", goal: "Fix the overdue bug", state: "delivered", timeline: [{ ts: 1_000, state: "created" }] });

describe("job card data", () => {
  it("takes the first plan task as the chosen one", () => {
    expect(chosenTask(details())?.title).toBe("Fix isOverdue");
    expect(chosenTask(null)).toBeUndefined();
    expect(chosenTask(details({ artifacts: [art("plan", "Plan", "not json")] }))).toBeUndefined();
  });

  it("lists a link per document in the order the job made them", () => {
    expect(documentLinks(details()).map((l) => [l.kind, l.label])).toEqual([
      ["plan", "Plan"],
      ["diff", "Patch (attempt 1)"],
      ["report", "Report: Fix"],
    ]);
    expect(documentLinks(null)).toEqual([]);
  });
});

describe("PanelState and the job card", () => {
  const detailsMsg = (taskId = "task-1"): ServerMsg => ({ type: "job_details", details: details({ job: { ...details().job, taskId } }) });
  const jobMsg = (taskId: string): ServerMsg => ({ type: "job_update", job: { ...jobView(), taskId } });

  it("stores the details of the current job and drops those of another job", () => {
    const s = new PanelState();
    s.apply(jobMsg("task-1"));
    expect(s.apply(detailsMsg("task-1"))).toBe(true);
    expect(s.data.details?.job.taskId).toBe("task-1");
    expect(s.apply(detailsMsg("task-9"))).toBe(false);
    expect(s.data.details?.job.taskId).toBe("task-1");
  });

  it("forgets the details and the open document when a new job starts", () => {
    const s = new PanelState();
    s.apply(jobMsg("task-1"));
    s.apply(detailsMsg());
    s.view("a-diff");
    s.apply(jobMsg("task-2"));
    expect(s.data.details).toBeNull();
    expect(s.viewing).toBeNull();
  });

  it("opens and closes the viewer, and closing the panel leaves it", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "board" });
    s.view("a-diff");
    expect(s.viewing).toBe("a-diff");
    s.back();
    expect(s.viewing).toBeNull();
    s.view("a-diff");
    s.close();
    expect(s.viewing).toBeNull();
    s.view("a-diff");
    s.apply({ type: "open_panel", panel: "board" });
    expect(s.viewing).toBeNull();
  });
});

describe("job panel", () => {
  const actions = () => {
    const calls: string[] = [];
    return { calls, view: (id: string) => calls.push(`view:${id}`), back: () => calls.push("back") };
  };
  const data = (d: JobDetails | null) => ({ repos: [], projects: [], job: jobView(), approvals: [], reports: [], details: d });

  it("says so when there is no job", () => {
    const root = renderJobPanel(fakeDoc(), { repos: [], projects: [], job: null, approvals: [], reports: [], details: null }, null, actions());
    expect(textOf(root)).toContain("No job yet");
  });

  it("shows goal, task, acceptance, repository, branch, state, steps, documents and the credits line", () => {
    const a = actions();
    const root = renderJobPanel(fakeDoc(), data(details()), null, a, 10_000);
    const text = textOf(root);
    for (const part of ["Fix the overdue bug", "Fix isOverdue", "All tests pass", "haunted-todo", "agentlife/task-1", "delivered", "Architect", "m1", "25s"]) {
      expect(text).toContain(part);
    }
    expect(text).toContain(CREDITS_LINE);
    expect(CREDITS_LINE).toBe("Credits: not reported by kiro-cli headless; see the Kiro usage panel");
    // No credit number anywhere.
    expect(text).not.toMatch(/\d+(\.\d+)? credits/i);
    const buttons = findAll(root, (e) => e.tagName === "button" && e.dataset["artifact"] !== undefined);
    expect(buttons.map((b) => b.textContent)).toEqual(["Plan", "Patch (attempt 1)", "Report: Fix"]);
    buttons[1]?.click();
    expect(a.calls).toEqual(["view:a-diff"]);
  });

  it("shows a loading line until the details arrive", () => {
    const root = renderJobPanel(fakeDoc(), data(null), null, actions());
    expect(textOf(root)).toContain("Loading details");
    expect(textOf(root)).toContain("Fix the overdue bug");
    expect(textOf(root)).toContain(CREDITS_LINE);
  });

  it("opens a document in the viewer with a way back", () => {
    const a = actions();
    const root = renderJobPanel(fakeDoc(), data(details()), "a-diff", a);
    const rendered = html(root);
    expect(rendered).toContain("al-diff-add");
    expect(rendered).toContain("al-diff-del");
    expect(textOf(root)).not.toContain("Credits");
    findAll(root, (e) => e.tagName === "button")[0]?.click();
    expect(a.calls).toEqual(["back"]);
  });

  it("falls back to the card when the document is not there", () => {
    expect(textOf(renderJobPanel(fakeDoc(), data(details()), "missing", actions()))).toContain("Fix the overdue bug");
  });
});

describe("artifact viewer", () => {
  it("never turns document text into elements", () => {
    const evil = '<img src=x onerror="alert(1)"> <script>boom()</script>';
    for (const kind of ["plan", "diff", "test_log", "review", "report", "other"]) {
      const out = html(renderArtifact(fakeDoc(), art(kind, "T", evil)));
      expect(out, kind).not.toContain("<img");
      expect(out, kind).not.toContain("<script");
    }
  });

  it("renders a plan and a review as lists", () => {
    expect(textOf(renderArtifact(fakeDoc(), art("plan", "Plan", JSON.stringify(PLAN))))).toContain("Acceptance: All tests pass");
    const review = renderArtifact(fakeDoc(), art("review", "R", JSON.stringify({ verdict: "pass", notes: ["Small change"], risk: "low" })));
    expect(textOf(review)).toContain("Verdict: PASS");
    expect(textOf(review)).toContain("Small change");
  });

  it("strips terminal colour codes from test logs", () => {
    expect(stripAnsi("\u001b[32m8 passed\u001b[39m")).toBe("8 passed");
    expect(textOf(renderArtifact(fakeDoc(), art("test_log", "L", "\u001b[1mTests\u001b[22m 8 passed")))).toBe("Tests 8 passed");
  });

  it("says when a document was cut", () => {
    const cut: ArtifactView = { ...art("test_log", "L", "x"), truncated: true };
    expect(textOf(renderArtifact(fakeDoc(), cut))).toContain("Shown in part");
  });
});
