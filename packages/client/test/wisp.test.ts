import { describe, expect, it } from "vitest";
import { CATCH_MS, WISP_FADE_IN_MS, WISP_FADE_OUT_MS, catchFrame, wispFrame } from "../src/scene/wisp-fx.ts";
import { createWispButton } from "../src/ui/wisp.ts";
import { FakeDocument } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const TTL = 8000;

describe("wispFrame", () => {
  it("is nothing before it appears and after its time", () => {
    expect(wispFrame(-1, TTL, false)).toBeNull();
    expect(wispFrame(TTL, TTL, false)).toBeNull();
    expect(wispFrame(TTL + 500, TTL, true)).toBeNull();
    expect(wispFrame(Number.NaN, TTL, false)).toBeNull();
  });

  it("floats, sways and fades in, with sparks, while it is young", () => {
    const first = wispFrame(0, TTL, false)!;
    expect(first.alpha).toBe(0);
    const mid = wispFrame(WISP_FADE_IN_MS + 1500, TTL, false)!;
    expect(mid.alpha).toBe(1);
    expect(mid.sparks).toBe(3);
    expect(mid.blink).toBe(false);
    const later = wispFrame(WISP_FADE_IN_MS + 2500, TTL, false)!;
    expect(later.dx !== mid.dx || later.dy !== mid.dy).toBe(true);
  });

  it("fades and blinks in its last second, and is almost gone at the end", () => {
    const end = wispFrame(TTL - 10, TTL, false)!;
    expect(end.alpha).toBeLessThan(0.02);
    const blinks = new Set<boolean>();
    for (let age = TTL - WISP_FADE_OUT_MS + 10; age < TTL; age += 60) blinks.add(wispFrame(age, TTL, false)!.blink);
    expect(blinks).toEqual(new Set([true, false]));
  });

  it("does not move, pulse, blink or leave sparks under reduced motion; it only fades at the end", () => {
    for (let age = 0; age < TTL; age += 137) {
      const f = wispFrame(age, TTL, true)!;
      expect(f).toMatchObject({ dx: 0, dy: 0, scale: 1, sparks: 0, blink: false });
    }
    expect(wispFrame(0, TTL, true)!.alpha).toBe(1);
    expect(wispFrame(TTL - 500, TTL, true)!.alpha).toBeCloseTo(0.5, 5);
  });
});

describe("catchFrame", () => {
  it("is a ring of sparks that spreads and fades, and ends", () => {
    const a = catchFrame(0, false)!;
    const b = catchFrame(CATCH_MS / 2, false)!;
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(a.sparks).toBe(6);
    expect(catchFrame(CATCH_MS, false)).toBeNull();
    expect(catchFrame(-5, false)).toBeNull();
  });

  it("is a still ring without sparks under reduced motion", () => {
    const a = catchFrame(0, true)!;
    const b = catchFrame(CATCH_MS / 2, true)!;
    expect(b.radius).toBe(a.radius);
    expect(b.turn).toBe(0);
    expect(a.sparks).toBe(0);
    expect(b.alpha).toBeLessThan(a.alpha);
  });
});

describe("the button over the wisp", () => {
  function parts() {
    const doc = new FakeDocument();
    const host = new FakeDocument().createElement("div");
    const caught: string[] = [];
    const wisp = createWispButton(doc as unknown as Document, host as unknown as HTMLElement, (id) => caught.push(id));
    return { wisp, caught, button: wisp.element as unknown as FakeElement, host };
  }

  it("is hidden until there is a wisp, and has a label a screen reader can read", () => {
    const { button, host } = parts();
    expect(button.hidden).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Catch the wisp");
    expect(host.children).toContain(button);
  });

  it("follows the wisp and hides when it is gone", () => {
    const { wisp, button } = parts();
    wisp.sync({ id: "wisp-1", x: 120.4, y: 80.6 });
    expect(button.hidden).toBe(false);
    expect(button.dataset["wisp"]).toBe("wisp-1");
    expect(button.style.props.get("left")).toBe("120px");
    expect(button.style.props.get("top")).toBe("81px");
    wisp.sync({ id: "wisp-1", x: 130, y: 90 });
    expect(button.style.props.get("left")).toBe("130px");
    wisp.sync(null);
    expect(button.hidden).toBe(true);
  });

  it("sends one catch for a wisp however often it is clicked, and another for the next wisp", () => {
    const { wisp, caught, button } = parts();
    button.click();
    expect(caught).toEqual([]); // no wisp yet
    wisp.sync({ id: "wisp-1", x: 10, y: 10 });
    button.click();
    button.click();
    expect(caught).toEqual(["wisp-1"]);
    wisp.sync(null);
    wisp.sync({ id: "wisp-2", x: 10, y: 10 });
    button.click();
    expect(caught).toEqual(["wisp-1", "wisp-2"]);
  });
});
