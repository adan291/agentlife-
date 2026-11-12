import { describe, expect, it } from "vitest";
import type { NightJob, NightJobRequest, NightState } from "@agentlife/shared";
import { NightJobInputSchema } from "@agentlife/shared";
import { approvalText, checkNightForm, createNightPanel, nightChip, parseScope, windowText } from "../src/ui/night-board.ts";
import type { PanelContent } from "../src/ui/computer.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import type { PanelData } from "../src/ui/panel-state.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const CONFIG = { start: "01:00", end: "07:00", maxJobsPerNight: 4, maxJobMinutes: 20 };

function job(id: string, extra: Partial<NightJob> = {}): NightJob {
  return { id, repoId: "demo", kind: "audit-deps", goal: "Audit dependencies", tier: "normal", preApprove: false, deliver: false, status: "scheduled", addedAt: 1, ...extra };
}

const data = (over: Partial<PanelData> = {}): PanelData => ({
  repos: [],
  projects: [
    { id: "demo", name: "Demo", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 },
    { id: "api", name: "API", builtin: false, stack: "node-npm", testCommand: "npm test", registeredAt: 0 },
  ],
  job: null,
  approvals: [],
  reports: [],
  details: null,
  ...over,
});

const state = (jobs: NightJob[], over: Partial<NightState> = {}): NightState => ({ config: CONFIG, open: false, jobs, ...over });

function harness() {
  const calls: string[] = [];
  const added: NightJobRequest[] = [];
  const panel = createNightPanel(fakeDoc(), {
    add: (j) => {
      calls.push("add");
      added.push(j);
    },
    remove: (id) => calls.push(`remove:${id}`),
    move: (id, d) => calls.push(`move:${id}:${d}`),
  });
  let current: PanelContent;
  let view = { night: state([]) as NightState | null, error: null as string | null };
  let d = data();
  const render = (): PanelContent => {
    current = panel(d, view, () => render());
    return current;
  };
  render();
  return {
    calls,
    added,
    get content() {
      return current;
    },
    set(next: Partial<typeof view>) {
      view = { ...view, ...next };
      render();
    },
    setData(next: PanelData) {
      d = next;
      render();
    },
  };
}

const field = (root: unknown, name: string) => findAll(root, (e) => e.dataset["field"] === name)[0] as FakeElement | undefined;
const option = (root: unknown, label: string) => findAll(root, (e) => e.attributes.get("role") === "option" && textOf(e) === label)[0];
const action = (root: unknown, name: string) => findAll(root, (e) => e.dataset["action"] === name);

describe("night board helpers", () => {
  it("says the pre-approval in words for every kind", () => {
    expect(approvalText({ kind: "audit-deps", preApprove: false })).toBe("No plan, so nothing to approve.");
    expect(approvalText({ kind: "change", preApprove: false })).toBe("The plan waits for your approval.");
    expect(approvalText({ kind: "change", preApprove: true, scopePaths: ["src/", "README.md"] })).toBe("The plan is approved automatically if it only touches: src/, README.md.");
    expect(approvalText({ kind: "write-tests", preApprove: true })).toContain("only touches test files");
    expect(approvalText({ kind: "document", preApprove: true })).toContain("Markdown files and docs/");
  });

  it("shows the window, the limits and whether Discord is on", () => {
    expect(windowText(state([]))).toBe("Night window 01:00 to 07:00 (this computer's time). Up to 4 jobs a night, 20 minutes each. Morning message on Discord: off (set in config/night.json).");
    expect(windowText(state([], { config: { ...CONFIG, discord: true } }))).toContain("Discord: on");
  });

  it("reads one scope path per line", () => {
    expect(parseScope(" src/ \r\n\nREADME.md\n  ")).toEqual(["src/", "README.md"]);
    expect(parseScope("")).toEqual([]);
  });

  it("names a status chip in words", () => {
    expect(["scheduled", "running", "done", "waiting", "timed_out", "skipped"].map((status) => nightChip({ status: status as NightJob["status"] }))).toEqual([
      "Scheduled",
      "Running",
      "Done",
      "Waiting for you",
      "Stopped by the time limit",
      "Skipped",
    ]);
  });
});

