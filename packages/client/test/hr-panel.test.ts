import { describe, expect, it } from "vitest";
import type { CatalogueEntry, HrState, ImportView, TeamMember, TeamPick, TeamSuggestion } from "@agentlife/shared";
import { createHrPanel, importStatusText, nameProblem, reviewText, standing } from "../src/ui/hr.ts";
import type { HrView } from "../src/ui/hr.ts";
import type { PanelContent } from "../src/ui/computer.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { fakeDoc, findAll, html, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const member = (id: string, role: TeamMember["role"], displayName: string, templateId = role as string): TeamMember => ({ id, role, displayName, templateId, model: "auto" });
const entry = (id: string, role: CatalogueEntry["role"], over: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  id,
  name: id,
  role,
  tier: role === "developer" ? "write-in-worktree" : "read-only",
  defaultModel: "claude-haiku-5.5",
  description: `${id} does ${role} work.`,
  source: "built-in",
  origin: "built-in",
  ...over,
});
const imp = (over: Partial<ImportView> = {}): ImportView => ({
  id: "poet-qa",
  url: "https://templates.example.org/agents/poet.json",
  name: "Poet QA",
  role: "qa",
  tier: "read-only",
  description: "A QA that writes in verse.",
  persona: "You are a QA who writes in verse. <b>bold</b>",
  defaultModel: "auto",
  hash: "a".repeat(64),
  ignored: ["tools", "permissions"],
  review: { verdict: "pass", flags: [], checkedBy: "checks" },
  status: "pending",
  importedAt: 1,
  ...over,
});
const hrState = (over: Partial<HrState> = {}): HrState => ({
  catalogue: [entry("architect", "architect"), entry("developer", "developer"), entry("qa", "qa"), entry("qa-fast", "qa")],
  teams: [
    {
      projectId: "alpha",
      name: "Alpha",
      customised: true,
      members: [member("architect", "architect", "Architect"), member("developer", "developer", "Developer"), member("qa", "qa", "QA"), member("qa-2", "qa", "Wren", "qa-fast"), member("res-1", "researcher", "Rue")],
    },
  ],
  imports: [],
  sources: [],
  models: { qa: ["auto", "claude-haiku-5.5"], architect: ["auto"], developer: ["auto"], researcher: ["auto"] },
  ...over,
});

function harness(initial: Partial<HrView> = {}) {
  const calls: string[] = [];
  const applied: TeamPick[][] = [];
  const panel = createHrPanel(fakeDoc(), {
    hire: (p, t, n, m) => calls.push(`hire:${p}:${t}:${n}:${m ?? ""}`),
    rename: (p, id, n) => calls.push(`rename:${p}:${id}:${n}`),
    setModel: (p, id, m) => calls.push(`model:${p}:${id}:${m}`),
    fire: (p, id) => calls.push(`fire:${p}:${id}`),
    importFrom: (u) => calls.push(`import:${u}`),
    approve: (id, h) => calls.push(`approve:${id}:${h.slice(0, 4)}`),
    reject: (id) => calls.push(`reject:${id}`),
    suggest: (p) => calls.push(`suggest:${p}`),
    apply: (p, picks) => {
      calls.push(`apply:${p}`);
      applied.push(picks);
    },
  });
  let content: PanelContent;
  let view: HrView = { hr: hrState(), error: null, suggestion: null, busy: null, ...initial };
  const render = (): PanelContent => (content = panel(view, render));
  render();
  return {
    calls,
    applied,
    get body() {
      return content.body;
    },
    set(next: Partial<HrView>) {
      view = { ...view, ...next };
      render();
    },
    tab(name: string) {
      findAll(content.body, (e) => e.dataset["tab"] === name)[0]!.click();
    },
  };
}

const byAction = (root: unknown, action: string) => findAll(root, (e) => e.dataset["action"] === action);
const field = (root: unknown, name: string) => findAll(root, (e) => e.dataset["field"] === name);
const type = (e: FakeElement, v: string) => {
  e.value = v;
  e.fire("input");
};

