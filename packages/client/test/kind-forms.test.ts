import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GOAL_MAX_CHARS, JOB_TARGET_MAX_CHARS } from "@agentlife/shared";
import type { FurnitureKind } from "../src/ui/kind-forms.ts";
import { createKindPanel, defaultBranch, kindGoal } from "../src/ui/kind-forms.ts";
import type { PanelData } from "../src/ui/panel-state.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const data = (over: Partial<PanelData> = {}): PanelData => ({
  repos: [{ id: "my-app", name: "My App" }],
  branches: { current: "main", branches: ["main", "feature/login", "fix/typo"] },
  projects: [],
  job: null,
  approvals: [],
  reports: [],
  details: null,
  ...over,
});

interface Start {
  repoId: string;
  goal: string;
  kind: FurnitureKind;
  target: string;
}

function harness(kind: FurnitureKind, locked = false) {
  const starts: Start[] = [];
  const panel = createKindPanel(fakeDoc(), kind, { startJob: (repoId, goal, k, target) => starts.push({ repoId, goal, kind: k, target }) }, locked);
  return { starts, render: (d: PanelData = data(), error: string | null = null) => panel(d, error) };
}

const input = (root: unknown) => findAll(root, (e) => e.tagName === "input")[0] as FakeElement;
const notes = (root: unknown) => findAll(root, (e) => e.tagName === "textarea")[0] as FakeElement;
const options = (root: unknown) => findAll(root, (e) => e.attributes.get("role") === "option");

describe("kindGoal", () => {
  it("writes one line with a verb, the target and the notes", () => {
    expect(kindGoal("review-branch", "feature/login")).toBe("Review branch feature/login");
    expect(kindGoal("write-tests", "src/todo.ts", "  cover\n the edge   cases ")).toBe("Write tests for src/todo.ts: cover the edge cases");
    expect(kindGoal("document", "The build")).toBe("Document The build");
  });

  it("property: never longer than a goal may be, and never empty", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<FurnitureKind>("review-branch", "write-tests", "document"),
        fc.string({ minLength: 1, maxLength: JOB_TARGET_MAX_CHARS }),
        fc.string({ maxLength: 400 }),
        (kind, target, extra) => {
          const goal = kindGoal(kind, target, extra);
          expect(goal.length).toBeLessThanOrEqual(GOAL_MAX_CHARS);
          expect(goal.length).toBeGreaterThan(0);
        },
      ),
    );
  });
});

describe("defaultBranch", () => {
  it("starts on a branch that is not the checked-out one", () => {
    expect(defaultBranch(["main", "feature/x"], "main")).toBe("feature/x");
    expect(defaultBranch(["feature/x", "main"], "main")).toBe("feature/x");
    expect(defaultBranch(["main"], "main")).toBe("");
    expect(defaultBranch(["a", "b"], null)).toBe("a");
    expect(defaultBranch([], null)).toBe("");
  });
});

describe("review desk form", () => {
  it("lists the local branches, marks the checked-out one and reviews the first other branch", () => {
    const { render, starts } = harness("review-branch");
    const { body, footer } = render();
    expect(options(body).map((o) => textOf(o))).toEqual(["main (checked out)", "feature/login", "fix/typo"]);
    expect(textOf(footer)).toBe("Review branch");
    footer?.click();
    expect(starts).toEqual([{ repoId: "my-app", goal: "Review branch feature/login", kind: "review-branch", target: "feature/login" }]);
  });

  it("reviews the branch the user picked, and keeps the choice when the panel renders again", () => {
    const { render, starts } = harness("review-branch");
    findAll(render().body, (e) => e.attributes.get("role") === "option")[2]?.click();
    const again = render();
    again.footer?.click();
    expect(starts.map((s) => s.target)).toEqual(["fix/typo"]);
  });

  it("says so when the project has no branch, and offers no button", () => {
    const { render } = harness("review-branch");
    const { body, footer } = render(data({ branches: { current: null, branches: [] } }));
    expect(textOf(body)).toContain("no local branches");
    expect(footer).toBeUndefined();
    expect(textOf(render(data({ branches: null })).body)).toContain("no local branches");
  });
});

describe.each([
  { kind: "write-tests", label: "Path or module", empty: "Name a path or module", good: "src/todo.ts", bad: "../secrets", button: "Write tests" },
  { kind: "document", label: "Topic or path", empty: "Name a topic or path", good: "How the build works", bad: "line one\nline two", button: "Write docs" },
] as const)("$kind form", ({ kind, label, empty, good, bad, button }) => {
  it("asks for the target, with a button in the footer", () => {
    const { render } = harness(kind);
    const { body, footer } = render();
    expect(textOf(body)).toContain(label);
    expect(textOf(footer)).toBe(button);
    expect(findAll(body, (e) => e.tagName === "select")).toHaveLength(0);
  });

  it("does not start without a target or with one the engine would refuse, and says why", () => {
    const { render, starts } = harness(kind);
    const { body, footer } = render();
    footer?.click();
    expect(textOf(body)).toContain(empty);
    input(body).value = bad;
    footer?.click();
    expect(starts).toEqual([]);
    expect(textOf(body)).toMatch(/not a valid/i);
  });

  it("starts the job with the trimmed target and the notes in the goal", () => {
    const { render, starts } = harness(kind);
    const { body, footer } = render();
    input(body).value = `  ${good}  `;
    input(body).fire("input");
    notes(body).value = "extra care";
    notes(body).fire("input");
    footer?.click();
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ repoId: "my-app", kind, target: good });
    expect(starts[0]?.goal).toBe(kindGoal(kind, good, "extra care"));
  });

  it("keeps what the user typed when the panel renders again, and clears it after a start", () => {
    const { render } = harness(kind);
    const first = render();
    input(first.body).value = good;
    input(first.body).fire("input");
    notes(first.body).value = "careful";
    notes(first.body).fire("input");
    const second = render();
    expect(input(second.body).value).toBe(good);
    expect(notes(second.body).value).toBe("careful");
    second.footer?.click();
    expect(input(render().body).value).toBe("");
    expect(notes(render().body).value).toBe("");
  });

  it("removes the complaint as soon as the user types again", () => {
    const { render } = harness(kind);
    const { body, footer } = render();
    footer?.click();
    expect(textOf(body)).toContain(empty);
    input(body).value = good;
    input(body).fire("input");
    expect(textOf(body)).not.toContain(empty);
  });
});

describe("states every form shares", () => {
  it.each(["review-branch", "write-tests", "document"] as const)("%s: busy, engine error, no repository and the recorded demo", (kind) => {
    const busy = harness(kind).render(data({ job: { taskId: "t", repoId: "my-app", goal: "g", state: "developing", timeline: [] } }));
    expect(textOf(busy.footer)).toBe("Job running...");
    expect((busy.footer as unknown as FakeElement).disabled).toBe(true);

    const finished = harness(kind).render(data({ job: { taskId: "t", repoId: "my-app", goal: "g", state: "delivered", timeline: [] } }));
    expect((finished.footer as unknown as FakeElement).disabled).toBe(false);

    const failed = harness(kind).render(data(), "cannot list the branches");
    expect(textOf(failed.body)).toContain("Engine unavailable: cannot list the branches");
    expect(failed.footer).toBeUndefined();

    expect(textOf(harness(kind).render(data({ repos: [] })).body)).toContain("No repositories available.");

    const demo = harness(kind, true).render();
    expect(textOf(demo.body)).toContain("off in the recorded demo");
    expect(demo.footer).toBeUndefined();
  });
});
