import { describe, expect, it } from "vitest";
import { MEMORY_TEXT_MAX } from "@agentlife/shared";
import type { MemoryEntry, MemoryKind, MemoryProposal, MemoryState, Report } from "@agentlife/shared";
import type { PanelContent } from "../src/ui/computer.ts";
import { createLibraryPanel, filterEntries, groupByKind, renderRememberCard, sourceLabel, textProblem } from "../src/ui/library.ts";
import type { LibraryActions, LibraryView } from "../src/ui/library.ts";
import { renderMailbox } from "../src/ui/mailbox.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import type { PanelData } from "../src/ui/panel-state.ts";
import { fakeDoc, findAll, html, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const entry = (n: number, text: string, kind: MemoryKind = "convention", sourceTaskId = "task-1a2b3c4d"): MemoryEntry => ({
  id: `mem-00000${n}`,
  kind,
  text,
  sourceTaskId,
  createdAt: 1_700_000_000_000 + n,
});
const proposal = (n: number, text: string, kind: MemoryKind = "pitfall", sourceTaskId = "task-9f8e7d6c"): MemoryProposal => ({
  id: `prop-00000${n}`,
  kind,
  text,
  sourceTaskId,
  createdAt: 1_700_000_000_000 + n,
});

const memory = (over: Partial<MemoryState> = {}): MemoryState => ({ entries: [], proposals: [], autoRemember: false, learning: [], ...over });

const data = (over: Partial<PanelData> = {}): PanelData => ({ repos: [], projects: [], job: null, approvals: [], reports: [], details: null, ...over });

const report = (taskId: string, over: Partial<Report> = {}): Report => ({ reportId: `rep-${taskId}`, taskId, title: "Report", markdown: "# Report\n", ...over });

const by = (root: unknown, key: string, value: string) => findAll(root, (e) => e.dataset[key] === value);
const buttons = (root: unknown, label: string) => findAll(root, (e) => e.tagName === "button" && textOf(e) === label);

function harness(initial: Partial<LibraryView> = {}, pd: PanelData = data()) {
  const calls: string[] = [];
  const actions: LibraryActions = {
    edit: (id, patch) => calls.push(`edit:${id}:${patch.kind}:${patch.text}`),
    remove: (id) => calls.push(`remove:${id}`),
    accept: (id, edit) => calls.push(`accept:${id}:${edit ? `${edit.kind}:${edit.text}` : "-"}`),
    dismiss: (id) => calls.push(`dismiss:${id}`),
    setAuto: (on) => calls.push(`auto:${on}`),
    openReport: (id) => calls.push(`open:${id}`),
  };
  let docsShown = 0;
  const panel = createLibraryPanel(fakeDoc(), actions, () => {
    docsShown += 1;
    const body = fakeDoc().createElement("div");
    body.textContent = "docs form";
    return { body } as PanelContent;
  });
  let view: LibraryView = { memory: null, error: null, ...initial };
  let current!: PanelContent;
  let d = pd;
  const render = (): PanelContent => {
    current = panel(d, view, null, () => render());
    return current;
  };
  render();
  return {
    calls,
    get body() {
      return current.body;
    },
    get docsShown() {
      return docsShown;
    },
    set(next: Partial<LibraryView>) {
      view = { ...view, ...next };
      render();
    },
    setData(next: PanelData) {
      d = next;
      render();
    },
  };
}

describe("library helpers", () => {
  const entries = [entry(1, "Tests live next to the module.", "convention"), entry(2, "Dates are UTC milliseconds.", "decision"), entry(3, "Never edit the lockfile by hand.", "pitfall"), entry(4, "Titles are trimmed.", "convention")];

  it("filters by every search word and by kind, keeping the order", () => {
    expect(filterEntries(entries, "", "all")).toEqual(entries);
    expect(filterEntries(entries, "TESTS module", "all").map((e) => e.id)).toEqual(["mem-000001"]);
    expect(filterEntries(entries, "the", "convention").map((e) => e.id)).toEqual(["mem-000001"]);
    expect(filterEntries(entries, "", "pitfall").map((e) => e.id)).toEqual(["mem-000003"]);
    expect(filterEntries(entries, "nothing like this", "all")).toEqual([]);
  });

  it("groups by kind in a fixed order and leaves out empty kinds", () => {
    expect(groupByKind(entries).map((g) => [g.kind, g.entries.length])).toEqual([
      ["decision", 1],
      ["convention", 2],
      ["pitfall", 1],
    ]);
    expect(groupByKind([])).toEqual([]);
  });

  it("names the source job and checks a text before it is sent", () => {
    expect(sourceLabel("task-1a2b3c4d")).toBe("Job 1a2b3c4d");
    expect(textProblem("  ")).toBe("Write something to remember.");
    expect(textProblem("x".repeat(MEMORY_TEXT_MAX + 1))).toContain(`under ${MEMORY_TEXT_MAX}`);
    expect(textProblem("fine")).toBeUndefined();
  });
});

describe("library panel", () => {
  it("waits for data, shows an error, and explains the demo", () => {
    const h = harness();
    expect(textOf(h.body)).toContain("Opening the Library");
    h.set({ error: "the Library needs the real engine" });
    expect(textOf(h.body)).toContain("the Library needs the real engine");
    h.set({ locked: "off in the demo" });
    expect(textOf(h.body)).toContain("off in the demo");
  });

  it("says what an empty Library is for", () => {
    const h = harness({ memory: memory() });
    expect(textOf(h.body)).toContain("Nothing remembered yet");
  });

  it("lists the notes by kind with their source job, and puts proposals first", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "Tests live next to the module."), entry(2, "Dates are UTC.", "decision")], proposals: [proposal(5, "Do not skip the empty title check.")] }) });
    const text = textOf(h.body);
    expect(text).toContain("Waiting for your decision (1)");
    expect(text).toContain("Remembered (2)");
    expect(text.indexOf("Waiting for your decision")).toBeLessThan(text.indexOf("Remembered"));
    expect(text).toContain("Decision (1)");
    expect(text).toContain("Convention (1)");
    expect(text).toContain("Job 1a2b3c4d");
    expect(by(h.body, "entry", "mem-000002")).toHaveLength(1);
    expect(by(h.body, "proposal", "prop-000005")).toHaveLength(1);
  });

  it("keeps a note's text as text: raw HTML never becomes an element", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "<img src=x onerror=alert(1)> done")] }) });
    expect(html(h.body)).toContain("&lt;img src=x onerror=alert(1)&gt; done");
    expect(findAll(h.body, (e) => e.tagName === "img")).toHaveLength(0);
  });

  it("remembers, edits and skips a proposal", () => {
    const h = harness({ memory: memory({ proposals: [proposal(5, "Do not skip the empty title check."), proposal(6, "Cache is cleared on start.", "finding")] }) });
    const first = by(h.body, "proposal", "prop-000005")[0]!;
    buttons(first, "Remember")[0]!.click();
    buttons(by(h.body, "proposal", "prop-000006")[0]!, "Skip")[0]!.click();
    expect(h.calls).toEqual(["accept:prop-000005:-", "dismiss:prop-000006"]);

    buttons(by(h.body, "proposal", "prop-000005")[0]!, "Edit first")[0]!.click();
    const card = by(h.body, "proposal", "prop-000005")[0]!;
    const area = findAll(card, (e) => e.tagName === "textarea")[0]!;
    expect(area.value).toBe("Do not skip the empty title check.");
    area.value = "  Never skip   the empty title check.  ";
    area.fire("input");
    buttons(card, "Remember")[0]!.click();
    expect(h.calls.at(-1)).toBe("accept:prop-000005:pitfall:Never skip the empty title check.");
  });

  it("refuses an empty or too long text on the spot, and Cancel drops the draft", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "Tests live next to the module.")] }) });
    buttons(by(h.body, "entry", "mem-000001")[0]!, "Edit")[0]!.click();
    let card = by(h.body, "entry", "mem-000001")[0]!;
    const area = findAll(card, (e) => e.tagName === "textarea")[0]!;
    area.value = "   ";
    area.fire("input");
    buttons(card, "Save")[0]!.click();
    expect(textOf(card)).toContain("Write something to remember.");
    area.value = "x".repeat(MEMORY_TEXT_MAX + 1);
    area.fire("input");
    buttons(card, "Save")[0]!.click();
    expect(textOf(card)).toContain("under");
    expect(h.calls).toEqual([]);
    buttons(card, "Cancel")[0]!.click();
    card = by(h.body, "entry", "mem-000001")[0]!;
    expect(findAll(card, (e) => e.tagName === "textarea")).toHaveLength(0);
  });

  it("saves an edited note with its kind and text", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "Tests live next to the module.")] }) });
    buttons(by(h.body, "entry", "mem-000001")[0]!, "Edit")[0]!.click();
    const card = by(h.body, "entry", "mem-000001")[0]!;
    findAll(card, (e) => e.attributes.get("role") === "option" && textOf(e) === "Decision")[0]!.click();
    const area = findAll(card, (e) => e.tagName === "textarea")[0]!;
    area.value = "Tests sit beside the module.";
    area.fire("input");
    buttons(card, "Save")[0]!.click();
    expect(h.calls).toEqual(["edit:mem-000001:decision:Tests sit beside the module."]);
  });

  it("asks twice before it deletes", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "Tests live next to the module.")] }) });
    buttons(by(h.body, "entry", "mem-000001")[0]!, "Delete")[0]!.click();
    expect(h.calls).toEqual([]);
    buttons(by(h.body, "entry", "mem-000001")[0]!, "Keep")[0]!.click();
    buttons(by(h.body, "entry", "mem-000001")[0]!, "Delete")[0]!.click();
    buttons(by(h.body, "entry", "mem-000001")[0]!, "Really delete")[0]!.click();
    expect(h.calls).toEqual(["remove:mem-000001"]);
  });

  it("searches the notes without drawing the whole panel again", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "Tests live next to the module."), entry(2, "Dates are UTC.", "decision")] }) });
    const search = findAll(h.body, (e) => e.tagName === "input" && e.type === "search")[0]!;
    search.value = "utc";
    search.fire("input");
    expect(by(h.body, "entry", "mem-000001")).toHaveLength(0);
    expect(by(h.body, "entry", "mem-000002")).toHaveLength(1);
    search.value = "zzz";
    search.fire("input");
    expect(textOf(h.body)).toContain("No note matches.");
  });

  it("switches auto-remember", () => {
    const h = harness({ memory: memory() });
    const box = by(h.body, "action", "auto-remember")[0] as FakeElement & { checked: boolean };
    box.checked = true;
    box.fire("change");
    expect(h.calls).toEqual(["auto:true"]);
  });

  it("links a note to its job's report while the floor still has it", () => {
    const h = harness({ memory: memory({ entries: [entry(1, "Tests live next to the module.", "convention", "task-aaaa1111")] }) }, data({ reports: [report("task-aaaa1111")] }));
    buttons(h.body, "Open its report")[0]!.click();
    expect(h.calls).toEqual(["open:rep-task-aaaa1111"]);
    h.setData(data());
    expect(buttons(h.body, "Open its report")).toHaveLength(0);
  });

  it("keeps the docs form on a second tab, with its footer", () => {
    const h = harness({ memory: memory() });
    expect(h.docsShown).toBe(0);
    buttons(h.body, "Write docs")[0]!.click();
    expect(h.docsShown).toBeGreaterThan(0);
    expect(textOf(h.body)).toContain("docs form");
    buttons(h.body, "Memory")[0]!.click();
    expect(textOf(h.body)).toContain("Nothing remembered yet");
  });

  it("tells the user the librarian is still reading a job", () => {
    const h = harness({ memory: memory({ learning: ["task-1"] }) });
    expect(textOf(h.body)).toContain("The librarian is reading a finished job");
  });
});