describe("checkNightForm", () => {
  const base: Parameters<typeof checkNightForm>[0] = { repoId: "demo", kind: "audit-deps", target: "", goal: "", tier: "normal", preApprove: false, scope: "", deliver: false };

  it("builds a job the engine's schema accepts, for every kind", () => {
    const cases = [
      { ...base },
      { ...base, kind: "review-branch" as const, target: " feature/x " },
      { ...base, kind: "write-tests" as const, target: "src/todo.ts", preApprove: true, deliver: true },
      { ...base, kind: "document" as const, target: "How the build works" },
      { ...base, kind: "change" as const, goal: "Fix it", preApprove: true, scope: "src/\nREADME.md", deliver: true, tier: "cheap" as const },
    ];
    for (const c of cases) {
      const r = checkNightForm(c);
      expect(r.ok, JSON.stringify(c)).toBe(true);
      if (r.ok) expect(NightJobInputSchema.safeParse(r.job).success).toBe(true);
    }
    const change = checkNightForm(cases[4]!);
    expect(change.ok && change.job).toMatchObject({ kind: "change", goal: "Fix it", scopePaths: ["src/", "README.md"], preApprove: true, deliver: true, tier: "cheap" });
    const review = checkNightForm(cases[1]!);
    expect(review.ok && review.job.target).toBe("feature/x");
  });

  it("ignores approval and delivery for kinds that change nothing, instead of failing", () => {
    const r = checkNightForm({ ...base, kind: "review-branch", target: "feature/x", preApprove: true, deliver: true });
    expect(r.ok && r.job).toMatchObject({ preApprove: false, deliver: false });
  });

  it("explains what is missing in the user's words", () => {
    const text = (over: Partial<typeof base>) => {
      const r = checkNightForm({ ...base, ...over });
      return r.ok ? "ok" : r.problem;
    };
    expect(text({ repoId: "" })).toBe("Choose a project.");
    expect(text({ kind: "review-branch", target: "" })).toBe("Branch: choose a branch");
    expect(text({ kind: "review-branch", target: "../x" })).toBe("Branch: not a valid branch name");
    expect(text({ kind: "write-tests", target: "" })).toBe("Path or module: name a path or module");
    expect(text({ kind: "change", goal: "  " })).toBe("Goal: describe the change");
    expect(text({ kind: "change", goal: "x", preApprove: true, scope: "" })).toBe("Scope: name the files or folders the plan may touch");
    expect(text({ kind: "change", goal: "x", preApprove: true, scope: "/etc/passwd" })).toBe("Scope: use relative paths like src/ or README.md");
    expect(text({ kind: "change", goal: "x", preApprove: true, scope: "../out/" })).toBe("Scope: use relative paths like src/ or README.md");
  });
});

