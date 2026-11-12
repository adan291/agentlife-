import { describe, expect, it } from "vitest";
import type { JobKind, JobState, JobView } from "@agentlife/shared";
import { FURNI_CATALOG } from "@agentlife/shared";
import { RECIPES } from "../src/scene/recipes.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { compactStep, stepperFor } from "../src/ui/stepper.ts";

function job(kind: JobKind | undefined, state: JobState, path: JobState[] = []): JobView {
  const states = [...path, state];
  return {
    taskId: "t1",
    repoId: "demo",
    goal: "g",
    ...(kind ? { kind } : {}),
    state,
    timeline: states.map((s, i) => ({ ts: 1000 + i * 2000, state: s })),
  };
}

const labels = (j: JobView) => stepperFor(j).map((s) => s.label);
const statuses = (j: JobView) => stepperFor(j).map((s) => s.status);

describe("stepper per kind", () => {
  it("keeps the six steps of a change and of test writing", () => {
    const six = ["Plan", "Approve", "Build", "Test", "Review", "Report"];
    expect(labels(job(undefined, "created"))).toEqual(six);
    expect(labels(job("change", "developing"))).toEqual(six);
    expect(labels(job("write-tests", "developing"))).toEqual(six);
  });

  it("documentation has no test step and calls the first one Research", () => {
    const j = job("document", "awaiting_plan_approval", ["created", "analyzing"]);
    expect(labels(j)).toEqual(["Research", "Approve", "Build", "Review", "Report"]);
    expect(statuses(j)).toEqual(["done", "current", "pending", "pending", "pending"]);
    expect(stepperFor(j)[1]?.yourTurn).toBe(true);
  });

  it("a branch review is Review, Test, Report, with no plan to approve", () => {
    const first = job("review-branch", "created");
    expect(labels(first)).toEqual(["Review", "Test", "Report"]);
    expect(statuses(first)).toEqual(["current", "pending", "pending"]);
    expect(stepperFor(first).some((s) => s.yourTurn)).toBe(false);

    const testing = job("review-branch", "testing", ["reviewing"]);
    expect(statuses(testing)).toEqual(["done", "current", "pending"]);
    expect(stepperFor(testing)[0]?.durationMs).toBe(2000);

    const done = job("review-branch", "delivered", ["reviewing", "testing", "report_ready"]);
    expect(statuses(done)).toEqual(["done", "done", "done"]);
    expect(compactStep(stepperFor(done))?.text).toBe("Done 3/3");
  });

  it("marks the step where a branch review or a documentation job failed", () => {
    const review = job("review-branch", "delivered", ["reviewing", "testing", "failed", "report_ready"]);
    expect(statuses(review)).toEqual(["done", "failed", "pending"]);
    const docs = job("document", "delivered", ["created", "analyzing", "awaiting_plan_approval", "developing", "reviewing", "failed", "report_ready"]);
    expect(statuses(docs)).toEqual(["done", "done", "done", "failed", "pending"]);
    const rejected = job("write-tests", "cancelled", ["created", "analyzing", "awaiting_plan_approval"]);
    expect(stepperFor(rejected)[1]?.status).toBe("failed");
  });

  it("counts the steps of the kind in the compact form", () => {
    expect(compactStep(stepperFor(job("review-branch", "testing", ["reviewing"])))?.text).toBe("Test 2/3");
    expect(compactStep(stepperFor(job("document", "reviewing", ["created", "analyzing", "awaiting_plan_approval", "developing"])))?.text).toBe("Review 4/5");
  });
});

describe("panel state for the branch picker", () => {
  it("stores the branches, clears an engine error with them, and forgets them on a new floor", () => {
    const s = new PanelState();
    s.apply({ type: "error", code: "engine_unavailable", message: "down" });
    expect(s.apply({ type: "branches", projectId: "demo", current: "main", branches: ["main", "x"] })).toBe(true);
    expect(s.data.branches).toEqual({ current: "main", branches: ["main", "x"] });
    expect(s.engineError).toBeNull();
    s.apply({ type: "welcome", protocol: 1, room: { id: "lobby", name: "Lobby", heightmap: ["0"], door: { name: "door", x: 0, y: 0, dir: 0 }, anchors: [], furni: [] }, you: 1, avatars: [], agents: [] });
    expect(s.data.branches).toBeNull();
  });

  it("keeps a branch-list error when the review desk opens, so the panel can show it", () => {
    const s = new PanelState();
    s.apply({ type: "error", code: "engine_unavailable", message: "The project folder moved." });
    s.apply({ type: "open_panel", panel: "review" });
    expect(s.open).toBe("review");
    expect(s.engineError).toBe("The project folder moved.");
  });
});

describe("furniture drawings", () => {
  it("every piece of furniture of a kind has a drawing", () => {
    for (const id of ["review_desk", "test_lab", "library_shelf"]) {
      expect(FURNI_CATALOG[id]?.draw).toBe(id);
      expect(RECIPES[id]).toBeTypeOf("function");
    }
  });
});
