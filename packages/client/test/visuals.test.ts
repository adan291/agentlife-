import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AgentState, JobState, JobView, Repo } from "@agentlife/shared";
import { PALETTE, STATE_COLOURS, contrastOf, glyphColourOn } from "../src/palette.ts";
import { deskGlowCentre, deskMonitorFace } from "../src/scene/recipes.ts";
import { MONITOR_LINES, lineLength, linePosition, monitorGlow } from "../src/scene/monitor-fx.ts";
import { SPARKLE_MS, candleBob, dotAlpha, envelopeLift, flameScale, fxFor, sparkleProgress } from "../src/scene/working-fx.ts";
import { createComputerPanel } from "../src/ui/computer.ts";
import { selectKey, type SelectState } from "../src/ui/select.ts";
import {
  STEPPER_MAX_PX,
  stepIcon,
  stepName,
  stepNote,
  stepTitle,
  stepperFitsLabels,
  stepperFor,
} from "../src/ui/stepper.ts";
import { CONTRAST_PAIRS, MIN_TEXT_CONTRAST, MIN_UI_CONTRAST, UI_COLOURS, contrastRatio, cssHex, themeCss } from "../src/ui/theme.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

// ---- stepper (requirement 3) ----

const job = (state: JobState, timeline: [JobState, number, string?][] = []): JobView => ({
  taskId: "t",
  repoId: "r",
  goal: "g",
  state,
  timeline: timeline.map(([s, ts, text]) => ({ ts, state: s, ...(text ? { text } : {}) })),
});

describe("stepper layout", () => {
  it("uses labels when six steps fit and icons when they do not", () => {
    // The widest it gets (760 px) holds the labels at the default text size ...
    expect(stepperFitsLabels(STEPPER_MAX_PX, 14)).toBe(true);
    // ... a laptop window does not ...
    expect(stepperFitsLabels(400, 14)).toBe(false);
    // ... and a large text size needs more room than the stepper may take.
    expect(stepperFitsLabels(STEPPER_MAX_PX, 18)).toBe(false);
  });

  it("is monotonic: more width never takes the labels away, a larger font never gives them back", () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1200 }), fc.integer({ min: 100, max: 1200 }), fc.integer({ min: 12, max: 18 }), (a, b, font) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        if (stepperFitsLabels(lo, font)) expect(stepperFitsLabels(hi, font)).toBe(true);
      }),
    );
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1200 }), fc.integer({ min: 12, max: 18 }), fc.integer({ min: 12, max: 18 }), (w, f1, f2) => {
        const [small, big] = f1 <= f2 ? [f1, f2] : [f2, f1];
        if (stepperFitsLabels(w, big)) expect(stepperFitsLabels(w, small)).toBe(true);
      }),
    );
  });

  it("a step is told apart by its shape: check, filled circle, cross, hollow circle", () => {
    const icons = (["done", "current", "failed", "pending"] as const).map(stepIcon);
    expect(icons).toEqual(["✓", "●", "✗", "○"]);
    expect(new Set(icons).size).toBe(4);
  });

  it("shows the duration of a finished step and the reason of a failed one on the second line", () => {
    const steps = stepperFor(job("developing", [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 26_000], ["developing", 30_000]]));
    // "created" is part of the Plan step, so it counts: 1 s + 25 s.
    expect(steps.map(stepNote)).toEqual(["26s", "4.0s", "", "", "", ""]);
    const failed = stepperFor(job("cancelled", [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 5_000], ["cancelled", 9_000, "Plan rejected"]]));
    expect(stepNote(failed[1]!)).toBe("Plan rejected");
  });

  it("the tooltip names the step, who does it and its status, also when only the icon shows", () => {
    const waiting = stepperFor(job("awaiting_plan_approval"));
    expect(stepName(waiting[1]!)).toBe("Your turn");
    expect(stepTitle(waiting[1]!)).toContain("Approve (Architect): waiting for you");
    const running = stepperFor(job("developing", [["created", 0], ["developing", 5_000]]));
    expect(stepTitle(running[2]!)).toBe("Build (Developer): in progress. Click to open the job card.");
    expect(stepTitle(running[3]!)).toContain("not started yet");
    expect(stepTitle(running[0]!)).toContain("done in");
  });
});

// ---- working visuals (requirement 4) ----

