import { describe, expect, it } from "vitest";
import { DEFAULT_PIPELINE, validatePipeline } from "@agentlife/shared";
import type { PipelineMemberView, PipelineResponse, PipelineStep, PipelineStepKind } from "@agentlife/shared";
import {
  PIPELINE_NOTE,
  addStep,
  addableKinds,
  createPipelineEditor,
  dropIndex,
  errorsByStep,
  insertIndexFor,
  memberChoices,
  memberOfStep,
  moveStep,
  removeStep,
  sameSteps,
  setMember,
  type PipelineView,
} from "../src/ui/pipeline-editor.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { fakeDoc, findAll, html, textOf, type FakeElement } from "./fake-dom.ts";

const k = (...kinds: PipelineStepKind[]): PipelineStep[] => kinds.map((kind) => ({ kind }));
const MEMBERS: PipelineMemberView[] = [
  { id: "architect", displayName: "Architect", role: "architect", model: "m-a" },
  { id: "developer", displayName: "Developer", role: "developer", model: "m-d" },
  { id: "qa", displayName: "QA", role: "qa", model: "m-q" },
];
const REX: PipelineMemberView = { id: "reviewer-1", displayName: "Rex", role: "reviewer", model: "m-r" };
const RAE: PipelineMemberView = { id: "researcher-1", displayName: "Rae", role: "researcher", model: "m-s" };

function response(steps: readonly PipelineStep[] = DEFAULT_PIPELINE, members: PipelineMemberView[] = MEMBERS, customised = false): PipelineResponse {
  return { projectId: "alpha", customised, steps: steps.map((s) => ({ ...s })), members };
}

/** The editor with a state the test can change, re-rendered the way the panel does after a click. */
function mount(initial: PipelineView) {
  let view = initial;
  const saved: PipelineStep[][] = [];
  const events = { resets: 0 };
  const render = createPipelineEditor(fakeDoc(), { save: (s) => saved.push(s), reset: () => void (events.resets += 1) });
  let root = render(view, rerender);
  function rerender(): void {
    root = render(view, rerender);
  }
  return {
    get root() {
      return root;
    },
    saved,
    events,
    set(next: PipelineView) {
      view = next;
      rerender();
    },
  };
}

const withState = (state: PipelineResponse | null, extra: Partial<PipelineView> = {}): PipelineView => ({ state, error: null, ...extra });
const byLabel = (root: unknown, label: string): FakeElement => {
  const found = findAll(root, (e) => e.getAttribute("aria-label") === label);
  if (found.length !== 1) throw new Error(`${found.length} elements labelled '${label}'`);
  return found[0]!;
};
const cards = (root: unknown): FakeElement[] => findAll(root, (e) => e.className === "al-pipe-card");
const names = (root: unknown): string[] => cards(root).map((c) => c.dataset["kind"]!);
const action = (root: unknown, name: string): FakeElement | undefined => findAll(root, (e) => e.dataset["action"] === name)[0];