describe("helpers", () => {
  it("checks a name with the protocol's own rule", () => {
    expect(nameProblem("Wren")).toBeUndefined();
    expect(nameProblem("Jo-Ann O'Neil")).toBeUndefined();
    expect(nameProblem("")).toBeTruthy();
    expect(nameProblem("x".repeat(31))).toBeTruthy();
    expect(nameProblem("<script>")).toBeTruthy();
  });

  it("puts the first member of a role with a desk at the desk, and everybody else on the floor (a second QA, a reviewer, a researcher)", () => {
    const s = standing([member("a", "qa", "A"), member("b", "qa", "B"), member("c", "architect", "C"), member("d", "reviewer", "D"), member("e", "researcher", "E")]);
    expect([...s]).toEqual([
      ["a", "desk"],
      ["b", "floor"],
      ["c", "desk"],
      ["d", "floor"],
      ["e", "floor"],
    ]);
  });

  it("words the import status and the review", () => {
    expect(importStatusText({ status: "pending" })).toBe("Waits for you");
    expect(importStatusText({ status: "update_pending" })).toBe("Update waits for you");
    expect(importStatusText({ status: "approved" })).toBe("Approved");
    expect(reviewText({ review: { verdict: "pass", flags: [], checkedBy: "checks" } })).toContain("nothing found");
    expect(reviewText({ review: { verdict: "concerns", flags: ["x"], checkedBy: "checks+agent" } })).toContain("security agent");
  });
});

describe("Teams tab", () => {
  it("lists the members of each project with where they stand", () => {
    const h = harness();
    const rows = findAll(h.body, (e) => e.dataset["member"] !== undefined);
    expect(rows.map((r) => [r.dataset["member"], r.dataset["standing"]])).toEqual([
      ["architect", "desk"],
      ["developer", "desk"],
      ["qa", "desk"],
      ["qa-2", "floor"],
      ["res-1", "floor"],
    ]);
    expect(textOf(rows[3])).toContain("on the floor");
    expect(textOf(rows[4])).toContain("on the floor");
    expect(textOf(h.body)).not.toContain("bench");
    expect(textOf(h.body)).toContain("Default team".replace("Default", "Custom"));
  });

  it("renames, changes the model and fires from the member's row", () => {
    const h = harness();
    const row = findAll(h.body, (e) => e.dataset["member"] === "qa-2")[0]!;
    type(field(row, "rename")[0]!, "Wren II");
    byAction(row, "rename")[0]!.click();
    const model = field(row, "model")[0]!;
    model.value = "claude-haiku-5.5";
    model.fire("change");
    byAction(row, "fire")[0]!.click();
    expect(h.calls).toEqual(["rename:alpha:qa-2:Wren II", "model:alpha:qa-2:claude-haiku-5.5", "fire:alpha:qa-2"]);
  });

  it("does not send a rename to the same name, and shows a bad name instead of sending it", () => {
    const h = harness();
    const row = findAll(h.body, (e) => e.dataset["member"] === "qa-2")[0]!;
    byAction(row, "rename")[0]!.click();
    expect(h.calls).toEqual([]);
    type(field(row, "rename")[0]!, "<script>");
    byAction(findAll(h.body, (e) => e.dataset["member"] === "qa-2")[0]!, "rename")[0]!.click();
    expect(h.calls).toEqual([]);
    expect(textOf(h.body)).toContain("Name:");
  });

  it("hires the chosen template under the typed name, and keeps what was typed when the panel redraws", () => {
    const h = harness();
    type(field(h.body, "hire-name")[0]!, "Vera");
    const template = field(h.body, "template")[0]!;
    template.value = "qa-fast";
    template.fire("change");
    // The change redrew the panel: the name is still there and the chosen template too.
    expect(field(h.body, "hire-name")[0]!.value).toBe("Vera");
    expect(field(h.body, "template")[0]!.value).toBe("qa-fast");
    byAction(h.body, "hire")[0]!.click();
    expect(h.calls).toEqual(["hire:alpha:qa-fast:Vera:"]);
  });

  it("asks for a name before it hires", () => {
    const h = harness();
    byAction(h.body, "hire")[0]!.click();
    expect(h.calls).toEqual([]);
    expect(textOf(h.body)).toContain("Name:");
  });

  it("asks the HR agent, shows its proposal, and applies it only when the user presses the button", () => {
    const h = harness();
    byAction(h.body, "suggest")[0]!.click();
    expect(h.calls).toEqual(["suggest:alpha"]);
    h.set({ busy: "alpha" });
    expect(byAction(h.body, "suggest")[0]!.disabled).toBe(true);
    expect(textOf(h.body)).toContain("Asking the HR agent");

    const suggestion: TeamSuggestion = {
      projectId: "alpha",
      summary: "A small project, so a quick QA fits.",
      by: "agent",
      picks: [{ templateId: "qa-fast", templateName: "Fast QA", role: "qa", displayName: "Moss", model: "auto", why: "Few files.", replacesId: "qa", replacesName: "QA" }],
    };
    h.set({ busy: null, suggestion });
    const text = textOf(h.body);
    expect(text).toContain("The HR agent suggests");
    expect(text).toContain("Fast QA as Moss");
    expect(text).toContain("instead of QA");
    expect(h.calls).toEqual(["suggest:alpha"]); // nothing hired yet
    byAction(h.body, "apply")[0]!.click();
    expect(h.calls).toEqual(["suggest:alpha", "apply:alpha"]);
    expect(h.applied[0]).toEqual([{ templateId: "qa-fast", displayName: "Moss", model: "auto", replacesId: "qa" }]);
  });

  it("says when the proposal came from the fixed rules, and when the team already fits", () => {
    const h = harness({ suggestion: { projectId: "alpha", summary: "The standard team fits.", by: "rules", picks: [] } });
    const text = textOf(h.body);
    expect(text).toContain("fixed rules");
    expect(text).toContain("the current team fits");
    expect(byAction(h.body, "apply")).toHaveLength(0);
  });

  it("explains that there is nothing to do without projects", () => {
    const h = harness({ hr: hrState({ teams: [] }) });
    expect(textOf(h.body)).toContain("no projects yet");
  });
});

