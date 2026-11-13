import { describe, expect, it } from "vitest";
import { BADGE_SHAPES } from "@agentlife/shared";
import type { BadgeDef, EntityView, HrState, ProgressView, QuestView, ServerMsg } from "@agentlife/shared";
import { ICON_PARTS, badgeIcon } from "../src/ui/badge-icons.ts";
import { createHrPanel } from "../src/ui/hr.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { createProfilePanel, questProgressText, ruleText, userBadges } from "../src/ui/profile.ts";
import { fakeDoc, findAll, html, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const badge = (id: string, over: Partial<BadgeDef> = {}): BadgeDef => ({
  id,
  name: `Badge ${id}`,
  description: `Description of ${id}.`,
  scope: "user",
  rule: { counter: "branch_delivered", atLeast: 10 },
  icon: { shape: "crown", colour: "#ffd75e" },
  ...over,
});
const entity = (over: Partial<EntityView> = {}): EntityView => ({ xp: 120, level: 1, base: 50, next: 150, jobs: 3, passed: 2, steps: 6, passRate: 2 / 3, badges: [], ...over });
const quest = (id: string, over: Partial<QuestView> = {}): QuestView => ({ id, title: `Quest ${id}`, progress: 0, target: 1, reward: 20, done: false, ...over });
const progress = (over: Partial<ProgressView> = {}): ProgressView => ({
  user: entity({ badges: [{ id: "b", at: new Date(2026, 10, 12, 9).getTime() }, { id: "c", at: new Date(2026, 10, 13, 9).getTime() }] }),
  members: [],
  badgeDefs: [badge("a"), badge("b"), badge("c"), badge("m", { scope: "member" })],
  quests: { day: "2026-11-13", items: [quest("q1", { done: true, progress: 1 }), quest("q2", { progress: 1, target: 3 }), quest("q3")] },
  ...over,
});

const render = (p: ProgressView | null) => {
  const panel = createProfilePanel(fakeDoc());
  let content = panel({ progress: p }, () => (content = panel({ progress: p }, () => undefined)));
  return {
    get body() {
      return content.body;
    },
  };
};

describe("badge icons", () => {
  it("draws every shape the protocol allows, with the badge's colour and no image", () => {
    for (const shape of BADGE_SHAPES) {
      expect(ICON_PARTS[shape].length).toBeGreaterThan(0);
      const svg = badgeIcon(fakeDoc(), shape, "#12ab34", 24);
      const text = html(svg);
      expect(text).toContain('viewBox="0 0 24 24"');
      expect(text).toContain("#12ab34");
      expect(text).not.toContain("<img");
      expect(text).not.toContain("$c");
      expect(text).not.toContain("$d");
    }
  });
});

describe("texts", () => {
  it("says what a rule asks for", () => {
    expect(ruleText({ counter: "branch_delivered", atLeast: 1 })).toBe("1 branch delivered");
    expect(ruleText({ counter: "branch_delivered", atLeast: 10 })).toBe("10 branches delivered");
    expect(ruleText({ counter: "level", atLeast: 5 })).toBe("Reach level 5");
    expect(ruleText({ counter: "best_streak", atLeast: 5 })).toBe("5 jobs passed in a row");
    expect(ruleText({ counter: "memory_accepted", atLeast: 1 })).toBe("1 note kept in the Library");
  });

  it("says the progress of a quest", () => {
    expect(questProgressText({ progress: 1, target: 3, done: false })).toBe("1 / 3");
    expect(questProgressText({ progress: 3, target: 3, done: true })).toBe("Done");
  });

  it("puts the earned badges first, newest first, then the locked ones, and leaves out the members' badges", () => {
    expect(userBadges(progress()).map((b) => [b.def.id, b.earnedAt !== undefined])).toEqual([
      ["c", true],
      ["b", true],
      ["a", false],
    ]);
  });
});

describe("Profile panel", () => {
  it("shows the level, the XP to the next level and the stats", () => {
    const r = render(progress());
    const text = textOf(r.body);
    expect(text).toContain("Lv 1 · 30 XP to Lv 2");
    expect(text).toContain("3 jobs, 67% passed");
  });

  it("lists the badges with a picture, earned ones with their date and locked ones with what they ask for", () => {
    const cards = findAll(render(progress()).body, (e) => e.dataset["badge"] !== undefined);
    expect(cards.map((c) => [c.dataset["badge"], c.dataset["earned"]])).toEqual([
      ["c", "true"],
      ["b", "true"],
      ["a", "false"],
    ]);
    expect(textOf(cards[0])).toContain("Badge c");
    expect(textOf(cards[0])).toContain("Earned 2026-11-13");
    expect(textOf(cards[2])).toContain("Locked: 10 branches delivered");
    for (const c of cards) expect(findAll(c, (e) => e.tagName === "svg")).toHaveLength(1);
  });

  it("opens the Quests tab with today's three quests, their progress and their reward", () => {
    const panel = createProfilePanel(fakeDoc());
    const view = { progress: progress() };
    let content = panel(view, rerender);
    function rerender(): void {
      content = panel(view, rerender);
    }
    findAll(content.body, (e) => e.dataset["tab"] === "quests")[0]!.click();
    const quests = findAll(content.body, (e) => e.dataset["quest"] !== undefined);
    expect(quests.map((q) => [q.dataset["quest"], q.dataset["done"]])).toEqual([
      ["q1", "true"],
      ["q2", "false"],
      ["q3", "false"],
    ]);
    expect(textOf(quests[0])).toContain("Done");
    expect(textOf(quests[1])).toContain("1 / 3");
    expect(textOf(quests[1])).toContain("Reward: 20 Ecto");
    expect(textOf(content.body)).toContain("2026-11-13");
    const bar = findAll(quests[1], (e) => e.attributes.get("role") === "progressbar")[0] as FakeElement;
    expect(bar.attributes.get("aria-valuenow")).toBe("1");
    expect(bar.attributes.get("aria-valuemax")).toBe("3");
    // The open tab is the one that cannot be pressed again, and the badges come back with their tab.
    expect(findAll(content.body, (e) => e.dataset["tab"] === "quests")[0]!.disabled).toBe(true);
    findAll(content.body, (e) => e.dataset["tab"] === "badges")[0]!.click();
    expect(findAll(content.body, (e) => e.dataset["badge"] !== undefined)).toHaveLength(3);
  });

  it("says so when there are no quests or no progress yet", () => {
    const none = createProfilePanel(fakeDoc());
    const view = { progress: progress({ quests: { day: "", items: [] } }) };
    let content = none(view, rerender);
    function rerender(): void {
      content = none(view, rerender);
    }
    findAll(content.body, (e) => e.dataset["tab"] === "quests")[0]!.click();
    expect(textOf(content.body)).toContain("no quests today");
    expect(textOf(render(null).body)).toContain("No progress yet");
  });

  it("never turns text from the server into markup", () => {
    const evil = progress({ badgeDefs: [badge("a", { name: "<img src=x onerror=alert(1)>", description: "<b>x</b>" })], user: entity() });
    const out = html(render(evil).body);
    expect(out).not.toContain("<img src");
    expect(out).toContain("&lt;img src=x");
  });
});

describe("HR card badges", () => {
  const noop = () => undefined;
  const actions = { hire: noop, rename: noop, setModel: noop, fire: noop, importFrom: noop, approve: noop, reject: noop, suggest: noop, apply: noop };
  const hr: HrState = {
    catalogue: [],
    teams: [{ projectId: "alpha", name: "Alpha", customised: true, members: [{ id: "ada", displayName: "Ada", templateId: "developer", role: "developer", model: "auto" }] }],
    imports: [],
    sources: [],
    models: {},
  };
  const defs = [badge("m1", { scope: "member", name: "First pass", icon: { shape: "check", colour: "#7fd1ae" } }), badge("m2", { scope: "member", name: "Night owl" })];
  const strip = (earned: string[]) => {
    const panel = createHrPanel(fakeDoc(), actions, () => entity({ badges: earned.map((id) => ({ id, at: 1 })) }), () => defs);
    const content = panel({ hr, error: null, suggestion: null, busy: null }, noop);
    return findAll(content.body, (e) => e.className.includes("al-hr-badges"));
  };

  it("shows the badges a member earned as pictures with their names", () => {
    const [bar] = strip(["m1"]);
    expect(bar).toBeDefined();
    expect(bar!.attributes.get("aria-label")).toBe("Badges: First pass");
    const pics = findAll(bar, (e) => e.dataset["badge"] !== undefined);
    expect(pics.map((p) => p.dataset["badge"])).toEqual(["m1"]);
    expect(pics[0]!.title).toContain("First pass");
    expect(findAll(bar, (e) => e.tagName === "svg")).toHaveLength(1);
  });

  it("shows nothing for a member with no badge, and skips a badge that is not in the list", () => {
    expect(strip([])).toEqual([]);
    expect(strip(["gone"])).toEqual([]);
  });
});

describe("panel state", () => {
  it("keeps the latest progress and draws the Profile panel again when it changes", () => {
    const s = new PanelState();
    const msg: ServerMsg = { type: "progress", state: progress() };
    expect(s.apply(msg)).toBe(false);
    expect(s.progress).toEqual(progress());
    s.apply({ type: "open_panel", panel: "profile" });
    expect(s.open).toBe("profile");
    expect(s.apply(msg)).toBe(true);
  });
});