describe("working visuals", () => {
  it("map each state to its sign", () => {
    const expected: [AgentState, string | null][] = [
      ["thinking", "cloud"],
      ["working", "candle"],
      ["waiting_approval", "envelope"],
      ["error", "alert"],
      ["done", "sparkle"],
      ["idle", null],
      ["walking", null],
      ["blocked", null],
    ];
    for (const [state, fx] of expected) expect(fxFor(state), state).toBe(fx);
    expect(fxFor(null)).toBeNull();
  });

  it("the three dots of the cloud light up one after another", () => {
    // At any moment the dots differ; over a period each one reaches its brightest.
    const at = (t: number) => [0, 1, 2].map((i) => dotAlpha(i, t, false));
    expect(new Set(at(100).map((a) => a.toFixed(3))).size).toBe(3);
    for (const i of [0, 1, 2]) {
      const values = Array.from({ length: 120 }, (_, k) => dotAlpha(i, k * 10, false));
      expect(Math.max(...values)).toBeGreaterThan(0.95);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("flame, candle and envelope move, and keep within small bounds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (t) => {
        expect(flameScale(t, false)).toBeGreaterThan(0.7);
        expect(flameScale(t, false)).toBeLessThan(1.3);
        expect(Math.abs(candleBob(t, false))).toBeLessThanOrEqual(2);
        expect(envelopeLift(t, false)).toBeLessThanOrEqual(0);
        expect(envelopeLift(t, false)).toBeGreaterThanOrEqual(-5);
      }),
    );
    expect(new Set(Array.from({ length: 50 }, (_, k) => flameScale(k * 37, false).toFixed(3))).size).toBeGreaterThan(10);
  });

  it("with reduced motion every sign is a still picture", () => {
    for (const t of [0, 123, 4567, 98765]) {
      expect(dotAlpha(0, t, true)).toBe(dotAlpha(1, t + 500, true));
      expect(flameScale(t, true)).toBe(1);
      expect(candleBob(t, true)).toBe(0);
      expect(envelopeLift(t, true)).toBe(0);
      expect(monitorGlow(t, true)).toBe(0.35);
      for (let k = 0; k < MONITOR_LINES; k++) expect(linePosition(k, t, true)).toBe(linePosition(k, 0, true));
    }
  });

  it("the sparkle of done plays once", () => {
    expect(sparkleProgress(1_000, 999)).toBeNull();
    expect(sparkleProgress(1_000, 1_000)).toBe(0);
    expect(sparkleProgress(1_000, 1_000 + SPARKLE_MS / 2)).toBeCloseTo(0.5);
    expect(sparkleProgress(1_000, 1_000 + SPARKLE_MS)).toBeNull();
    expect(sparkleProgress(1_000, 1_000 + 10 * SPARKLE_MS)).toBeNull();
  });

  it("the monitor shows scrolling lines of different length inside the screen", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (t) => {
        for (let k = 0; k < MONITOR_LINES; k++) {
          const p = linePosition(k, t, false);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThan(1);
          expect(lineLength(k)).toBeGreaterThan(0.3);
          expect(lineLength(k)).toBeLessThanOrEqual(1);
        }
        expect(monitorGlow(t, false)).toBeGreaterThanOrEqual(0.2);
        expect(monitorGlow(t, false)).toBeLessThanOrEqual(0.45);
      }),
    );
    // Over one scroll the lines move: not all in the places they started in.
    expect(linePosition(0, 600, false)).not.toBe(linePosition(0, 0, false));
    expect(new Set(Array.from({ length: MONITOR_LINES }, (_, k) => lineLength(k))).size).toBeGreaterThan(3);
  });

  it("only desks that face the camera have a screen to draw on; the others still glow on the desk top", () => {
    const ctx = (dir: 0 | 2 | 4 | 6) => ({ w: 1, l: 1, dir, height: 3 });
    for (const dir of [2, 4] as const) {
      const quad = deskMonitorFace(ctx(dir));
      expect(quad, `dir ${dir}`).not.toBeNull();
      expect(quad).toHaveLength(4);
    }
    for (const dir of [0, 6] as const) expect(deskMonitorFace(ctx(dir)), `dir ${dir}`).toBeNull();
    const [x, y] = deskGlowCentre(ctx(6));
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });
});

// ---- select (requirement 6.1) ----

describe("select keyboard", () => {
  const closed: SelectState = { open: false, active: 0, selected: 1 };

  it("opens on the arrows, Enter and Space, on the chosen option", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      const r = selectKey(closed, key, 3);
      expect(r.handled, key).toBe(true);
      expect(r.state).toEqual({ open: true, active: 1, selected: 1 });
    }
    expect(selectKey(closed, "a", 3).handled).toBe(false);
  });

  it("moves with the arrows, Home and End and stays inside the list", () => {
    const open: SelectState = { open: true, active: 1, selected: 1 };
    expect(selectKey(open, "ArrowDown", 3).state.active).toBe(2);
    expect(selectKey({ ...open, active: 2 }, "ArrowDown", 3).state.active).toBe(2);
    expect(selectKey(open, "ArrowUp", 3).state.active).toBe(0);
    expect(selectKey({ ...open, active: 0 }, "ArrowUp", 3).state.active).toBe(0);
    expect(selectKey(open, "Home", 3).state.active).toBe(0);
    expect(selectKey(open, "End", 3).state.active).toBe(2);
  });

  it("Enter and Space choose the option the keyboard is on and close the list", () => {
    const open: SelectState = { open: true, active: 2, selected: 0 };
    for (const key of ["Enter", " "]) {
      const r = selectKey(open, key, 3);
      expect(r.choose).toBe(2);
      expect(r.state).toEqual({ open: false, active: 2, selected: 2 });
    }
  });

  it("Escape closes the list without choosing and keeps the panel behind it open", () => {
    const r = selectKey({ open: true, active: 2, selected: 0 }, "Escape", 3);
    expect(r.state).toEqual({ open: false, active: 0, selected: 0 });
    expect(r.choose).toBeUndefined();
    expect(r.swallowEscape).toBe(true);
    // Escape on a closed list is the panel's business.
    expect(selectKey({ open: false, active: 0, selected: 0 }, "Escape", 3).handled).toBe(false);
  });

  it("Tab closes the list and lets the focus move on", () => {
    const r = selectKey({ open: true, active: 2, selected: 0 }, "Tab", 3);
    expect(r.state.open).toBe(false);
    expect(r.handled).toBe(false);
  });

  it("does nothing without options", () => {
    expect(selectKey(closed, "ArrowDown", 0).handled).toBe(false);
  });
});

