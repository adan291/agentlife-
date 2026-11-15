import { describe, expect, it } from "vitest";
import type { BugGroup, BugStatus, BugSummary } from "@agentlife/shared";
import { bugTime, countText, createBugSackPanel, filterBugs, statusCounts, whereText } from "../src/ui/bug-sack.ts";
import type { BugSackActions, BugSackView } from "../src/ui/bug-sack.ts";
import { fakeDoc, findAll, html, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const summary = (id: string, over: Partial<BugSummary> = {}): BugSummary => ({
  id: id.padEnd(16, "0"),
  component: "game",
  process: "client",
  kind: "uncaught",
  message: `message of ${id}`,
  frame: "draw@index.js",
  status: "open",
  count: 1,
  firstSeen: new Date(2026, 10, 15, 9, 5).getTime(),
  lastSeen: new Date(2026, 10, 15, 10, 30).getTime(),
  reopened: 0,
  last: {},
  shots: 0,
  ...over,
});

const group = (id: string, over: Partial<BugGroup> = {}): BugGroup => {
  const { shots: _shots, ...s } = summary(id);
  return { ...s, samples: [{ id: "b1abc", at: new Date(2026, 10, 15, 10, 30).getTime(), message: s.message, context: {}, shot: false }], ...over };
};

const view = (over: Partial<BugSackView> = {}): BugSackView => ({
  list: { groups: [], open: { game: 0, code: 0 } },
  selected: null,
  detail: null,
  shots: {},
  error: null,
  notice: null,
  fallbackText: null,
  ...over,
});

/** The panel with its actions recorded, re-rendered on demand like `panels.ts` does. */
function harness(v: BugSackView) {
  const calls: string[] = [];
  const actions: BugSackActions = {
    open: (id) => calls.push(`open ${id}`),
    back: () => calls.push("back"),
    setStatus: (id, status) => calls.push(`status ${id} ${status}`),
    shot: (sample) => calls.push(`shot ${sample}`),
    copy: (what) => calls.push(`copy ${JSON.stringify(what)}`),
  };
  const render = createBugSackPanel(fakeDoc(), actions);
  let content = render(v, () => (content = render(v, rerender)));
  const rerender = (): void => {
    content = render(v, rerender);
  };
  return {
    calls,
    reset: () => {
      render.reset();
      rerender();
    },
    get body() {
      return content.body;
    },
    get footer() {
      return content.footer;
    },
    byData: (key: string, value?: string): FakeElement[] => findAll(content.body, (e) => e.dataset[key] !== undefined && (value === undefined || e.dataset[key] === value)),
    buttons: (): string[] => findAll(content.body, (e) => e.tagName === "button").map((b) => textOf(b)),
  };
}

describe("texts", () => {
  it("writes a time as year, month, day, hour and minute in local time", () => {
    expect(bugTime(new Date(2026, 10, 5, 9, 7).getTime())).toBe("2026-11-05 09:07");
  });

  it("says where a bug happened, leaving out what is not known", () => {
    expect(whereText({})).toBe("");
    expect(whereText({ floor: "project:alpha", panel: "board", task: "t1", step: "developer" })).toBe("floor project:alpha, panel board, task t1, step developer");
    expect(whereText({ session: "S41", spec: "bug-sack" })).toBe("session S41, spec bug-sack");
  });

  it("writes a count", () => {
    expect(countText(3)).toBe("x3");
  });
});

describe("filterBugs and statusCounts", () => {
  const groups = [
    summary("aa", { message: "Cannot read x", kind: "uncaught" }),
    summary("bb", { message: "texture failed", kind: "pixi", status: "fixed" }),
    summary("cc", { message: "docker is gone", component: "code", process: "agent-engine", kind: "docker", last: { task: "t-77" } }),
    summary("dd", { message: "old noise", status: "ignored" }),
  ];

  it("keeps the groups of one component and one status", () => {
    expect(filterBugs(groups, { component: "game", status: "open", search: "" }).map((g) => g.id.slice(0, 2))).toEqual(["aa"]);
    expect(filterBugs(groups, { component: "game", status: "fixed", search: "" }).map((g) => g.id.slice(0, 2))).toEqual(["bb"]);
    expect(filterBugs(groups, { component: "code", status: "open", search: "" }).map((g) => g.id.slice(0, 2))).toEqual(["cc"]);
  });

  it("searches the message, the kind, the process and where, without regard to case", () => {
    const find = (search: string) => filterBugs(groups, { component: "code", status: "open", search }).length;
    expect(find("DOCKER")).toBe(1);
    expect(find("agent engine")).toBe(1);
    expect(find("agent-engine")).toBe(1);
    expect(find("t-77")).toBe(1);
    expect(find("  gone ")).toBe(1);
    expect(find("nothing like it")).toBe(0);
  });

  it("counts the groups of a component by status", () => {
    expect(statusCounts(groups, "game")).toEqual({ open: 1, fixed: 1, ignored: 1 });
    expect(statusCounts(groups, "code")).toEqual({ open: 1, fixed: 0, ignored: 0 });
  });
});

describe("the list", () => {
  const list = (groups: BugSummary[], open = { game: 0, code: 0 }) => view({ list: { groups, open } });

  it("says it is reading before the server answered, and why when it refused", () => {
    expect(textOf(harness(view({ list: null })).body)).toContain("Reading the Bug sack");
    const off = harness(view({ list: null, error: "The Bug sack is off on this server." }));
    expect(textOf(off.body)).toContain("The Bug sack is off on this server.");
    expect(html(off.body)).toContain("al-error");
  });

  it("an empty Game side says it has been quiet; the tabs carry the open counts", () => {
    const h = harness(list([], { game: 0, code: 2 }));
    expect(textOf(h.body)).toContain("Nothing caught yet. The game side has been quiet.");
    expect(h.byData("tab").map((t) => textOf(t))).toEqual(["Game", "Code (2)"]);
    expect(h.byData("tab", "game")[0]?.disabled).toBe(true);
    expect(h.footer).toBeUndefined();
  });

  it("lists the open groups of the tab, newest first as sent, with kind, count, times and where", () => {
    const h = harness(
      list(
        [summary("aa", { kind: "uncaught", count: 3, last: { floor: "lobby", panel: "shop" } }), summary("bb", { kind: "pixi", status: "fixed" }), summary("cc", { component: "code", process: "agent-engine" })],
        { game: 1, code: 1 },
      ),
    );
    const rows = h.byData("bug");
    expect(rows).toHaveLength(1);
    const text = textOf(rows[0]);
    expect(text).toContain("uncaught");
    expect(text).toContain("x3");
    expect(text).toContain("message of aa");
    expect(text).toContain("First 2026-11-15 09:05 · Last 2026-11-15 10:30");
    expect(text).toContain("floor lobby, panel shop");
  });

  it("a click on a group opens it", () => {
    const h = harness(list([summary("aa")], { game: 1, code: 0 }));
    h.byData("bug")[0]!.click();
    expect(h.calls).toEqual([`open ${"aa".padEnd(16, "0")}`]);
  });

  it("the tabs and filters switch what is listed and keep the choice across a re-render", () => {
    const groups = [summary("aa"), summary("bb", { status: "fixed" }), summary("cc", { component: "code", process: "agent-engine", kind: "docker" }), summary("dd", { status: "ignored" })];
    const h = harness(list(groups, { game: 1, code: 1 }));
    h.byData("filter", "fixed")[0]!.click();
    expect(h.byData("bug").map((e) => e.dataset["bug"]!.slice(0, 2))).toEqual(["bb"]);
    h.byData("filter", "ignored")[0]!.click();
    expect(h.byData("bug").map((e) => e.dataset["bug"]!.slice(0, 2))).toEqual(["dd"]);
    h.byData("tab", "code")[0]!.click();
    expect(textOf(h.body)).toContain("What the world-server, the agent engine, Docker, kiro-cli and the conductor caught.");
    expect(h.byData("bug")).toHaveLength(0);
    expect(textOf(h.body)).toContain("No bug is ignored.");
    h.byData("filter", "open")[0]!.click();
    expect(h.byData("bug").map((e) => e.dataset["bug"]!.slice(0, 2))).toEqual(["cc"]);
    expect(textOf(h.byData("filter", "open")[0])).toBe("Open (1)");
    expect(textOf(h.byData("filter", "fixed")[0])).toBe("Fixed (0)");
  });

  it("opens on the Game tab, the open filter and an empty search each time, whatever the user chose last time", () => {
    const groups = [summary("aa"), summary("bb", { status: "fixed" }), summary("cc", { component: "code", process: "agent-engine" })];
    const h = harness(list(groups, { game: 1, code: 1 }));
    h.byData("tab", "code")[0]!.click();
    h.byData("filter", "ignored")[0]!.click();
    const input = findAll(h.body, (e) => e.className.includes("al-bug-search"))[0]!;
    input.value = "docker";
    input.fire("input");
    h.reset();
    expect(h.byData("tab", "game")[0]?.disabled).toBe(true);
    expect(h.byData("filter", "open")[0]?.disabled).toBe(true);
    expect(findAll(h.body, (e) => e.className.includes("al-bug-search"))[0]?.value).toBe("");
    expect(h.byData("bug").map((e) => e.dataset["bug"]!.slice(0, 2))).toEqual(["aa"]);
  });

  it("an open tab with only fixed and ignored groups points to them", () => {
    const h = harness(list([summary("bb", { status: "fixed" })], { game: 0, code: 0 }));
    expect(textOf(h.body)).toContain("No open bugs. The ones you fixed or ignored are under their filters.");
  });

  it("the search narrows the rows as the user types, without drawing the panel again", () => {
    const h = harness(list([summary("aa", { message: "alpha trouble" }), summary("bb", { message: "beta trouble" })], { game: 2, code: 0 }));
    const input = findAll(h.body, (e) => e.className.includes("al-bug-search"))[0]!;
    expect(h.byData("bug")).toHaveLength(2);
    input.value = "beta";
    input.fire("input");
    expect(h.byData("bug").map((e) => textOf(e))).toEqual([expect.stringContaining("beta trouble")]);
    input.value = "zzz";
    input.fire("input");
    expect(h.byData("bug")).toHaveLength(0);
    expect(textOf(h.body)).toContain("Nothing matches that search.");
    // The same input is still in the panel: the user's focus and cursor were not taken away.
    expect(findAll(h.body, (e) => e.className.includes("al-bug-search"))[0]).toBe(input);
  });

  it("offers to copy every open bug of the tab when there is one", () => {
    const h = harness(list([summary("aa")], { game: 1, code: 0 }));
    const all = findAll(h.footer, (e) => e.dataset["copy"] === "all")[0]!;
    expect(textOf(all)).toBe("Copy all open game bugs for Kiro");
    all.click();
    expect(h.calls).toEqual([`copy {"component":"game"}`]);
    h.byData("tab", "code")[0]!.click();
    expect(h.footer).toBeUndefined();
  });

  it("marks a group that was fixed and came back", () => {
    const h = harness(list([summary("aa", { reopened: 2, shots: 1 })], { game: 1, code: 0 }));
    expect(textOf(h.body)).toContain("came back 2x");
    expect(textOf(h.body)).toContain("screenshot");
  });

  it("puts every text of a bug in as text, never as HTML", () => {
    const evil = "<img src=x onerror=alert(1)><script>alert(2)</script>";
    const h = harness(list([summary("aa", { message: evil, kind: "manual", last: { floor: evil } })], { game: 1, code: 0 }));
    const out = html(h.body);
    expect(out).not.toMatch(/<img|<script/);
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("the details of a group", () => {
  const detailView = (g: BugGroup, over: Partial<BugSackView> = {}) => view({ list: { groups: [summary(g.id)], open: { game: 1, code: 0 } }, selected: g.id, detail: g, ...over });

  it("waits for the details, with a way back", () => {
    const h = harness(view({ selected: "aa".padEnd(16, "0"), detail: null }));
    expect(textOf(h.body)).toContain("Reading the bug");
    findAll(h.body, (e) => e.tagName === "button" && textOf(e) === "Back to the list")[0]!.click();
    expect(h.calls).toEqual(["back"]);
  });

  it("shows the facts, the stack and every sample, the newest first", () => {
    const g = group("aa", {
      kind: "uncaught",
      count: 4,
      reopened: 1,
      last: { floor: "project:alpha", panel: "board" },
      samples: [
        { id: "b1", at: new Date(2026, 10, 15, 9, 0).getTime(), message: "older text", stack: "Error: older\n    at old (a.js:1:1)", context: {}, shot: false },
        { id: "b2", at: new Date(2026, 10, 15, 10, 30).getTime(), message: "message of aa", stack: "Error: newer\n    at draw (a.js:2:2)", note: "I clicked twice", context: { floor: "lobby" }, shot: false },
      ],
    });
    const h = harness(detailView(g));
    const text = textOf(h.body);
    expect(text).toContain("Seen4 times");
    expect(text).toContain("Where" + "floor project:alpha, panel board");
    expect(text).toContain("Came back1 time after it was marked fixed");
    expect(text).toContain("First framedraw@index.js");
    expect(text).toContain("The last 2 reports");
    expect(text.indexOf("Error: newer")).toBeLessThan(text.indexOf("Error: older"));
    expect(text).toContain("Note: I clicked twice");
    expect(text).toContain("older text");
    expect(h.byData("bugDetail")).toHaveLength(1);
  });

  it("an open group can be marked fixed or ignored; a closed one opened again", () => {
    const open = harness(detailView(group("aa")));
    expect(open.byData("mark").map((b) => b.dataset["mark"])).toEqual(["fixed", "ignored"]);
    open.byData("mark", "fixed")[0]!.click();
    open.byData("mark", "ignored")[0]!.click();
    expect(open.calls).toEqual([`status ${"aa".padEnd(16, "0")} fixed`, `status ${"aa".padEnd(16, "0")} ignored`]);

    const fixed = harness(detailView(group("aa", { status: "fixed" })));
    expect(fixed.byData("mark").map((b) => [textOf(b), b.dataset["mark"]])).toEqual([["Open again", "open"], ["Ignore", "ignored"]]);
    const ignored = harness(detailView(group("aa", { status: "ignored" })));
    expect(ignored.byData("mark").map((b) => [textOf(b), b.dataset["mark"]])).toEqual([["Open again", "open"], ["Mark fixed", "fixed"]]);
    for (const status of ["open", "fixed", "ignored"] as BugStatus[]) {
      expect(textOf(harness(detailView(group("aa", { status }))).body)).toContain(status === "open" ? "Open" : status === "fixed" ? "Fixed" : "Ignored");
    }
  });

  it("Copy for Kiro asks for this group", () => {
    const h = harness(detailView(group("aa")));
    h.byData("copy", "one")[0]!.click();
    expect(h.calls).toEqual([`copy {"id":"${"aa".padEnd(16, "0")}"}`]);
  });

  it("a sample with a screenshot has a button for it, and shows the picture once it arrived", () => {
    const g = group("aa", { samples: [{ id: "b1abc", at: 1, message: "message of aa", context: {}, shot: true }] });
    const h = harness(detailView(g));
    expect(h.byData("shot")).toHaveLength(1);
    h.byData("shot")[0]!.click();
    expect(h.calls).toEqual(["shot b1abc"]);
    const shown = harness(detailView(g, { shots: { b1abc: "AAAA" } }));
    expect(shown.byData("shot")).toHaveLength(0);
    const img = findAll(shown.body, (e) => e.tagName === "img")[0]!;
    expect(html(img)).toContain('class="al-bug-shot"');
    expect((img as unknown as { src: string }).src).toBe("data:image/png;base64,AAAA");
    expect((img as unknown as { alt: string }).alt).toContain("Screenshot");
  });

  it("puts a stack and a note in as text, never as HTML", () => {
    const evil = "</code></pre><img src=x onerror=alert(1)>";
    const g = group("aa", { samples: [{ id: "b1", at: 1, message: evil, stack: evil, note: evil, context: { floor: evil }, shot: false }] });
    const out = html(harness(detailView(g)).body);
    expect(out).not.toMatch(/<img/);
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("goes back to the list", () => {
    const h = harness(detailView(group("aa")));
    findAll(h.body, (e) => e.tagName === "button" && textOf(e) === "Back to the list")[0]!.click();
    expect(h.calls).toEqual(["back"]);
  });
});

describe("what Copy for Kiro said", () => {
  it("shows the notice of a copy that worked", () => {
    const h = harness(view({ notice: "Copied 2 bugs for Kiro." }));
    expect(textOf(h.body)).toContain("Copied 2 bugs for Kiro.");
    expect(html(h.body)).toContain('role="status"');
  });

  it("when the browser refuses, shows the text in a box to select by hand", () => {
    const h = harness(view({ fallbackText: "# Bugs (1)\n" }));
    const area = findAll(h.body, (e) => e.tagName === "textarea")[0]!;
    expect(area.value).toBe("# Bugs (1)\n");
    expect((area as unknown as { readOnly: boolean }).readOnly).toBe(true);
    expect(textOf(h.body)).toContain("The browser did not allow copying");
  });

  it("a refusal from the server shows over the list", () => {
    const h = harness(view({ error: "No such bug." }));
    expect(textOf(h.body)).toContain("No such bug.");
  });
});
