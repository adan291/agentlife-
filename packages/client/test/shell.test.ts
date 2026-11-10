import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FlagStorage } from "../src/ui/guide.ts";
import {
  DEFAULT_PREFS,
  DOCK_HEADER_PX,
  DOCK_KEY,
  DOCK_PX_KEY,
  SIDE_COLLAPSED_PX,
  SIDE_EXPANDED_PX,
  SIDE_KEY,
  clampDockBody,
  dockBodyBounds,
  loadShellPrefs,
  saveShellPrefs,
  shellTemplate,
} from "../src/ui/shell.ts";
import type { ShellPrefs, ShellViewport } from "../src/ui/shell.ts";

const vp = (width: number, height: number, lineHeight = 21): ShellViewport => ({ width, height, lineHeight });
const prefs = (p: Partial<ShellPrefs> = {}): ShellPrefs => ({ ...DEFAULT_PREFS, ...p });

function memory(): FlagStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("shellTemplate breakpoints without a user choice", () => {
  const table: { w: number; h: number; side: boolean; dock: boolean; compact: boolean }[] = [
    { w: 1366, h: 768, side: false, dock: false, compact: false },
    { w: 900, h: 768, side: false, dock: false, compact: false },
    { w: 899, h: 768, side: true, dock: false, compact: false },
    { w: 800, h: 600, side: true, dock: false, compact: false },
    { w: 640, h: 768, side: true, dock: false, compact: false },
    { w: 639, h: 768, side: true, dock: true, compact: true },
    { w: 375, h: 667, side: true, dock: true, compact: true },
    { w: 1366, h: 560, side: false, dock: false, compact: false },
    { w: 1366, h: 559, side: false, dock: true, compact: false },
    { w: 800, h: 500, side: true, dock: true, compact: false },
  ];
  for (const row of table) {
    it(`${row.w}x${row.h}`, () => {
      const t = shellTemplate(prefs(), vp(row.w, row.h));
      expect(t.sideCollapsed).toBe(row.side);
      expect(t.dockCollapsed).toBe(row.dock);
      expect(t.compactStepper).toBe(row.compact);
      expect(t.sideW).toBe(row.side ? SIDE_COLLAPSED_PX : SIDE_EXPANDED_PX);
    });
  }
});

describe("shellTemplate with a user choice", () => {
  const combos: [boolean, boolean][] = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ];
  for (const [side, dock] of combos) {
    for (const size of [vp(1366, 768), vp(375, 667)]) {
      it(`side collapsed ${side}, dock collapsed ${dock} at ${size.width}x${size.height}`, () => {
        const t = shellTemplate(prefs({ sideCollapsed: side, dockCollapsed: dock }), size);
        expect(t.sideCollapsed).toBe(side);
        expect(t.dockCollapsed).toBe(dock);
        expect(t.sideW).toBe(side ? 52 : 240);
        if (dock) expect(t.dockH).toBe(DOCK_HEADER_PX);
        else expect(t.dockH).toBeGreaterThan(DOCK_HEADER_PX);
      });
    }
  }

  it("the choice wins over the breakpoints", () => {
    const t = shellTemplate(prefs({ sideCollapsed: false, dockCollapsed: false }), vp(500, 400));
    expect(t.sideCollapsed).toBe(false);
    expect(t.dockCollapsed).toBe(false);
    expect(t.compactStepper).toBe(true);
  });
});

describe("dock height", () => {
  it("defaults to 6 lines plus the header", () => {
    expect(shellTemplate(prefs(), vp(1366, 768)).dockH).toBe(DOCK_HEADER_PX + 6 * 21 + 6);
  });

  it("is at least 3 lines and at most half the window", () => {
    const small = shellTemplate(prefs({ dockBodyPx: 1 }), vp(1366, 768));
    expect(small.dockH).toBe(DOCK_HEADER_PX + 3 * 21 + 6);
    const big = shellTemplate(prefs({ dockBodyPx: 5000 }), vp(1366, 768));
    expect(big.dockH).toBe(384);
  });

  it("scales with the text size", () => {
    const a = shellTemplate(prefs(), vp(1366, 768, 18));
    const b = shellTemplate(prefs(), vp(1366, 768, 27));
    expect(b.dockH).toBeGreaterThan(a.dockH);
  });

  it("always stays within bounds, for any window of 360x480 or more (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 360, max: 4000 }),
        fc.integer({ min: 480, max: 3000 }),
        fc.integer({ min: 18, max: 27 }),
        fc.option(fc.integer({ min: -100, max: 6000 }), { nil: null }),
        fc.option(fc.boolean(), { nil: null }),
        fc.option(fc.boolean(), { nil: null }),
        (w, h, lh, px, side, dock) => {
          const t = shellTemplate({ sideCollapsed: side, dockCollapsed: dock, dockBodyPx: px }, vp(w, h, lh));
          expect(t.dockH).toBeGreaterThanOrEqual(DOCK_HEADER_PX);
          expect(t.dockH).toBeLessThanOrEqual(Math.max(DOCK_HEADER_PX, h / 2));
          expect([SIDE_COLLAPSED_PX, SIDE_EXPANDED_PX]).toContain(t.sideW);
        },
      ),
    );
  });

  it("clampDockBody keeps a request inside the bounds", () => {
    const b = dockBodyBounds(vp(1000, 800));
    expect(clampDockBody(0, vp(1000, 800))).toBe(b.min);
    expect(clampDockBody(99999, vp(1000, 800))).toBe(b.max);
    expect(clampDockBody(150, vp(1000, 800))).toBe(150);
    expect(clampDockBody(Number.NaN, vp(1000, 800))).toBe(clampDockBody(null, vp(1000, 800)));
  });
});

describe("persisted choices", () => {
  it("round-trips", () => {
    const s = memory();
    saveShellPrefs(s, { sideCollapsed: true, dockCollapsed: false, dockBodyPx: 180 });
    expect(s.data.get(SIDE_KEY)).toBe("1");
    expect(s.data.get(DOCK_KEY)).toBe("0");
    expect(s.data.get(DOCK_PX_KEY)).toBe("180");
    expect(loadShellPrefs(s)).toEqual({ sideCollapsed: true, dockCollapsed: false, dockBodyPx: 180 });
  });

  it("nothing stored means no choice; garbage is ignored", () => {
    expect(loadShellPrefs(memory())).toEqual(DEFAULT_PREFS);
    const s = memory();
    s.setItem(SIDE_KEY, "maybe");
    s.setItem(DOCK_PX_KEY, "-4");
    expect(loadShellPrefs(s)).toEqual(DEFAULT_PREFS);
    expect(loadShellPrefs(undefined)).toEqual(DEFAULT_PREFS);
  });

  it("storage that throws does not break anything", () => {
    const bad: FlagStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadShellPrefs(bad)).toEqual(DEFAULT_PREFS);
    expect(() => saveShellPrefs(bad, { sideCollapsed: true, dockCollapsed: true, dockBodyPx: 100 })).not.toThrow();
  });
});
