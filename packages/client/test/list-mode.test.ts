import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMsgSchema } from "@agentlife/shared";
import type { ClientMsg, JobKind, JobState, OverviewFloor, ServerMsg, FloorStatus } from "@agentlife/shared";
import { MOVE_TIMEOUT_MS, approveMessage, createNavigator, deliverMessage, goToMessage, showPanelMessage, startJobMessage } from "../src/ui/actions.ts";
import { buildCommands } from "../src/ui/commands.ts";
import { createComputerPanel } from "../src/ui/computer.ts";
import { createKindPanel } from "../src/ui/kind-forms.ts";
import { createListActions } from "../src/ui/list-actions.ts";
import { JOB_CHOICES, ago, jobLine, nightCount, reportLine, sortFloors, statusLine, stepsOf, waitingBadge } from "../src/ui/list-model.ts";
import { createListView, renderList } from "../src/ui/list-view.ts";
import type { ListActions, ListData } from "../src/ui/list-view.ts";
import { renderMailbox } from "../src/ui/mailbox.ts";
import type { PanelData } from "../src/ui/panel-state.ts";
import { inTextField, isPaletteKey, isViewKey, loadView, otherView, saveView } from "../src/ui/view-mode.ts";
import { FakeDocument, fakeDoc, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const T0 = 1_700_000_000_000;

function floor(over: Partial<OverviewFloor> & { states?: [JobState, number][]; kind?: JobKind; target?: string } = {}): OverviewFloor {
  const { states, kind, target, ...rest } = over;
  const base: OverviewFloor = { roomId: "project:alpha", projectId: "alpha", name: "ALPHA", status: "idle", waiting: 0 };
  const job = states
    ? {
        taskId: "task-1",
        ...(kind ? { kind } : {}),
        ...(target ? { target } : {}),
        state: states.at(-1)![0],
        startedAt: T0 + states[0]![1],
        timeline: states.map(([state, at]) => ({ ts: T0 + at, state })),
      }
    : undefined;
  return { ...base, ...(job ? { job } : {}), ...rest };
}

const welcome = (roomId: string): ServerMsg => ({ type: "welcome", roomId }) as unknown as ServerMsg;

// ---- message builders ----

describe("message builders", () => {
  it("build messages the protocol accepts", () => {
    const msgs: ClientMsg[] = [
      startJobMessage("alpha", "Add a check"),
      startJobMessage("alpha", "Review branch x", "review-branch", "x"),
      approveMessage("ap1", "approve"),
      deliverMessage("task-1"),
      goToMessage("project:alpha"),
      goToMessage("project:alpha", "list"),
      showPanelMessage("mailbox"),
    ];
    for (const m of msgs) expect(ClientMsgSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
  });

  it("a change has no kind and no target, as the Computer panel sends it", () => {
    expect(startJobMessage("alpha", "g")).toEqual({ type: "start_job", repoId: "alpha", goal: "g" });
    expect(startJobMessage("alpha", "g", "change")).toEqual({ type: "start_job", repoId: "alpha", goal: "g" });
    expect(startJobMessage("alpha", "g", "write-tests", "src/a.ts")).toEqual({ type: "start_job", repoId: "alpha", goal: "g", kind: "write-tests", target: "src/a.ts" });
  });

  it("go_to from the elevator has no `via`; from the list it says so", () => {
    expect(goToMessage("lobby")).toEqual({ type: "go_to", roomId: "lobby" });
    expect(goToMessage("lobby", "list")).toEqual({ type: "go_to", roomId: "lobby", via: "list" });
  });
});

describe("the hotel panels send what the builders build", () => {
  const data = (over: Partial<PanelData> = {}): PanelData => ({
    repos: [{ id: "alpha", name: "ALPHA" }],
    branches: { current: "main", branches: ["main", "feature/x"] },
    projects: [],
    job: null,
    approvals: [],
    reports: [],
    details: null,
    ...over,
  });

  it("the Computer panel: Start job", () => {
    const sent: ClientMsg[] = [];
    const panel = createComputerPanel(fakeDoc(), { startJob: (repoId, goal) => sent.push(startJobMessage(repoId, goal)) });
    const content = panel(data(), null);
    findAll(content.body, (e) => e.tagName === "textarea")[0]!.value = "Add a check";
    (content.footer as unknown as FakeElement).click();
    expect(sent).toEqual([{ type: "start_job", repoId: "alpha", goal: "Add a check" }]);
  });

  it("the test lab: Write tests", () => {
    const sent: ClientMsg[] = [];
    const render = createKindPanel(fakeDoc(), "write-tests", { startJob: (repoId, goal, kind, target) => sent.push(startJobMessage(repoId, goal, kind, target)) });
    const content = render(data(), null);
    findAll(content.body, (e) => e.tagName === "input")[0]!.value = "src/todo.ts";
    (content.footer as unknown as FakeElement).click();
    expect(sent).toEqual([{ type: "start_job", repoId: "alpha", goal: "Write tests for src/todo.ts", kind: "write-tests", target: "src/todo.ts" }]);
  });

  it("the mailbox: Approve and Reject", () => {
    const sent: ClientMsg[] = [];
    const root = renderMailbox(
      fakeDoc(),
      data({ approvals: [{ approvalId: "ap1", taskId: "task-1", kind: "plan", summary: "The plan", status: "pending" }] }),
      {
        decide: (id, decision) => sent.push(approveMessage(id, decision)),
        openReport: () => undefined,
        deliver: (taskId) => sent.push(deliverMessage(taskId)),
        back: () => undefined,
      },
    );
    for (const name of ["Approve", "Reject"]) findAll(root, (e) => e.tagName === "button" && textOf(e) === name)[0]!.click();
    expect(sent).toEqual([
      { type: "approve", approvalId: "ap1", decision: "approve" },
      { type: "approve", approvalId: "ap1", decision: "reject" },
    ]);
  });

  it("panels.ts builds its messages with the shared builders, not by hand", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui", "panels.ts"), "utf8");
    for (const type of ["start_job", "approve", "deliver"]) expect(source, type).not.toContain(`type: "${type}"`);
    expect(source).toContain("startJobMessage(");
    expect(source).toContain("approveMessage(");
    expect(source).toContain("deliverMessage(");
  });
});

// ---- move then act ----

describe("navigator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness() {
    const sent: ClientMsg[] = [];
    const toasts: string[] = [];
    const nav = createNavigator({ send: (m) => sent.push(m), toast: (t) => toasts.push(t) });
    return { nav, sent, toasts };
  }

  it("runs at once when the user is already on the floor", () => {
    const { nav, sent } = harness();
    nav.handle(welcome("project:alpha"));
    const ran = vi.fn();
    nav.act("project:alpha", ran);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    expect(nav.pending).toBe(false);
  });

  it("goes there first with `via: list` and runs when the welcome of that floor arrives", () => {
    const { nav, sent } = harness();
    nav.handle(welcome("lobby"));
    const ran = vi.fn();
    nav.act("project:alpha", ran);
    expect(sent).toEqual([{ type: "go_to", roomId: "project:alpha", via: "list" }]);
    expect(ran).not.toHaveBeenCalled();
    expect(nav.pending).toBe(true);
    nav.handle(welcome("hr")); // another floor's welcome does not count
    expect(ran).not.toHaveBeenCalled();
    nav.handle(welcome("project:alpha"));
    expect(ran).toHaveBeenCalledTimes(1);
    expect(nav.pending).toBe(false);
  });

  it("waits for the data that follows the welcome", () => {
    const { nav } = harness();
    nav.handle(welcome("lobby"));
    let ready = false;
    const ran = vi.fn();
    nav.act("project:alpha", ran, () => ready);
    nav.handle(welcome("project:alpha"));
    expect(ran).not.toHaveBeenCalled();
    ready = true;
    nav.handle({ type: "error", code: "busy", message: "x" } as ServerMsg);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("tells the user when the move takes too long, and does not run later", () => {
    const { nav, toasts } = harness();
    nav.handle(welcome("lobby"));
    const ran = vi.fn();
    nav.act("project:alpha", ran);
    vi.advanceTimersByTime(MOVE_TIMEOUT_MS + 1);
    expect(toasts).toEqual(["That took too long. Try again."]);
    nav.handle(welcome("project:alpha"));
    expect(ran).not.toHaveBeenCalled();
  });

  it("drops the request when the server refuses the move", () => {
    const { nav, toasts } = harness();
    nav.handle(welcome("lobby"));
    const ran = vi.fn();
    nav.act("project:gone", ran);
    nav.handle({ type: "error", code: "bad_message", message: "unknown floor" } as ServerMsg);
    expect(nav.pending).toBe(false);
    vi.advanceTimersByTime(MOVE_TIMEOUT_MS + 1);
    expect(toasts).toEqual([]);
    expect(ran).not.toHaveBeenCalled();
  });

  it("a newer request replaces the one that waits", () => {
    const { nav } = harness();
    nav.handle(welcome("lobby"));
    const first = vi.fn();
    const second = vi.fn();
    nav.act("project:alpha", first);
    nav.act("project:beta", second);
    nav.handle(welcome("project:alpha"));
    expect(first).not.toHaveBeenCalled();
    nav.handle(welcome("project:beta"));
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("list actions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function harness(opts: { reports?: Set<string> } = {}) {
    const sent: ClientMsg[] = [];
    const opened: string[] = [];
    let hotel = 0;
    const reports = opts.reports ?? new Set<string>();
    const nav = createNavigator({ send: (m) => sent.push(m), toast: () => undefined });
    const actions = createListActions({
      navigator: nav,
      send: (m) => sent.push(m),
      hasReport: (id) => reports.has(id),
      openReport: (id) => opened.push(id),
      showHotel: () => void (hotel += 1),
    });
    return { nav, sent, opened, actions, reports, hotel: () => hotel };
  }

  it("a new job on the user's own floor opens the form of its kind without moving", () => {
    const { nav, sent, actions } = harness();
    nav.handle(welcome("project:alpha"));
    const panels = Object.fromEntries(JOB_CHOICES.map((c) => [c.kind, c.panel]));
    expect(panels).toEqual({ change: "computer", "review-branch": "review", "write-tests": "tests", document: "library" });
    for (const choice of JOB_CHOICES) actions.newJob("project:alpha", choice);
    expect(sent).toEqual(JOB_CHOICES.map((c) => ({ type: "show_panel", panel: c.panel })));
  });

  it("on another floor the move comes first, then the same panel message", () => {
    const { nav, sent, actions } = harness();
    nav.handle(welcome("lobby"));
    actions.newJob("project:alpha", JOB_CHOICES[0]!);
    expect(sent).toEqual([{ type: "go_to", roomId: "project:alpha", via: "list" }]);
    nav.handle(welcome("project:alpha"));
    expect(sent).toEqual([
      { type: "go_to", roomId: "project:alpha", via: "list" },
      { type: "show_panel", panel: "computer" },
    ]);
  });

  it("review plan opens the mailbox of the floor, job card opens the board, night goes to the lobby", () => {
    const { nav, sent, actions } = harness();
    nav.handle(welcome("project:alpha"));
    actions.reviewPlan("project:alpha");
    actions.openJobCard("project:alpha");
    expect(sent).toEqual([
      { type: "show_panel", panel: "mailbox" },
      { type: "show_panel", panel: "board" },
    ]);
    sent.length = 0;
    actions.scheduleNight();
    expect(sent).toEqual([{ type: "go_to", roomId: "lobby", via: "list" }]);
    nav.handle(welcome("lobby"));
    expect(sent.at(-1)).toEqual({ type: "show_panel", panel: "night" });
  });

  it("open report opens the mailbox, then the report once the floor has sent it", () => {
    const { nav, sent, opened, actions, reports } = harness();
    nav.handle(welcome("lobby"));
    actions.openReport("project:alpha", "r1");
    nav.handle(welcome("project:alpha"));
    expect(sent.at(-1)).toEqual({ type: "show_panel", panel: "mailbox" });
    expect(opened).toEqual([]);
    reports.add("r1");
    nav.handle({ type: "open_panel", panel: "mailbox" } as ServerMsg);
    expect(opened).toEqual(["r1"]);
  });

  it("go to a floor returns to the hotel view and moves", () => {
    const { nav, sent, actions, hotel } = harness();
    nav.handle(welcome("lobby"));
    actions.goTo("project:alpha");
    expect(hotel()).toBe(1);
    expect(sent).toEqual([{ type: "go_to", roomId: "project:alpha", via: "list" }]);
  });
});

// ---- commands ----

describe("commands", () => {
  const floors: FloorStatus[] = [
    { roomId: "lobby", name: "Lobby", kind: "lobby", status: "idle" },
    { roomId: "hr", name: "HR office", kind: "hr", status: "idle" },
    { roomId: "project:alpha", name: "ALPHA", kind: "project", status: "idle" },
    { roomId: "project:beta", name: "BETA", kind: "project", status: "idle" },
  ];
  const overview: OverviewFloor[] = [
    floor({ roomId: "project:alpha", projectId: "alpha", name: "ALPHA", waiting: 1, status: "waiting_approval", lastReport: { reportId: "r1", taskId: "t1", verdict: "pass", at: T0 } }),
    floor({ roomId: "project:beta", projectId: "beta", name: "BETA" }),
  ];

  function recorder() {
    const calls: string[] = [];
    const actions: ListActions = {
      newJob: (roomId, choice) => void calls.push(`new ${choice.kind} ${roomId}`),
      reviewPlan: (roomId) => void calls.push(`plan ${roomId}`),
      openReport: (roomId, id) => void calls.push(`report ${roomId} ${id}`),
      openJobCard: (roomId) => void calls.push(`card ${roomId}`),
      goTo: (roomId) => void calls.push(`go ${roomId}`),
      scheduleNight: () => void calls.push("night"),
    };
    return { calls, actions };
  }

  it("offers the commands of the requirement, for the projects that need them", () => {
    const { actions } = recorder();
    const titles = buildCommands({ floors: overview, hotelFloors: floors, live: true, actions, toggleView: () => undefined }).map((c) => c.title);
    expect(titles).toContain("New change job in ALPHA");
    expect(titles).toContain("New branch review job in BETA");
    expect(titles).toContain("New test-writing job in ALPHA");
    expect(titles).toContain("New documentation job in BETA");
    expect(titles).toContain("Approve plan in ALPHA");
    expect(titles).not.toContain("Approve plan in BETA");
    expect(titles).toContain("Open report of ALPHA");
    expect(titles).not.toContain("Open report of BETA");
    for (const f of floors) expect(titles).toContain(`Go to ${f.name}`);
    expect(titles).toContain("Schedule night job");
    expect(titles.at(-1)).toBe("Toggle view");
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("puts what waits for the user first, and shows the shortcut of Toggle view", () => {
    const { actions } = recorder();
    const commands = buildCommands({ floors: overview, hotelFloors: floors, live: true, actions, toggleView: () => undefined });
    expect(commands[0]!.title).toBe("Approve plan in ALPHA");
    expect(commands.find((c) => c.title === "Toggle view")?.shortcut).toBe("L");
    expect(commands.filter((c) => c.shortcut).length).toBe(1);
  });

  it("every command calls the matching list action", () => {
    const { calls, actions } = recorder();
    let toggled = 0;
    const commands = buildCommands({ floors: overview, hotelFloors: floors, live: true, actions, toggleView: () => void (toggled += 1) });
    const run = (title: string) => commands.find((c) => c.title === title)!.run();
    run("Approve plan in ALPHA");
    run("Open report of ALPHA");
    run("New write-tests job in ALPHA".replace("write-tests", "test-writing"));
    run("New branch review job in BETA");
    run("Go to Lobby");
    run("Go to HR office");
    run("Schedule night job");
    run("Toggle view");
    expect(calls).toEqual([
      "plan project:alpha",
      "report project:alpha r1",
      "new write-tests project:alpha",
      "new review-branch project:beta",
      "go lobby",
      "go hr",
      "night",
    ]);
    expect(toggled).toBe(1);
  });

  it("in the recorded demo only Go to and Toggle view are left", () => {
    const { actions } = recorder();
    const titles = buildCommands({ floors: null, hotelFloors: floors, live: false, actions, toggleView: () => undefined }).map((c) => c.title);
    expect(titles).toEqual(["Go to Lobby", "Go to HR office", "Go to ALPHA", "Go to BETA", "Toggle view"]);
    const withData = buildCommands({ floors: overview, hotelFloors: floors, live: false, actions, toggleView: () => undefined }).map((c) => c.title);
    expect(withData).toEqual(titles);
  });

  it("before the first overview there are no project commands", () => {
    const { actions } = recorder();
    const titles = buildCommands({ floors: null, hotelFloors: floors, live: true, actions, toggleView: () => undefined }).map((c) => c.title);
    expect(titles.some((t) => t.startsWith("New ") || t.startsWith("Approve") || t.startsWith("Open report"))).toBe(false);
    expect(titles).toContain("Schedule night job");
  });
});

// ---- the list ----

describe("list model", () => {
  const change = (...states: JobState[]) => states.map((s, i): [JobState, number] => [s, i * 4000]);

  it("describes a job in every state", () => {
    const cases: [string, OverviewFloor, string][] = [
      ["no job", floor(), "No job yet"],
      ["plan", floor({ status: "working", who: "architect", states: change("created", "analyzing") }), "Change · Plan (Architect)"],
      ["approval", floor({ status: "waiting_approval", states: change("created", "analyzing", "awaiting_plan_approval") }), "Change · Your turn"],
      ["build", floor({ status: "working", who: "developer", states: change("created", "analyzing", "awaiting_plan_approval", "developing") }), "Change · Build (Developer)"],
      ["test", floor({ status: "working", who: "qa", states: change("created", "analyzing", "awaiting_plan_approval", "developing", "testing") }), "Change · Test (QA)"],
      ["review", floor({ status: "working", who: "qa", states: change("created", "analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing") }), "Change · Review (QA)"],
      ["done", floor({ states: change("created", "analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered") }), "Change · Done"],
      ["failed", floor({ states: change("created", "analyzing", "awaiting_plan_approval", "developing", "failed", "report_ready", "delivered") }), "Change · Failed at Build"],
      ["rejected", floor({ states: change("created", "analyzing", "awaiting_plan_approval", "cancelled") }), "Change · Failed at Approve (Cancelled)"],
      ["queued", floor({ status: "queued", queuePosition: 2, states: change("created") }), "Change · Plan (Architect) · queued (place 2)"],
      ["branch review", floor({ kind: "review-branch", target: "feature/x", status: "working", who: "qa", states: change("created", "reviewing") }), "Branch review feature/x · Review (QA)"],
      ["documentation", floor({ kind: "document", status: "working", who: "architect", states: change("created", "analyzing") }), "Documentation · Research (Architect)"],
    ];
    for (const [name, f, expected] of cases) expect(jobLine(f), name).toBe(expected);
  });

  it("derives the steps of the job with the stepper's own function", () => {
    const f = floor({ states: change("created", "analyzing", "awaiting_plan_approval", "developing") });
    expect(stepsOf(f).map((s) => `${s.label}:${s.status}`)).toEqual(["Plan:done", "Approve:done", "Build:current", "Test:pending", "Review:pending", "Report:pending"]);
    expect(stepsOf(floor())).toEqual([]);
    expect(stepsOf(floor({ kind: "review-branch", states: change("created", "reviewing") })).map((s) => s.label)).toEqual(["Review", "Test", "Report"]);
  });

  it("says what each status is and how many plans wait", () => {
    expect(statusLine({ status: "idle" })).toBe("Idle");
    expect(statusLine({ status: "working", who: "qa" })).toBe("Working: QA");
    expect(statusLine({ status: "waiting_approval" })).toBe("Waiting for you");
    expect(statusLine({ status: "report_ready" })).toBe("Report ready");
    expect(statusLine({ status: "failed" })).toBe("Failed");
    expect(statusLine({ status: "queued", queuePosition: 3 })).toBe("Queued (place 3)");
    expect(waitingBadge(floor())).toBe("");
    expect(waitingBadge(floor({ waiting: 1 }))).toBe("Waiting for you");
    expect(waitingBadge(floor({ waiting: 3 }))).toBe("3 waiting for you");
  });

  it("writes the last report with its verdict and how long ago", () => {
    expect(reportLine(floor(), T0)).toBe("");
    expect(reportLine(floor({ lastReport: { reportId: "r", taskId: "t", verdict: "pass", at: T0 } }), T0 + 125_000)).toBe("Last report: pass, 2m 05s ago");
    expect(reportLine(floor({ lastReport: { reportId: "r", taskId: "t", verdict: "fail", at: T0 } }), T0 + 2000)).toBe("Last report: fail, just now");
    expect(reportLine(floor({ lastReport: { reportId: "r", taskId: "t" } }), T0)).toBe("Last report: no verdict");
    expect(ago(T0, T0 - 1000)).toBe("just now");
  });

  it("counts the night jobs of a project from the overview", () => {
    expect(nightCount(floor({ night: 2 }))).toBe(2);
    expect(nightCount(floor())).toBe(0);
  });

  it("sorts rows that need the user first and keeps the floor order inside a group", () => {
    const rows = [
      floor({ roomId: "project:a", name: "A" }),
      floor({ roomId: "project:b", name: "B", status: "working" }),
      floor({ roomId: "project:c", name: "C", status: "report_ready" }),
      floor({ roomId: "project:d", name: "D", status: "waiting_approval", waiting: 1 }),
      floor({ roomId: "project:e", name: "E" }),
    ];
    expect(sortFloors(rows).map((r) => r.name)).toEqual(["D", "C", "B", "A", "E"]);
  });
});

describe("list view", () => {
  const actionsLog = () => {
    const calls: string[] = [];
    const actions: ListActions = {
      newJob: (roomId, choice) => void calls.push(`new ${choice.kind} ${roomId}`),
      reviewPlan: (roomId) => void calls.push(`plan ${roomId}`),
      openReport: (roomId, id) => void calls.push(`report ${roomId} ${id}`),
      openJobCard: (roomId) => void calls.push(`card ${roomId}`),
      goTo: (roomId) => void calls.push(`go ${roomId}`),
      scheduleNight: () => void calls.push("night"),
    };
    return { calls, actions };
  };
  const data = (over: Partial<ListData> = {}): ListData => ({ floors: [], now: T0 + 60_000, locked: null, ...over });
  const buttons = (root: unknown) => findAll(root, (e) => e.tagName === "button");
  const button = (root: unknown, name: string) => buttons(root).find((b) => textOf(b) === name);

  it("renders one row per project with name, status, job, badge and last report", () => {
    const { actions } = actionsLog();
    const f = floor({
      status: "waiting_approval",
      waiting: 1,
      states: [["created", 0], ["analyzing", 1000], ["awaiting_plan_approval", 9000]],
      lastReport: { reportId: "r1", taskId: "t0", verdict: "fail", at: T0 + 30_000 },
    });
    const root = renderList(fakeDoc(), data({ floors: [f, floor({ roomId: "project:beta", projectId: "beta", name: "BETA" })] }), new Set(), actions, () => undefined);
    const rows = findAll(root, (e) => e.className === "al-list-row");
    expect(rows).toHaveLength(2);
    const text = textOf(rows[0]);
    expect(text).toContain("ALPHA");
    expect(text).toContain("Waiting for you");
    expect(text).toContain("Change · Your turn");
    expect(text).toContain("Last report: fail, 30s ago");
    expect(textOf(rows[1])).toContain("No job yet");
  });

  it("shows how many night jobs a project has", () => {
    const { actions } = actionsLog();
    const root = renderList(fakeDoc(), data({ floors: [floor({ night: 1 })] }), new Set(), actions, () => undefined);
    expect(textOf(root)).toContain("1 night job scheduled");
    const many = renderList(fakeDoc(), data({ floors: [floor({ night: 3 })] }), new Set(), actions, () => undefined);
    expect(textOf(many)).toContain("3 night jobs scheduled");
    expect(textOf(renderList(fakeDoc(), data({ floors: [floor()] }), new Set(), actions, () => undefined))).not.toContain("night job scheduled");
  });

  it("renders every job state without throwing, each with its job line", () => {
    const { actions } = actionsLog();
    const states: JobState[] = ["created", "analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered", "failed", "cancelled"];
    const rows = states.map((s, i) => floor({ roomId: `project:p${i}`, projectId: `p${i}`, name: `P${i}`, states: [["created", 0], [s, 3000]] }));
    const root = renderList(fakeDoc(), data({ floors: rows }), new Set(rows.map((r) => r.roomId)), actions, () => undefined);
    expect(findAll(root, (e) => e.className === "al-list-row")).toHaveLength(states.length);
    expect(findAll(root, (e) => e.className === "al-list-detail")).toHaveLength(states.length);
  });

  it("has the buttons of every action, and each calls its action with the row's floor", () => {
    const { calls, actions } = actionsLog();
    const f = floor({ waiting: 1, status: "waiting_approval", states: [["created", 0], ["awaiting_plan_approval", 5000]], lastReport: { reportId: "r1", taskId: "t1", verdict: "pass", at: T0 } });
    const root = renderList(fakeDoc(), data({ floors: [f] }), new Set(["project:alpha"]), actions, () => undefined);
    for (const name of ["Review plan", "Open report", "New change", "New branch review", "New test-writing", "New documentation", "Job card", "Report", "Go to floor", "Schedule night job"]) {
      button(root, name)!.click();
    }
    expect(calls).toEqual([
      "plan project:alpha",
      "report project:alpha r1",
      "new change project:alpha",
      "new review-branch project:alpha",
      "new write-tests project:alpha",
      "new document project:alpha",
      "card project:alpha",
      "report project:alpha r1",
      "go project:alpha",
      "night",
    ]);
  });

  it("offers Review plan only when a plan waits and Open report only when there is a report", () => {
    const { actions } = actionsLog();
    const root = renderList(fakeDoc(), data({ floors: [floor()] }), new Set(), actions, () => undefined);
    expect(button(root, "Review plan")).toBeUndefined();
    expect(button(root, "Open report")).toBeUndefined();
    expect(button(root, "New change")).toBeDefined();
  });

  it("an expanded row shows the steps with durations and the delivery state", () => {
    const { actions } = actionsLog();
    const done = floor({
      states: [["created", 0], ["analyzing", 1000], ["awaiting_plan_approval", 26_000], ["developing", 30_000], ["testing", 52_000], ["reviewing", 58_000], ["report_ready", 77_000], ["delivered", 78_000]],
      lastReport: { reportId: "r1", taskId: "t1", verdict: "pass", at: T0, delivery: "available" },
    });
    const root = renderList(fakeDoc(), data({ floors: [done] }), new Set(["project:alpha"]), actions, () => undefined);
    const steps = findAll(root, (e) => e.tagName === "li" && e.dataset["status"] !== undefined && (e.parent as FakeElement | null)?.className === "al-list-steps");
    expect(steps.map((s) => s.dataset["status"])).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(textOf(steps[0])).toContain("Plan 26s");
    expect(button(root, "Deliver as branch")).toBeDefined();
    const delivered = floor({ lastReport: { reportId: "r1", taskId: "t1", at: T0, delivery: "done" } });
    expect(textOf(renderList(fakeDoc(), data({ floors: [delivered] }), new Set(["project:alpha"]), actions, () => undefined))).toContain("Delivered as a branch");
  });

  it("toggles a row's details", () => {
    const { actions } = actionsLog();
    const toggled: string[] = [];
    const root = renderList(fakeDoc(), data({ floors: [floor()] }), new Set(), actions, (id) => toggled.push(id));
    button(root, "Details")!.click();
    expect(toggled).toEqual(["project:alpha"]);
    const open = renderList(fakeDoc(), data({ floors: [floor()] }), new Set(["project:alpha"]), actions, () => undefined);
    expect(button(open, "Hide details")).toBeDefined();
    expect(textOf(open)).toContain("No job has run on this floor");
  });

  it("says so while loading, with no projects, and in the recorded demo", () => {
    const { actions } = actionsLog();
    const text = (d: ListData) => textOf(renderList(fakeDoc(), d, new Set(), actions, () => undefined));
    expect(text(data({ floors: null }))).toContain("Loading the projects");
    expect(text(data({ floors: [] }))).toContain("No projects yet");
    const locked = renderList(fakeDoc(), data({ floors: null, locked: "The list view needs the live hotel." }), new Set(), actions, () => undefined);
    expect(textOf(locked)).toContain("needs the live hotel");
    expect(button(locked, "Schedule night job")!.disabled).toBe(true);
  });

  it("the view re-renders when the data changes, not when it repeats", () => {
    const { actions } = actionsLog();
    const doc = new FakeDocument();
    const host = doc.createElement("div");
    const view = createListView(doc as unknown as Document, host as unknown as HTMLElement, actions, () => T0);
    expect(view.root.hidden).toBe(true);
    view.setVisible(true);
    expect(view.root.hidden).toBe(false);
    view.update({ floors: [floor()] });
    const first = (view.root as unknown as FakeElement).children[0];
    view.update({ floors: [floor()] });
    expect((view.root as unknown as FakeElement).children[0]).toBe(first);
    view.update({ floors: [floor({ status: "working", who: "qa" })] });
    expect((view.root as unknown as FakeElement).children[0]).not.toBe(first);
    expect(textOf(view.root)).toContain("Working: QA");
  });
});

// ---- view choice and keys ----

describe("view choice and keys", () => {
  const store = (initial?: string) => {
    const map = new Map<string, string>(initial === undefined ? [] : [["agentlife-view", initial]]);
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  };

  it("remembers the view and starts in the hotel when nothing was chosen or the value is odd", () => {
    expect(loadView(undefined)).toBe("hotel");
    expect(loadView(store())).toBe("hotel");
    expect(loadView(store("list"))).toBe("list");
    expect(loadView(store("whatever"))).toBe("hotel");
    const s = store();
    saveView(s, "list");
    expect(loadView(s)).toBe("list");
    expect(otherView("list")).toBe("hotel");
    expect(otherView("hotel")).toBe("list");
    expect(loadView({ getItem: () => { throw new Error("denied"); }, setItem: () => undefined })).toBe("hotel");
  });

  it("L toggles outside text fields only, without modifiers", () => {
    expect(isViewKey({ key: "l", target: { tagName: "BODY" } })).toBe(true);
    expect(isViewKey({ key: "L", target: { tagName: "DIV" } })).toBe(true);
    expect(isViewKey({ key: "l", target: { tagName: "INPUT" } })).toBe(false);
    expect(isViewKey({ key: "l", target: { tagName: "TEXTAREA" } })).toBe(false);
    expect(isViewKey({ key: "l", target: { tagName: "SELECT" } })).toBe(false);
    expect(isViewKey({ key: "l", target: { tagName: "DIV", isContentEditable: true } })).toBe(false);
    expect(isViewKey({ key: "l", ctrlKey: true, target: { tagName: "BODY" } })).toBe(false);
    expect(isViewKey({ key: "l", metaKey: true })).toBe(false);
    expect(isViewKey({ key: "x" })).toBe(false);
    expect(inTextField(null)).toBe(false);
  });

  it("Ctrl+K and Cmd+K open the palette; K alone does not", () => {
    expect(isPaletteKey({ key: "k", ctrlKey: true })).toBe(true);
    expect(isPaletteKey({ key: "K", metaKey: true })).toBe(true);
    expect(isPaletteKey({ key: "k" })).toBe(false);
    expect(isPaletteKey({ key: "k", ctrlKey: true, altKey: true })).toBe(false);
    expect(isPaletteKey({ key: "l", ctrlKey: true })).toBe(false);
  });
});
