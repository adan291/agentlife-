import { describe, expect, it } from "vitest";
import { rootPositionFor } from "../src/scene/camera.ts";
import { chooseZoom } from "../src/scene/zoom.ts";

/** The room fit uses the stage size only (ui-shell): margin 16 px per side. */
describe("zoom from the stage size", () => {
  const room = { w: 704, h: 430 };
  const fit = (stageW: number, stageH: number) => chooseZoom(room.w, room.h, stageW, stageH, 16);

  it("picks 2x when 2x fits in the stage", () => {
    expect(fit(1440, 892)).toBe(2);
  });

  it("picks 1x when the dock takes the height 2x needs", () => {
    expect(fit(1440, 700)).toBe(1);
  });

  it("picks 1x when the side bar takes the width 2x needs", () => {
    expect(fit(1300, 892)).toBe(1);
  });

  it("is monotonic: a bigger stage never lowers the zoom", () => {
    expect(fit(1440, 892)).toBeGreaterThanOrEqual(fit(1439, 892));
    expect(fit(1440, 892)).toBeGreaterThanOrEqual(fit(1440, 891));
  });
});

describe("centring in the stage", () => {
  it("puts the point at the centre of the stage", () => {
    const p = rootPositionFor({ x: 50, y: 20 }, 2, 1000, 700);
    expect(p.x + 50 * 2).toBe(500);
    expect(p.y + 20 * 2).toBe(350);
  });
});