describe("night panel", () => {
  it("waits for data, shows an error, and explains the demo", () => {
    const h = harness();
    h.set({ night: null });
    expect(textOf(h.content.body)).toContain("Loading the night schedule");
    h.set({ night: null, error: "the night shift needs the real engine" });
    expect(textOf(h.content.body)).toContain("the night shift needs the real engine");
    const demo = createNightPanel(fakeDoc(), { add: () => {}, remove: () => {}, move: () => {} })(data(), { night: null, error: null, locked: "off in the demo" }, () => {});
    expect(textOf(demo.body)).toBe("off in the demo");
    expect(demo.footer).toBeUndefined();
  });

  it("lists the jobs in running order with their project name, facts and reason", () => {
    const h = harness();
    h.set({
      night: state([
        job("a", { kind: "review-branch", target: "feature/x", goal: "Review branch feature/x", tier: "cheap" }),
        job("b", { repoId: "api", kind: "change", goal: "Rename helpers", preApprove: true, scopePaths: ["src/"], deliver: true }),
        job("c", { status: "waiting", kind: "change", goal: "Rewrite", reason: "The plan is outside the pre-approved scope: package.json." }),
        job("d", { status: "done", verdict: "pass", branch: "agentlife/task-1", kind: "write-tests", target: "src", goal: "Write tests for src" }),
      ]),
    });
    const cards = findAll(h.content.body, (e) => e.className.includes("al-night-job"));
    expect(cards.map((c) => c.dataset["job"])).toEqual(["a", "b", "c", "d"]);
    const first = textOf(cards[0]!);
    expect(first).toContain("Scheduled");
    expect(first).toContain("Demo");
    expect(first).toContain("Branch review");
    expect(first).toContain("Cheap model");
    expect(first).toContain("No plan, so nothing to approve.");
    const second = textOf(cards[1]!);
    expect(second).toContain("API");
    expect(second).toContain("approved automatically if it only touches: src/.");
    expect(second).toContain("Delivered as a branch if it passes.");
    expect(cards[2]?.dataset["attention"]).toBe("true");
    expect(textOf(cards[2]!)).toContain("Waiting for you");
    expect(textOf(cards[2]!)).toContain("outside the pre-approved scope");
    expect(textOf(cards[3]!)).toContain("Branch: agentlife/task-1");
  });

  it("moves and removes scheduled jobs, with no move past either end", () => {
    const h = harness();
    h.set({ night: state([job("a"), job("b"), job("x", { status: "done" })]) });
    const cards = findAll(h.content.body, (e) => e.className.includes("al-night-job"));
    const [aUp, bUp] = cards.slice(0, 2).map((c) => action(c, "up")[0]!);
    const [aDown, bDown] = cards.slice(0, 2).map((c) => action(c, "down")[0]!);
    expect([aUp?.disabled, aDown?.disabled, bUp?.disabled, bDown?.disabled]).toEqual([true, false, false, true]);
    aDown?.click();
    bUp?.click();
    action(cards[1]!, "remove")[0]?.click();
    expect(action(cards[2]!, "up")).toHaveLength(0);
    action(cards[2]!, "remove")[0]?.click();
    expect(h.calls).toEqual(["move:a:down", "move:b:up", "remove:b", "remove:x"]);
  });

  it("a running job cannot be removed from here", () => {
    const h = harness();
    h.set({ night: state([job("a", { status: "running" })]) });
    const card = findAll(h.content.body, (e) => e.className.includes("al-night-job"))[0]!;
    expect(action(card, "remove")).toHaveLength(0);
    expect(textOf(card)).toContain("cancel the job on its floor");
  });

  it("says when the shift is on", () => {
    const h = harness();
    h.set({ night: state([], { open: true }) });
    expect(textOf(h.content.body)).toContain("The night shift is on now.");
    expect(textOf(h.content.body)).toContain("Night window 01:00 to 07:00");
  });

  it("adds a dependency audit with the defaults", () => {
    const h = harness();
    h.content.footer?.click();
    expect(h.added).toEqual([{ repoId: "demo", kind: "audit-deps", tier: "normal", preApprove: false, deliver: false }]);
  });

  it("shows the problem under the form and sends nothing", () => {
    const h = harness();
    option(h.content.body, "Branch review")?.click();
    expect(field(h.content.body, "target")).toBeDefined();
    h.content.footer?.click();
    expect(h.added).toEqual([]);
    expect(textOf(field(h.content.body, "problem")!)).toBe("Branch: choose a branch");
  });

  it("asks for the fields of the kind that was chosen and sends them", () => {
    const h = harness();
    option(h.content.body, "Change")?.click();
    expect(field(h.content.body, "goal")).toBeDefined();
    expect(field(h.content.body, "preApprove")).toBeDefined();
    expect(field(h.content.body, "deliver")).toBeDefined();
    expect(field(h.content.body, "scopePaths")).toBeUndefined();

    (field(h.content.body, "goal") as unknown as { value: string; fire(t: string): void }).value = "Fix the typo";
    field(h.content.body, "goal")?.fire("input");
    const box = field(h.content.body, "preApprove") as unknown as { checked: boolean; fire(t: string): void };
    box.checked = true;
    box.fire("change");
    const scope = field(h.content.body, "scopePaths") as unknown as { value: string; fire(t: string): void };
    expect(scope).toBeDefined();
    scope.value = "src/\nREADME.md";
    scope.fire("input");
    const deliver = field(h.content.body, "deliver") as unknown as { checked: boolean; fire(t: string): void };
    deliver.checked = true;
    deliver.fire("change");
    option(h.content.body, "Cheap model")?.click();
    h.content.footer?.click();
    expect(h.added).toEqual([
      { repoId: "demo", kind: "change", goal: "Fix the typo", tier: "cheap", preApprove: true, scopePaths: ["src/", "README.md"], deliver: true },
    ]);
    // The engine took the job: the schedule has a new entry, so the form is emptied but the choices stay.
    h.set({ night: state([job("n9", { kind: "change", goal: "Fix the typo" })]) });
    expect(field(h.content.body, "goal")?.value).toBe("");
    expect(field(h.content.body, "preApprove")).toBeDefined();
  });

  it("keeps what the user typed when the engine refuses the job", () => {
    const h = harness();
    option(h.content.body, "Change")?.click();
    const goal = field(h.content.body, "goal") as unknown as { value: string; fire(t: string): void };
    goal.value = "Fix the typo";
    goal.fire("input");
    h.content.footer?.click();
    expect(h.added).toHaveLength(1);
    h.set({ error: "The night schedule holds 50 jobs. Remove one first." });
    expect(field(h.content.body, "goal")?.value).toBe("Fix the typo");
    expect(textOf(h.content.body)).toContain("The night schedule holds 50 jobs.");
  });

  it("offers no approval or delivery for a kind that changes nothing", () => {
    const h = harness();
    expect(field(h.content.body, "preApprove")).toBeUndefined();
    expect(field(h.content.body, "deliver")).toBeUndefined();
    option(h.content.body, "Branch review")?.click();
    expect(field(h.content.body, "preApprove")).toBeUndefined();
    option(h.content.body, "Test writing")?.click();
    expect(field(h.content.body, "preApprove")).toBeDefined();
    expect(field(h.content.body, "scopePaths")).toBeUndefined();
  });

  it("sends the job to the project that was picked", () => {
    const h = harness();
    option(h.content.body, "API")?.click();
    h.content.footer?.click();
    expect(h.added[0]?.repoId).toBe("api");
  });

  it("asks to register a project first when there is none", () => {
    const h = harness();
    h.setData(data({ projects: [] }));
    expect(textOf(h.content.body)).toContain("No projects yet. Register one at the Reception first.");
    expect(h.content.footer).toBeUndefined();
  });
});

describe("PanelState and the night board", () => {
  it("keeps the schedule and re-renders only when it changed", () => {
    const s = new PanelState();
    const a = state([job("a")]);
    expect(s.apply({ type: "night", state: a })).toBe(false);
    s.apply({ type: "open_panel", panel: "night" });
    expect(s.apply({ type: "night", state: a })).toBe(false);
    expect(s.apply({ type: "night", state: state([job("a"), job("b")]) })).toBe(true);
    expect(s.night?.jobs).toHaveLength(2);
  });

  it("shows a refused change and keeps it when the schedule follows, then clears it on the next opening", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "night" });
    expect(s.apply({ type: "error", code: "night_error", message: "The night schedule holds 50 jobs." })).toBe(true);
    s.apply({ type: "night", state: state([job("a")]) });
    expect(s.nightError).toBe("The night schedule holds 50 jobs.");
    s.close();
    s.apply({ type: "open_panel", panel: "night" });
    expect(s.nightError).toBeNull();
  });

  it("records why the board is not available", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "night" });
    s.apply({ type: "error", code: "engine_unavailable", message: "the night shift needs the real engine" });
    expect(s.nightError).toBe("the night shift needs the real engine");
  });
});
