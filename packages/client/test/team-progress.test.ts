import { describe, expect, it } from "vitest";
import type { EntityView, HrState, MemberView, ProgressView, ServerMsg, TeamMember } from "@agentlife/shared";
import { createHrPanel } from "../src/ui/hr.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { ProgressModel, levelLine, levelUpText, progressLines, statsLine } from "../src/ui/progress.ts";
import { agentTooltip, guestTooltip } from "../src/ui/tooltip.ts";
import { LEVEL_UP_MS, levelUpFrame, starPoints } from "../src/scene/levelup-fx.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const view = (over: Partial<EntityView> = {}): EntityView => ({ xp: 120, level: 1, base: 50, next: 150, jobs: 0, passed: 0, steps: 0, badges: [], ...over });
const member = (projectId: string, memberId: string, over: Partial<EntityView> = {}): MemberView => ({ projectId, memberId, ...view(over) });
const progress = (members: MemberView[] = [], user: EntityView = view()): ProgressView => ({ user, members, badgeDefs: [], quests: { day: "", items: [] } });

describe("texts", () => {
  it("says the level and the XP to the next one", () => {
    expect(levelLine(view())).toBe("Lv 1 · 30 XP to Lv 2");
    expect(levelLine(view({ xp: 0, level: 0, base: 0, next: 50 }))).toBe("Lv 0 · 50 XP to Lv 1");
    expect(levelLine({ xp: 63750, level: 50 })).toBe("Lv 50 · top level");
  });

  it("says the stats that are known and leaves the others out", () => {
    expect(statsLine(view())).toBe("No work yet");
    expect(statsLine(view({ steps: 2 }))).toBe("2 steps done");
    expect(statsLine(view({ jobs: 1, passRate: 1 }))).toBe("1 job, 100% passed");
    expect(statsLine(view({ jobs: 4, passRate: 0.75, avgStepMs: 42_000, steps: 8 }))).toBe("4 jobs, 75% passed, avg step 42s");
    expect(progressLines(view({ jobs: 4, passRate: 0.75 }))).toEqual(["Lv 1 · 30 XP to Lv 2 (120 XP)", "4 jobs, 75% passed"]);
  });

  it("words a level-up for the user and for a member", () => {
    expect(levelUpText("user", "You", 2)).toBe("You reached Lv 2");
    expect(levelUpText("member", "Ada", 3)).toBe("Ada reached Lv 3");
  });
});

describe("ProgressModel", () => {
  const welcome = (roomId: string) => ({ type: "welcome", roomId, room: { id: roomId } }) as unknown as ServerMsg;
  const teamView = (roomId: string): ServerMsg => ({
    type: "team_view",
    roomId,
    members: [
      { agentId: "architect", name: "Architect", memberId: "architect" },
      { agentId: "developer", name: "Ada", memberId: "ada" },
      { agentId: "qa", name: "QA", memberId: "qa" },
    ],
    guests: [{ guestId: "guest1", name: "Wren", role: "qa", memberId: "wren" }],
  });

  it("knows nothing before the first progress message", () => {
    const m = new ProgressModel();
    m.apply(welcome("project:alpha"));
    m.apply(teamView("project:alpha"));
    expect(m.user()).toBeUndefined();
    expect(m.ofSlot("developer")).toBeUndefined();
    expect(m.memberOrNew("alpha", "ada")).toBeUndefined();
  });

  it("finds the numbers of whoever stands at a spot of the user's floor", () => {
    const m = new ProgressModel();
    m.apply(welcome("project:alpha"));
    m.apply(teamView("project:alpha"));
    m.apply({ type: "progress", state: progress([member("alpha", "ada", { level: 2, xp: 200 }), member("beta", "ada", { level: 9 })]) });
    expect(m.user()?.level).toBe(1);
    expect(m.ofSlot("developer")).toMatchObject({ memberId: "ada", level: 2 });
    // A member who has done no work yet is level 0, not missing.
    expect(m.ofSlot("guest1")).toMatchObject({ memberId: "wren", level: 0, xp: 0 });
    // A spot nobody stands at has nothing.
    expect(m.ofSlot("guest2")).toBeUndefined();
  });

  it("forgets the seats of the old floor on a new welcome, and ignores a team view for another floor", () => {
    const m = new ProgressModel();
    m.apply({ type: "progress", state: progress([member("alpha", "ada", { level: 2 })]) });
    m.apply(welcome("project:alpha"));
    m.apply(teamView("project:alpha"));
    expect(m.ofSlot("developer")).toMatchObject({ projectId: "alpha", memberId: "ada", level: 2 });
    m.apply(welcome("project:beta"));
    // Until the new floor says who sits where, a desk belongs to the role's default member.
    expect(m.ofSlot("developer")).toMatchObject({ projectId: "beta", memberId: "developer", level: 0 });
    expect(m.ofSlot("guest1")).toBeUndefined();
    expect(m.apply(teamView("project:alpha"))).toBe(false);
    expect(m.ofSlot("developer")).toMatchObject({ projectId: "beta", memberId: "developer" });
  });

  it("uses the role name for a desk when there is no team view (the scripted engine has no HR office)", () => {
    const m = new ProgressModel();
    m.apply(welcome("project:alpha"));
    m.apply({ type: "progress", state: progress([member("alpha", "developer", { level: 1, xp: 60 })]) });
    expect(m.ofSlot("developer")).toMatchObject({ memberId: "developer", xp: 60 });
    expect(m.ofSlot("builder")).toBeUndefined();
    expect(m.ofSlot("guest1")).toBeUndefined();
  });

  it("says nothing changed for messages it does not use", () => {
    expect(new ProgressModel().apply({ type: "wallet", balance: 3 })).toBe(false);
  });
});