describe("Catalogue tab", () => {
  it("lists every template with its role, tier and whether it is imported", () => {
    const h = harness({ hr: hrState({ catalogue: [entry("qa", "qa"), entry("poet-qa", "qa", { origin: "imported", source: "https://templates.example.org/x.json" }), entry("developer", "developer")] }) });
    h.tab("catalogue");
    const cards = findAll(h.body, (e) => e.dataset["template"] !== undefined);
    expect(cards.map((c) => c.dataset["template"])).toEqual(["qa", "poet-qa", "developer"]);
    expect(textOf(cards[1])).toContain("imported");
    expect(textOf(cards[2])).toContain("writes only in its own copy");
  });

  it("says that the intern runs on this computer and is free", () => {
    const h = harness({ hr: hrState({ catalogue: [entry("qa", "qa"), entry("night-intern", "researcher", { runtime: "ollama", defaultModel: "qwen3.5:4b" })] }) });
    h.tab("catalogue");
    const cards = findAll(h.body, (e) => e.dataset["template"] !== undefined);
    expect(textOf(cards[1])).toContain("runs on this computer (qwen3.5:4b), free");
    expect(textOf(cards[0])).not.toContain("runs on this computer");
  });
});

describe("Imports tab", () => {
  it("says imports are off when no source is listed", () => {
    const h = harness();
    h.tab("imports");
    expect(textOf(h.body)).toContain("imports are off");
    expect(byAction(h.body, "import")).toHaveLength(0);
  });

  it("imports from a listed source", () => {
    const h = harness({ hr: hrState({ sources: ["https://templates.example.org/agents/poet.json"] }) });
    h.tab("imports");
    byAction(h.body, "import")[0]!.click();
    expect(h.calls).toEqual(["import:https://templates.example.org/agents/poet.json"]);
  });

  it("shows what an import is before the user approves: ignored fields, the review, the whole persona as text", () => {
    const h = harness({
      hr: hrState({
        sources: ["https://templates.example.org/agents/poet.json"],
        imports: [imp({ review: { verdict: "concerns", flags: ["it asks for the shell"], checkedBy: "checks+agent", note: "A note." } })],
      }),
    });
    h.tab("imports");
    const card = findAll(h.body, (e) => e.dataset["import"] === "poet-qa")[0]!;
    const text = textOf(card);
    expect(text).toContain("Waits for you");
    expect(text).toContain("Ignored for safety: tools, permissions");
    expect(text).toContain("read the concerns");
    expect(text).toContain("it asks for the shell");
    expect(text).toContain("A note.");
    // The persona is text, never markup.
    expect(text).toContain("<b>bold</b>");
    expect(findAll(card, (e) => e.tagName === "b")).toHaveLength(0);
    expect(html(card)).toContain("&lt;b&gt;bold&lt;/b&gt;");
    // The concerns are on the button too, so they are not missed (review suggestion).
    expect(textOf(byAction(card, "approve")[0]!)).toBe("Approve (1 concern)");
    expect(byAction(card, "approve")[0]!.dataset["flagged"]).toBe("true");
    byAction(card, "approve")[0]!.click();
    byAction(card, "reject")[0]!.click();
    expect(h.calls).toEqual(["approve:poet-qa:aaaa", "reject:poet-qa"]);
  });

  it("marks an approved template, and offers a waiting update as its own approval", () => {
    const h = harness({ hr: hrState({ imports: [imp({ status: "approved" }), imp({ id: "other", name: "Other", status: "update_pending" })] }) });
    h.tab("imports");
    const approved = findAll(h.body, (e) => e.dataset["import"] === "poet-qa")[0]!;
    expect(byAction(approved, "approve")).toHaveLength(0);
    const update = findAll(h.body, (e) => e.dataset["import"] === "other")[0]!;
    expect(textOf(byAction(update, "approve")[0])).toBe("Approve the update");
  });

  it("counts the imports that wait on the tab", () => {
    const h = harness({ hr: hrState({ imports: [imp(), imp({ id: "b", status: "approved" })] }) });
    const tab = findAll(h.body, (e) => e.dataset["tab"] === "imports")[0]!;
    expect(textOf(tab)).toBe("Imports (1)");
  });
});