describe("pipeline editor helpers", () => {
  it("moves a step and keeps the others in order", () => {
    expect(moveStep(k("plan", "approve", "develop"), 0, 2).map((s) => s.kind)).toEqual(["approve", "develop", "plan"]);
    expect(moveStep(k("plan", "approve", "develop"), 2, 0).map((s) => s.kind)).toEqual(["develop", "plan", "approve"]);
    expect(moveStep(k("plan", "approve"), 0, 9).map((s) => s.kind)).toEqual(["approve", "plan"]);
    expect(moveStep(k("plan", "approve"), 5, 0).map((s) => s.kind)).toEqual(["plan", "approve"]);
    const original = k("plan", "approve");
    expect(moveStep(original, 0, 1)).not.toBe(original);
  });

  it("offers the kinds that are not there, and puts a new step where it breaks no rule", () => {
    expect(addableKinds(DEFAULT_PIPELINE)).toEqual(["research", "second-review"]);
    expect(addStep(DEFAULT_PIPELINE, "research").map((s) => s.kind)).toEqual(["research", "plan", "approve", "develop", "test", "review", "report"]);
    expect(addStep(DEFAULT_PIPELINE, "second-review").map((s) => s.kind)).toEqual(["plan", "approve", "develop", "test", "review", "second-review", "report"]);
    expect(insertIndexFor(k("plan", "approve", "develop", "report"), "test")).toBe(3);
    expect(insertIndexFor(k("plan"), "report")).toBe(1);
    expect(insertIndexFor([], "plan")).toBe(0);
    // Adding the optional steps to the default pipeline always gives a valid one, for a team that has the members.
    const team = [...MEMBERS, REX, RAE];
    expect(validatePipeline(addStep(addStep(DEFAULT_PIPELINE, "research"), "second-review"), team).ok).toBe(true);
  });

  it("removes a step and sets or clears the member of one", () => {
    expect(removeStep(k("plan", "approve"), 0).map((s) => s.kind)).toEqual(["approve"]);
    expect(setMember(k("plan", "review"), 1, "qa")).toEqual([{ kind: "plan" }, { kind: "review", memberId: "qa" }]);
    expect(setMember([{ kind: "review", memberId: "qa" }], 0, undefined)).toEqual([{ kind: "review" }]);
  });

  it("finds the card nearest to the pointer", () => {
    const centres = [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 10, y: 110 }];
    expect(dropIndex(centres, { x: 100, y: 20 })).toBe(1);
    expect(dropIndex(centres, { x: 0, y: 200 })).toBe(2);
    expect(dropIndex([], { x: 0, y: 0 })).toBe(0);
  });

  it("compares pipelines by kind and member, and groups the errors by step", () => {
    expect(sameSteps(k("plan"), [{ kind: "plan" }])).toBe(true);
    expect(sameSteps(k("plan"), [{ kind: "plan", memberId: "architect" }])).toBe(false);
    expect(sameSteps(k("plan"), k("plan", "approve"))).toBe(false);
    const check = validatePipeline(k("plan", "develop", "approve", "test", "review", "report", "second-review"), [...MEMBERS, REX]);
    const errors = errorsByStep(check);
    expect([...errors.keys()].sort()).toEqual([2, 5]);
    expect(errorsByStep({ ok: true }).size).toBe(0);
  });

  it("lists the members a step accepts, with the default first", () => {
    const team = [...MEMBERS, REX, RAE];
    expect(memberChoices({ kind: "review" }, team)).toEqual([
      { value: "", label: "Default: QA" },
      { value: "qa", label: "QA (qa)" },
      { value: "reviewer-1", label: "Rex (reviewer)" },
    ]);
    expect(memberChoices({ kind: "research" }, MEMBERS)[0]).toEqual({ value: "", label: "Default: nobody on the team yet" });
    expect(memberOfStep({ kind: "second-review" }, [...MEMBERS, REX])).toBe(REX);
    expect(memberOfStep({ kind: "approve" }, MEMBERS)).toBeUndefined();
  });
});

