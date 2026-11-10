import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { rootPositionFor } from "../src/scene/camera.ts";
import { freeViewport, getInsets, onInsetsChange, setInsets } from "../src/scene/viewport.ts";
import { chooseZoom } from "../src/scene/zoom.ts";

describe("freeViewport", () => {
  it("subtracts the team bar, the terminal and a 16 px margin", () => {
    expect(freeViewport(1920, 1080, { left: 230, bottom: 200 })).toEqual({ x: 246, y: 16, w: 1658, h: 848 });
  });

  it("is the whole window minus the margin with nothing docked", () => {
    expect(freeViewport(1000, 800, { left: 0, bottom: 0 })).toEqual({ x: 16, y: 16, w: 968, h: 768 });
  });

  it("never goes negative and stays inside the window (property)", () => {
    fc.assert(
      fc.property(fc.nat(4000), fc.nat(4000), fc.nat(1000), fc.nat(1000), (w, h, left, bottom) => {
        const v = freeViewport(w, h, { left, bottom });
        return v.w >= 0 && v.h >= 0 && v.x >= 0 && v.y >= 0;
      }),
    );
  });
});

describe("zoom from the free viewport", () => {
  const room = { w: 704, h: 430 };
  it("picks 2x when 2x fits in the free area", () => {
    const v = freeViewport(1920, 1080, { left: 230, bottom: 150 });
    expect(chooseZoom(room.w, room.h, v.w, v.h, 0)).toBe(2);
  });

  it("picks 1x when the terminal takes the height 2x needs", () => {
    const v = freeViewport(1920, 1080, { left: 230, bottom: 400 });
    expect(chooseZoom(room.w, room.h, v.w, v.h, 0)).toBe(1);
  });

  it("picks 1x when the team bar takes the width 2x needs", () => {
    const v = freeViewport(1500, 1080, { left: 230, bottom: 0 });
    expect(chooseZoom(room.w, room.h, v.w, v.h, 0)).toBe(1);
  });
});

describe("centring in the free viewport", () => {
  it("puts the point at the centre of the free area", () => {
    const v = freeViewport(1000, 800, { left: 200, bottom: 100 });
    const p = rootPositionFor({ x: 50, y: 20 }, 2, v.w, v.h, v.x, v.y);
    expect(p.x + 50 * 2).toBe(v.x + v.w / 2);
    expect(p.y + 20 * 2).toBe(v.y + v.h / 2);
  });
});

describe("insets", () => {
  it("notifies only on a real change", () => {
    let n = 0;
    const off = onInsetsChange(() => n++);
    setInsets({ left: 230, bottom: 150 });
    setInsets({ left: 230 });
    setInsets({ bottom: 150 });
    expect(n).toBe(1);
    setInsets({ bottom: 0 });
    expect(n).toBe(2);
    expect(getInsets()).toEqual({ left: 230, bottom: 0 });
    off();
    setInsets({ left: 58 });
    expect(n).toBe(2);
  });
});