describe("Remember this? card", () => {
  const actions = () => {
    const calls: string[] = [];
    return {
      calls,
      accept: (id: string) => void calls.push(`accept:${id}`),
      dismiss: (id: string) => void calls.push(`dismiss:${id}`),
      setAuto: (on: boolean) => void calls.push(`auto:${on}`),
    };
  };

  it("is absent without a Library, and when this job has nothing and nothing is being written", () => {
    const a = actions();
    expect(renderRememberCard(fakeDoc(), "task-1", null, a)).toBeNull();
    expect(renderRememberCard(fakeDoc(), "task-1", memory({ proposals: [proposal(1, "x", "pitfall", "task-2")] }), a)).toBeNull();
  });

  it("says the librarian is reading while it works", () => {
    const card = renderRememberCard(fakeDoc(), "task-1", memory({ learning: ["task-1"] }), actions())!;
    expect(card.dataset["remember"]).toBe("reading");
    expect(textOf(card)).toContain("Remember this?");
    expect(textOf(card)).toContain("reading this job");
  });

  it("offers only this job's notes, with Remember and Skip, and the auto switch", () => {
    const a = actions();
    const card = renderRememberCard(fakeDoc(), "task-1", memory({ proposals: [proposal(1, "Mine one.", "pitfall", "task-1"), proposal(2, "Another job's.", "pitfall", "task-2")] }), a)!;
    expect(textOf(card)).toContain("Mine one.");
    expect(textOf(card)).not.toContain("Another job's.");
    buttons(card, "Remember")[0]!.click();
    buttons(card, "Skip")[0]!.click();
    const box = by(card, "action", "auto-remember")[0] as FakeElement & { checked: boolean };
    box.checked = true;
    box.fire("change");
    expect(a.calls).toEqual(["accept:prop-000001", "dismiss:prop-000001", "auto:true"]);
  });

  it("shows in the open report of the mailbox, not in the list and not for the morning summary", () => {
    const a = actions();
    const pd = data({ reports: [report("task-1"), report("night-1", { kind: "night" })] });
    const mem = memory({ proposals: [proposal(1, "Mine one.", "pitfall", "task-1"), proposal(2, "Night note.", "pitfall", "night-1")] });
    const mailbox = (reading: string | null, withActions = true) =>
      renderMailbox(fakeDoc(), pd, { decide: () => {}, openReport: () => {}, back: () => {}, ...(withActions ? { remember: a } : {}) }, { reading, unread: new Set(), memory: mem, memoryError: null });
    expect(textOf(mailbox("rep-task-1"))).toContain("Remember this?");
    expect(textOf(mailbox("rep-task-1", false))).not.toContain("Remember this?");
    expect(textOf(mailbox("rep-night-1"))).not.toContain("Remember this?");
    expect(textOf(mailbox(null))).not.toContain("Remember this?");
    const refused = renderMailbox(fakeDoc(), pd, { decide: () => {}, openReport: () => {}, back: () => {}, remember: a }, { reading: "rep-task-1", unread: new Set(), memory: mem, memoryError: "The Library of this project is full." });
    expect(textOf(refused)).toContain("The Library of this project is full.");
  });
});