describe("computer panel repositories (requirement 6.4)", () => {
  const repo = (id: string): Repo => ({ id, name: id, description: `the ${id} repo` });
  const render = (repos: Repo[]) => {
    const calls: string[][] = [];
    const panel = createComputerPanel(fakeDoc(), { startJob: (r, g) => calls.push([r, g]) });
    const content = panel({ repos, job: null, approvals: [], reports: [], details: null }, null);
    return { content, calls };
  };

  it("says how many repositories are allowed instead of showing a one-item dropdown", () => {
    const { content } = render([repo("haunted-todo")]);
    expect(textOf(content.body)).toContain("Allowed repositories: 1 (haunted-todo)");
    expect(findAll(content.body, (e) => e.getAttribute("role") === "combobox")).toHaveLength(0);
    expect(findAll(content.body, (e) => e.tagName === "select")).toHaveLength(0);
  });

  it("offers the themed dropdown when there is a choice, never the native select", () => {
    const { content } = render([repo("a"), repo("b")]);
    expect(findAll(content.body, (e) => e.getAttribute("role") === "combobox")).toHaveLength(1);
    expect(findAll(content.body, (e) => e.tagName === "select")).toHaveLength(0);
    const options = findAll(content.body, (e) => e.getAttribute("role") === "option");
    expect(options.map((o) => o.textContent)).toEqual(["a - the a repo", "b - the b repo"]);
  });

  it("starts the job on the only repository", () => {
    const { content, calls } = render([repo("haunted-todo")]);
    const area = findAll(content.body, (e) => e.tagName === "textarea")[0];
    area!.value = "Fix it";
    (content.footer as unknown as { click(): void }).click();
    expect(calls).toEqual([["haunted-todo", "Fix it"]]);
  });

  it("choosing in the dropdown changes the repository that is used", () => {
    const { content, calls } = render([repo("a"), repo("b")]);
    findAll(content.body, (e) => e.getAttribute("role") === "option")[1]?.click();
    findAll(content.body, (e) => e.tagName === "textarea")[0]!.value = "Go";
    (content.footer as unknown as { click(): void }).click();
    expect(calls).toEqual([["b", "Go"]]);
  });
});

// ---- contrast (requirement 6.2, 6.3) ----

describe("contrast", () => {
  it.each(CONTRAST_PAIRS.map((p) => [p.name, p] as const))("%s", (_name, p) => {
    expect(contrastRatio(p.fg, p.bg), `${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(p.min);
  });

  it("the table covers text, controls and the states of a button", () => {
    const names = CONTRAST_PAIRS.map((p) => p.name).join("|");
    for (const part of ["hover", "pressed", "disabled", "control outline", "diff added", "diff deleted"]) expect(names).toContain(part);
    expect(CONTRAST_PAIRS.every((p) => p.min === MIN_TEXT_CONTRAST || p.min === MIN_UI_CONTRAST)).toBe(true);
  });

  it("the CSS uses the colours the table checks for buttons", () => {
    const css = themeCss();
    expect(css).toContain(`.al-btn:disabled { background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.muted}`);
    expect(css).toContain(`.al-btn:active:not(:disabled) { background: ${UI_COLOURS.border}; color: ${UI_COLOURS.text}`);
    expect(css).toContain("var(--al-control)");
    expect(css).toContain("color-scheme: dark");
    // The disabled look no longer relies on opacity, which would drag the label below the contrast the table checks.
    expect(css).not.toMatch(/\.al-btn:disabled[^}]*opacity/);
  });

  it("the icon on every status badge keeps 3:1 against its disc", () => {
    for (const [state, colour] of Object.entries(STATE_COLOURS)) {
      expect(contrastOf(glyphColourOn(colour), colour), state).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
  });

  it("the glyph is dark on bright discs and white on dark ones", () => {
    expect(glyphColourOn(STATE_COLOURS.working)).toBe(PALETTE.tagBg);
    expect(glyphColourOn(STATE_COLOURS.waiting_approval)).toBe(PALETTE.tagBg);
    expect(glyphColourOn(STATE_COLOURS.blocked)).toBe(0xffffff);
  });

  it("role colours used as text in the top bar and the team bar read on the panel background", () => {
    for (const colour of [0x2fd4c2, 0xff8a1f, 0xb06bff, 0xc9b6ff]) {
      expect(contrastRatio(cssHex(colour), UI_COLOURS.panelBg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});
