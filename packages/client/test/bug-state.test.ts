import { describe, expect, it } from "vitest";
import type { ServerMsg } from "@agentlife/shared";
import { BugState } from "../src/ui/bug-state.ts";
import { PanelState } from "../src/ui/panel-state.ts";

const news = (change: "state" | "new" | "repeat" | "reopened" | "status", game = 1, code = 0): ServerMsg => ({ type: "bug_news", open: { game, code }, change, id: "0123456789abcdef" });

describe("BugState", () => {
  it("knows nothing until the server says it has a Bug sack", () => {
    const s = new BugState();
    expect(s.available).toBe(false);
    expect(s.apply(news("state", 2, 3), null)).toBe(true);
    expect(s).toMatchObject({ available: true, total: 5, dot: false });
  });

  it("a new group or one that came back lights the dot; a repeat or a status change does not", () => {
    const s = new BugState();
    s.apply(news("state", 0, 0), null);
    s.apply(news("repeat"), null);
    s.apply(news("status", 0), null);
    expect(s.dot).toBe(false);
    s.apply(news("new"), null);
    expect(s.dot).toBe(true);
    s.see();
    s.apply(news("reopened"), null);
    expect(s.dot).toBe(true);
  });

  it("a bug that arrives while the panel is open is not news", () => {
    const s = new BugState();
    s.apply(news("state", 0, 0), null);
    s.apply(news("new"), "bugs");
    expect(s.dot).toBe(false);
    expect(s.total).toBe(1);
  });

  it("opening the panel, by the jar or by the Menu, puts the dot out", () => {
    const s = new BugState();
    s.apply(news("new"), null);
    expect(s.apply({ type: "open_panel", panel: "bugs" }, null)).toBe(true);
    expect(s.dot).toBe(false);
    s.apply(news("new"), null);
    s.see();
    expect(s.dot).toBe(false);
    expect(s.apply({ type: "open_panel", panel: "shop" }, null)).toBe(false);
  });

  it("the list of groups carries the same counts", () => {
    const s = new BugState();
    s.apply({ type: "bugs", groups: [], open: { game: 4, code: 1 } }, "bugs");
    expect(s).toMatchObject({ available: true, total: 5 });
  });

  it("a new room starts the count over until the server says it again", () => {
    const s = new BugState();
    s.apply(news("state", 2, 0), null);
    s.apply({ type: "welcome" } as unknown as ServerMsg, null);
    expect(s.available).toBe(false);
    s.apply(news("state", 2, 0), null);
    expect(s.available).toBe(true);
  });

  it("says whether anything the Menu shows changed", () => {
    const s = new BugState();
    s.apply(news("state", 1, 0), null);
    expect(s.apply(news("repeat", 1, 0), null)).toBe(false);
    expect(s.apply(news("status", 0, 0), null)).toBe(true);
  });
});

describe("PanelState and the Bug sack", () => {
  const summary = { id: "0123456789abcdef", component: "game", process: "client", kind: "uncaught", message: "boom", frame: "", status: "open", count: 1, firstSeen: 1, lastSeen: 2, reopened: 0, last: {}, shots: 0 } as const;
  const group = { ...summary, samples: [{ id: "b1abc", at: 2, message: "boom", context: {}, shot: false }] };

  it("keeps the list, and shows it only while the panel is open", () => {
    const s = new PanelState();
    expect(s.apply({ type: "bugs", groups: [summary], open: { game: 1, code: 0 } })).toBe(false);
    s.apply({ type: "open_panel", panel: "bugs" });
    expect(s.bugs?.groups).toHaveLength(1);
    expect(s.apply({ type: "bugs", groups: [], open: { game: 0, code: 0 } })).toBe(true);
  });

  it("takes the details of the group being read and drops a slow answer for another one", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "bugs" });
    s.bugSelected = group.id;
    expect(s.apply({ type: "bug_detail", group })).toBe(true);
    expect(s.bugDetail?.id).toBe(group.id);
    s.bugSelected = null;
    s.bugDetail = null;
    expect(s.apply({ type: "bug_detail", group })).toBe(false);
    expect(s.bugDetail).toBeNull();
  });

  it("keeps a screenshot by its sample, and forgets them all when the panel opens again", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "bugs" });
    s.apply({ type: "bug_shot", sample: "b1abc", png: "AAAA" });
    expect(s.bugShots).toEqual({ b1abc: "AAAA" });
    s.apply({ type: "open_panel", panel: "bugs" });
    expect(s.bugShots).toEqual({});
  });

  it("shows why the server refused, and clears it when the panel opens", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "bugs" });
    expect(s.apply({ type: "error", code: "bug_error", message: "The Bug sack is off on this server." })).toBe(true);
    expect(s.bugError).toBe("The Bug sack is off on this server.");
    s.apply({ type: "open_panel", panel: "bugs" });
    expect(s.bugError).toBeNull();
  });
});