describe("panel state of the Library", () => {
  it("takes the state of the floor, re-renders only a change, and forgets it on another floor", () => {
    const s = new PanelState();
    const m = memory({ entries: [entry(1, "Tests live next to the module.")] });
    expect(s.apply({ type: "memory", projectId: "alpha", state: m })).toBe(false);
    s.open = "library";
    expect(s.apply({ type: "memory", projectId: "alpha", state: m })).toBe(false);
    expect(s.apply({ type: "memory", projectId: "alpha", state: memory({ entries: [], autoRemember: true }) })).toBe(true);
    s.open = "mailbox";
    expect(s.apply({ type: "memory", projectId: "alpha", state: m })).toBe(true);
    expect(s.memory).toEqual(m);
    s.apply({ type: "welcome", protocol: 1, room: { id: "lobby" } as never, you: 1, avatars: [], agents: [] });
    expect(s.memory).toBeNull();
  });

  it("shows a refusal in the Library and the mailbox, clears it when the panel opens, and ignores other panels", () => {
    const s = new PanelState();
    expect(s.apply({ type: "error", code: "memory_error", message: "The Library already holds this." })).toBe(false);
    s.open = "library";
    expect(s.apply({ type: "error", code: "memory_error", message: "The Library already holds this." })).toBe(true);
    expect(s.memoryError).toBe("The Library already holds this.");
    s.apply({ type: "open_panel", panel: "library" });
    expect(s.memoryError).toBeNull();
    expect(s.apply({ type: "error", code: "engine_unavailable", message: "the Library needs the real engine" })).toBe(true);
    expect(s.memoryError).toBe("the Library needs the real engine");
  });
});