describe("states", () => {
  it("shows the error above the desk, a loading note without data, and the lock text in the demo", () => {
    const h = harness({ hr: null, error: null });
    expect(textOf(h.body)).toContain("Loading the HR desk");
    h.set({ error: "Engine unavailable" });
    expect(textOf(h.body)).toContain("Engine unavailable");
    h.set({ hr: hrState(), error: "A team holds at most 8 members." });
    expect(findAll(h.body, (e) => e.attributes.get("role") === "alert").map(textOf)).toContain("A team holds at most 8 members.");
    h.set({ locked: "Off in the demo." });
    expect(textOf(h.body)).toBe("Off in the demo.");
  });
});

describe("PanelState for the HR desk", () => {
  const state = hrState();

  it("keeps the desk, the proposal and the busy flag, and clears them when the panel opens again", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "hr" });
    s.hrBusy = "alpha";
    expect(s.apply({ type: "hr", state })).toBe(true);
    expect(s.hr).toEqual(state);
    const suggestion: TeamSuggestion = { projectId: "alpha", summary: "x", by: "rules", picks: [] };
    expect(s.apply({ type: "hr_suggestion", suggestion })).toBe(true);
    expect(s.suggestion).toEqual(suggestion);
    expect(s.hrBusy).toBeNull();
    s.hrError = "old";
    s.apply({ type: "open_panel", panel: "hr" });
    expect([s.suggestion, s.hrError, s.hrBusy]).toEqual([null, null, null]);
  });

  it("shows a refusal and stops waiting for the HR agent", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "hr" });
    s.hrBusy = "alpha";
    expect(s.apply({ type: "error", code: "hr_error", message: "A team holds at most 8 members." })).toBe(true);
    expect(s.hrError).toBe("A team holds at most 8 members.");
    expect(s.hrBusy).toBeNull();
    s.hrBusy = "alpha";
    s.apply({ type: "error", code: "engine_unavailable", message: "cannot read the HR desk" });
    expect(s.hrError).toBe("cannot read the HR desk");
    expect(s.hrBusy).toBeNull();
  });

  it("does not redraw other panels for HR data", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "mailbox" });
    expect(s.apply({ type: "hr", state })).toBe(false);
    expect(s.apply({ type: "error", code: "hr_error", message: "no" })).toBe(false);
  });
});
