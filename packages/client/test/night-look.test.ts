import { describe, expect, it } from "vitest";
import { FURNI_CATALOG, footprintSize } from "@agentlife/shared";
import { candleLit } from "../src/scene/ambient-fx.ts";
import { deskCandlePoint, deskMonitorFace, RECIPES } from "../src/scene/recipes.ts";
import type { RecipeCtx } from "../src/scene/recipes.ts";
import { clockText, moonClockLabel } from "../src/ui/night-look.ts";

describe("moon clock", () => {
  it("writes the time with two digits and when the shift ends", () => {
    expect(clockText(new Date(2026, 10, 12, 3, 5))).toBe("03:05");
    expect(clockText(new Date(2026, 10, 12, 23, 59))).toBe("23:59");
    expect(moonClockLabel({ open: true, start: "01:00", end: "07:00" }, new Date(2026, 10, 12, 3, 12))).toBe("☾ 03:12 · night shift until 07:00");
  });
});

describe("desk candles", () => {
  it("burn only at night and only while the agent works", () => {
    expect(candleLit(true, true)).toBe(true);
    expect(candleLit(true, false)).toBe(false);
    expect(candleLit(false, true)).toBe(false);
    expect(candleLit(false, false)).toBe(false);
  });

  it("stand beside the monitor, never in front of the screen, in every facing of an agent desk", () => {
    const def = FURNI_CATALOG["agent_desk"]!;
    for (const dir of [0, 2, 4, 6] as const) {
      const { w, l } = footprintSize(def, dir);
      const ctx: RecipeCtx = { w, l, dir, height: def.height };
      const [cx, cy] = deskCandlePoint(ctx);
      expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
      const face = deskMonitorFace(ctx);
      if (!face) continue;
      const xs = face.map((p) => p[0]);
      const ys = face.map((p) => p[1]);
      const inside = cx >= Math.min(...xs) && cx <= Math.max(...xs) && cy >= Math.min(...ys) && cy <= Math.max(...ys);
      expect(inside, `dir ${dir}`).toBe(false);
    }
  });

  it("the night board has a drawing", () => {
    expect(FURNI_CATALOG["night_board"]?.interaction).toBe("night");
    expect(RECIPES["night_board"]).toBeTypeOf("function");
  });
});