describe("pipeline editor panel", () => {
  it("shows the default pipeline as cards in order, with nothing to save", () => {
    const m = mount(withState(response()));
    expect(names(m.root)).toEqual(["plan", "approve", "develop", "test", "review", "report"]);
    expect(cards(m.root).every((c) => c.dataset["invalid"] === "false")).toBe(true);
    expect(textOf(m.root)).toContain(PIPELINE_NOTE);
    expect(textOf(m.root)).toContain("Model: m-q");
    expect(textOf(m.root)).toContain("You decide");
    expect(action(m.root, "save-pipeline")!.disabled).toBe(true);
    expect(action(m.root, "discard-pipeline")).toBeUndefined();
    expect(action(m.root, "reset-pipeline")).toBeUndefined();
    expect(findAll(m.root, (e) => e.dataset["add"] !== undefined).map((e) => e.dataset["add"])).toEqual(["research", "second-review"]);
  });

  it("marks a step that breaks a rule in red with the rule, and keeps Save off", () => {
    const m = mount(withState(response()));
    byLabel(m.root, "Move Approval later").click();
    expect(names(m.root)).toEqual(["plan", "develop", "approve", "test", "review", "report"]);
    const bad = cards(m.root).filter((c) => c.dataset["invalid"] === "true");
    expect(bad.map((c) => c.dataset["kind"])).toEqual(["approve"]);
    expect(textOf(bad[0])).toContain("Approval must come before Develop: nothing is built without your approval.");
    expect(action(m.root, "save-pipeline")!.disabled).toBe(true);
    expect(action(m.root, "save-pipeline")!.title).toBe("Fix the red steps first");
    // Moving it back makes the pipeline the saved one again: nothing to save, nothing red.
    byLabel(m.root, "Move Approval earlier").click();
    expect(cards(m.root).some((c) => c.dataset["invalid"] === "true")).toBe(false);
    expect(action(m.root, "save-pipeline")!.disabled).toBe(true);
  });

  it("explains a missing step for the pipeline as a whole, and offers to add it back", () => {
    const m = mount(withState(response()));
    byLabel(m.root, "Remove Tests").click();
    expect(textOf(m.root)).toContain("A pipeline needs a Tests step.");
    expect(action(m.root, "save-pipeline")!.disabled).toBe(true);
    findAll(m.root, (e) => e.dataset["add"] === "test")[0]!.click();
    expect(names(m.root)).toEqual(["plan", "approve", "develop", "test", "review", "report"]);
    expect(textOf(m.root)).not.toContain("A pipeline needs");
  });

  it("asks for a reviewer before the second review can be saved, then saves it", () => {
    const m = mount(withState(response()));
    findAll(m.root, (e) => e.dataset["add"] === "second-review")[0]!.click();
    expect(names(m.root)).toEqual(["plan", "approve", "develop", "test", "review", "second-review", "report"]);
    expect(textOf(m.root)).toContain("Second review needs a reviewer on the team. Hire one at the HR desk.");
    expect(action(m.root, "save-pipeline")!.disabled).toBe(true);

    // A reviewer is hired; the engine sends the team again with the same steps. The draft stays.
    m.set(withState(response(DEFAULT_PIPELINE, [...MEMBERS, REX])));
    expect(names(m.root)).toContain("second-review");
    expect(textOf(m.root)).not.toContain("needs a reviewer");
    expect(action(m.root, "save-pipeline")!.disabled).toBe(false);
    action(m.root, "save-pipeline")!.click();
    expect(m.saved).toEqual([[{ kind: "plan" }, { kind: "approve" }, { kind: "develop" }, { kind: "test" }, { kind: "review" }, { kind: "second-review" }, { kind: "report" }]]);
  });

  it("lets the user choose who does a step, and refuses the same model for the second review", () => {
    const sameModel = { ...REX, model: "m-q" };
    const m = mount(withState(response([...DEFAULT_PIPELINE.slice(0, 5), { kind: "second-review" }, { kind: "report" }], [...MEMBERS, sameModel], true)));
    expect(textOf(m.root)).toContain("The second review needs a different model than the Review (both use m-q).");
    // Choose Rex as the reviewer of the review step: the saved steps would carry the member.
    const reviewCard = cards(m.root).find((c) => c.dataset["kind"] === "review")!;
    const option = findAll(reviewCard, (e) => e.className === "al-select-option" && e.textContent.startsWith("Rex"))[0]!;
    option.click();
    expect(textOf(cards(m.root).find((c) => c.dataset["kind"] === "review")!)).toContain("Model: m-q");
    // Rex now does the review (model m-q) and the second review defaults to Rex too: someone else is needed.
    expect(textOf(m.root)).toContain("The second review needs someone other than the Review.");
  });

  it("keeps the draft when the same pipeline arrives again, drops it when the saved steps change, and can discard it", () => {
    const m = mount(withState(response()));
    byLabel(m.root, "Move Plan later").click();
    expect(names(m.root)[0]).toBe("approve");
    m.set(withState(response())); // a job update re-rendered the board
    expect(names(m.root)[0]).toBe("approve");
    expect(action(m.root, "discard-pipeline")).toBeDefined();
    action(m.root, "discard-pipeline")!.click();
    expect(names(m.root)[0]).toBe("plan");
    byLabel(m.root, "Move Plan later").click();
    m.set(withState(response(addStep(DEFAULT_PIPELINE, "research").map((s) => ({ ...s })), [...MEMBERS, RAE], true)));
    expect(names(m.root)[0]).toBe("research");
  });

  it("offers the way back to the default only for a pipeline that was changed", () => {
    const m = mount(withState(response(DEFAULT_PIPELINE, MEMBERS, true)));
    action(m.root, "reset-pipeline")!.click();
    expect(m.events.resets).toBe(1);
  });

  it("disables the arrows at the ends", () => {
    const m = mount(withState(response()));
    expect(byLabel(m.root, "Move Plan earlier").disabled).toBe(true);
    expect(byLabel(m.root, "Move Report later").disabled).toBe(true);
    expect(byLabel(m.root, "Move Plan later").disabled).toBe(false);
  });

  it("says what is going on instead of the editor: locked demo, loading, an error", () => {
    expect(textOf(mount(withState(null, { locked: "off in the demo" })).root)).toContain("off in the demo");
    expect(textOf(mount(withState(response(), { locked: "off in the demo" })).root)).not.toContain("Save pipeline");
    expect(textOf(mount(withState(null)).root)).toContain("Loading the pipeline");
    const failed = mount(withState(null, { error: "The pipeline editor needs the real engine." }));
    expect(textOf(failed.root)).toContain("needs the real engine");
    expect(findAll(failed.root, (e) => e.className === "al-error")).toHaveLength(1);
    // A refusal on top of an editor stays visible.
    expect(textOf(mount(withState(response(), { error: "Approval must come before Develop." })).root)).toContain("Approval must come before Develop.");
  });

  it("shows names and models as text, never as markup", () => {
    const evil = { ...REX, displayName: "<img src=x onerror=1>", model: "<b>m</b>" };
    const m = mount(withState(response([...DEFAULT_PIPELINE.slice(0, 5), { kind: "second-review", memberId: "reviewer-1" }, { kind: "report" }], [...MEMBERS, evil], true)));
    const out = html(m.root);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;img src=x onerror=1&gt;");
  });
});

describe("panel state for the pipeline", () => {
  it("keeps the latest pipeline, reports a change only while the board is open, and forgets it on a new floor", () => {
    const s = new PanelState();
    expect(s.apply({ type: "pipeline", state: response() })).toBe(false);
    s.open = "board";
    expect(s.apply({ type: "pipeline", state: response() })).toBe(false); // the same again
    expect(s.apply({ type: "pipeline", state: response(addStep(DEFAULT_PIPELINE, "research"), [...MEMBERS, RAE], true) })).toBe(true);
    expect(s.pipeline?.customised).toBe(true);
    s.apply({ type: "error", code: "pipeline_error", message: "Approval must come before Develop." });
    expect(s.pipelineError).toBe("Approval must come before Develop.");
    s.apply({ type: "pipeline", state: response() });
    expect(s.pipelineError).toBeNull();
    s.apply({ type: "error", code: "pipeline_error", message: "again" });
    s.apply({ type: "open_panel", panel: "board" });
    expect(s.pipelineError).toBeNull();
    s.apply({ type: "error", code: "pipeline_error", message: "once more" });
    s.close();
    expect(s.apply({ type: "error", code: "pipeline_error", message: "x" })).toBe(false);
  });
});