describe("tooltips", () => {
  it("add the level lines to a desk ghost and to a member who stands on the floor", () => {
    const lines = progressLines(view({ jobs: 2, passRate: 0.5 }));
    const desk = agentTooltip("developer", "idle", undefined, "auto", undefined, 0, lines);
    expect(desk.lines).toContain(lines[0]);
    expect(desk.lines).toContain(lines[1]);
    expect(guestTooltip("Wren", "QA", undefined, lines).lines.slice(-2)).toEqual(lines);
    // Without progress nothing is added.
    expect(agentTooltip("developer", "idle", undefined, undefined).lines).toHaveLength(2);
  });
});

describe("HR card", () => {
  const members: TeamMember[] = [
    { id: "ada", displayName: "Ada", templateId: "developer", role: "developer", model: "auto" },
    { id: "qa", displayName: "QA", templateId: "qa", role: "qa", model: "auto" },
  ];
  const hr: HrState = {
    catalogue: [],
    teams: [{ projectId: "alpha", name: "Alpha", customised: true, members }],
    imports: [],
    sources: [],
    models: {},
  };
  const noop = () => undefined;
  const actions = { hire: noop, rename: noop, setModel: noop, fire: noop, importFrom: noop, approve: noop, reject: noop, suggest: noop, apply: noop };
  const levelLines = (progressOf?: (p: string, m: string) => EntityView | undefined) => {
    const panel = createHrPanel(fakeDoc(), actions, progressOf);
    const content = panel({ hr, error: null, suggestion: null, busy: null }, noop);
    return findAll(content.body, (e) => e.className.includes("al-hr-level")).map((e) => textOf(e));
  };

  it("shows each member's level, XP to the next level and stats", () => {
    const lines = levelLines((p, m) => (m === "ada" ? member(p, m, { level: 3, xp: 320, next: 500, jobs: 4, passRate: 0.75 }) : undefined));
    expect(lines).toEqual(["Lv 3 · 180 XP to Lv 4 · 4 jobs, 75% passed"]);
  });

  it("shows no level line when the hotel has no progress", () => {
    expect(levelLines()).toEqual([]);
  });
});

describe("panel state", () => {
  it("draws the HR panel again when progress changes, and no other panel", () => {
    const s = new PanelState();
    const msg: ServerMsg = { type: "progress", state: progress() };
    expect(s.apply(msg)).toBe(false);
    s.apply({ type: "open_panel", panel: "hr" });
    expect(s.apply(msg)).toBe(true);
  });
});

describe("the level-up effect", () => {
  it("rises and fades over its time, and is over afterwards", () => {
    const start = levelUpFrame(0, false)!;
    const mid = levelUpFrame(0.5, false)!;
    const late = levelUpFrame(0.9, false)!;
    expect(start.alpha).toBe(1);
    expect(mid.rise).toBeGreaterThan(start.rise);
    expect(late.alpha).toBeLessThan(mid.alpha);
    expect(levelUpFrame(1, false)).toBeNull();
    expect(levelUpFrame(-0.1, false)).toBeNull();
    expect(LEVEL_UP_MS).toBeGreaterThan(1000);
  });

  it("does not move with reduced motion, it only fades", () => {
    const a = levelUpFrame(0.1, true)!;
    const b = levelUpFrame(0.8, true)!;
    expect([a.rise, a.turn]).toEqual([0, 0]);
    expect([b.rise, b.turn]).toEqual([0, 0]);
    expect(b.alpha).toBeLessThan(a.alpha);
  });

  it("draws a four-point star", () => {
    const pts = starPoints(4, 1.5);
    expect(pts).toHaveLength(16);
    expect(Math.hypot(pts[0]!, pts[1]!)).toBeCloseTo(4);
    expect(Math.hypot(pts[2]!, pts[3]!)).toBeCloseTo(1.5);
  });
});
