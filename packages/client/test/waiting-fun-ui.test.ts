import { describe, expect, it } from "vitest";
import { MOODS } from "@agentlife/shared";
import { AVATAR_FRAME, drawAvatar } from "../src/scene/figure.ts";
import type { AvatarPose, DrawnView } from "../src/scene/figure.ts";
import { MOOD_FACE_WIDTH, drawMoodFace, moodFace } from "../src/scene/mood-face.ts";
import { EMOTE_FRAME_MS, isSeatedPose, poseFor } from "../src/scene/pose.ts";
import { PALETTE } from "../src/palette.ts";
import type { RoleKey } from "../src/palette.ts";
import { EMOTE_KEYS, createEmoteBar, emoteKey } from "../src/ui/emotes.ts";
import { FakeDocument, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

describe("the emote keys", () => {
  it("map 1 to wave, 2 to dance, 3 to cheer and 4 to sit or stand", () => {
    expect(emoteKey({ key: "1" })).toEqual({ kind: "emote", emote: "wave" });
    expect(emoteKey({ key: "2" })).toEqual({ kind: "emote", emote: "dance" });
    expect(emoteKey({ key: "3" })).toEqual({ kind: "emote", emote: "cheer" });
    expect(emoteKey({ key: "4" })).toEqual({ kind: "sit" });
    expect(emoteKey({ key: "5" })).toBeNull();
    expect(emoteKey({ key: "w" })).toBeNull();
  });

  it("are ignored in a text field, whatever kind", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(emoteKey({ key: "1", target: { tagName } }), tagName).toBeNull();
    expect(emoteKey({ key: "1", target: { tagName: "DIV", isContentEditable: true } })).toBeNull();
    // Anywhere else on the page they work (a button, the body, the canvas).
    for (const tagName of ["BUTTON", "BODY", "CANVAS"]) expect(emoteKey({ key: "1", target: { tagName } }), tagName).not.toBeNull();
  });

  it("are ignored with Ctrl, Alt or Meta, while a key is held down, and when the caller says the keyboard is taken", () => {
    expect(emoteKey({ key: "1", ctrlKey: true })).toBeNull();
    expect(emoteKey({ key: "1", metaKey: true })).toBeNull();
    expect(emoteKey({ key: "1", altKey: true })).toBeNull();
    expect(emoteKey({ key: "1", repeat: true })).toBeNull();
    expect(emoteKey({ key: "1" }, true)).toBeNull();
    expect(emoteKey({ key: "1" }, false)).not.toBeNull();
  });
});

describe("the emote bar", () => {
  function parts() {
    const doc = new FakeDocument();
    const host = new FakeDocument().createElement("div");
    const calls: string[] = [];
    const bar = createEmoteBar(doc as unknown as Document, host as unknown as HTMLElement, { emote: (e) => calls.push(e), sit: () => calls.push("sit") });
    const buttons = findAll(bar.element, (e) => e.tagName === "button");
    return { bar, buttons, calls, el: bar.element as unknown as FakeElement };
  }

  it("has four buttons, each with its key in the label and the title", () => {
    const { buttons, el } = parts();
    expect(el.getAttribute("role")).toBe("toolbar");
    expect(buttons.map((b) => textOf(b))).toEqual(["1Wave", "2Dance", "3Cheer", "4Sit"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Wave, key 1", "Dance, key 2", "Cheer, key 3", "Sit down on the nearest seat, or stand up, key 4"]);
    expect(buttons.map((b) => b.title)).toEqual(EMOTE_KEYS.map((k) => `${k.title} (${k.key})`));
  });

  it("sends what a button says, and can be hidden", () => {
    const { buttons, calls, el, bar } = parts();
    for (const b of buttons) b.click();
    expect(calls).toEqual(["wave", "dance", "cheer", "sit"]);
    bar.setVisible(false);
    expect(el.hidden).toBe(true);
    bar.setVisible(true);
    expect(el.hidden).toBe(false);
  });

  it("shows that the user sits: the Sit button is pressed and says Stand", () => {
    const { buttons, bar } = parts();
    const sit = buttons[3]!;
    expect(sit.getAttribute("aria-pressed")).toBe("false");
    bar.setSitting(true);
    expect(sit.getAttribute("aria-pressed")).toBe("true");
    expect(textOf(sit)).toBe("4Stand");
    bar.setSitting(false);
    expect(sit.getAttribute("aria-pressed")).toBe("false");
    expect(textOf(sit)).toBe("4Sit");
  });
});

describe("which drawing a figure shows", () => {
  const base = { isUser: true, moving: false, sitting: false, emote: null, elapsedMs: 0, reduced: false } as const;

  it("is the normal stance without a seat or an emote, and a walk always wins", () => {
    expect(poseFor(base).pose).toBeUndefined();
    expect(poseFor({ ...base, moving: true, sitting: true, emote: "wave" }).pose).toBeUndefined();
  });

  it("sits the user, and the user waves and cheers seated but does not dance", () => {
    expect(poseFor({ ...base, sitting: true }).pose).toBe("sit");
    expect(poseFor({ ...base, sitting: true, emote: "wave" }).pose).toBe("sit_wave");
    expect(poseFor({ ...base, sitting: true, emote: "cheer" }).pose).toBe("sit_cheer");
    expect(poseFor({ ...base, sitting: true, emote: "dance" }).pose).toBe("sit");
    expect(poseFor({ ...base, emote: "dance" }).pose).toBe("dance");
  });

  it("shows each kind of figure only the emotes it has", () => {
    expect(poseFor({ ...base, emote: "glum" }).pose).toBeUndefined();
    const ghost = { ...base, isUser: false };
    expect(poseFor({ ...ghost, emote: "cheer" }).pose).toBe("cheer");
    expect(poseFor({ ...ghost, emote: "glum" }).pose).toBe("glum");
    expect(poseFor({ ...ghost, emote: "wave" }).pose).toBeUndefined();
    expect(poseFor({ ...ghost, emote: "dance" }).pose).toBeUndefined();
    // A ghost never sits.
    expect(poseFor({ ...ghost, sitting: true }).pose).toBeUndefined();
  });

  it("loops the two frames of an emote, and holds the first one under reduced motion", () => {
    const frames = (reduced: boolean) => new Set([0, 1, 2, 3, 4, 5].map((n) => poseFor({ ...base, emote: "dance", elapsedMs: n * EMOTE_FRAME_MS.dance, reduced }).frame));
    expect(frames(false)).toEqual(new Set([0, 1]));
    expect(frames(true)).toEqual(new Set([0]));
    for (const emote of ["wave", "cheer"] as const) {
      expect(poseFor({ ...base, emote, elapsedMs: 10_000, reduced: true }).frame).toBe(0);
    }
    expect(poseFor({ ...base, isUser: false, emote: "glum", elapsedMs: 5_000, reduced: true }).frame).toBe(0);
  });

  it("lifts only the seated poses", () => {
    expect(["sit", "sit_wave", "sit_cheer"].map((p) => isSeatedPose(p as AvatarPose))).toEqual([true, true, true]);
    expect(["wave", "cheer", "dance", "glum", undefined].map((p) => isSeatedPose(p as AvatarPose | undefined))).toEqual([false, false, false, false, false]);
  });
});

/** A Graphics stand-in that records the points it is asked to draw. */
function recorder() {
  const points: { x: number; y: number }[] = [];
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  const add = (x: number, y: number, rx = 0, ry = rx) => {
    points.push({ x: x - rx, y: y - ry }, { x: x + rx, y: y + ry });
  };
  chain["circle"] = (x: number, y: number, r: number) => (calls.push("circle"), add(x, y, r), chain);
  chain["ellipse"] = (x: number, y: number, rx: number, ry: number) => (calls.push("ellipse"), add(x, y, rx, ry), chain);
  chain["rect"] = (x: number, y: number, w: number, h: number) => (calls.push("rect"), points.push({ x, y }, { x: x + w, y: y + h }), chain);
  chain["poly"] = (...a: number[]) => (calls.push("poly"), chain);
  chain["moveTo"] = (x: number, y: number) => (calls.push("moveTo"), points.push({ x, y }), chain);
  chain["lineTo"] = (x: number, y: number) => (calls.push("lineTo"), points.push({ x, y }), chain);
  chain["quadraticCurveTo"] = (_cx: number, _cy: number, x: number, y: number) => (calls.push("quadraticCurveTo"), points.push({ x, y }), chain);
  for (const m of ["fill", "stroke"]) chain[m] = () => (calls.push(m), chain);
  return { g: chain as unknown as import("pixi.js").Graphics, points, calls };
}

describe("the poses are drawn", () => {
  const VIEWS: DrawnView[] = [3, 4, 5, 6, 7];
  const GUEST_POSES: AvatarPose[] = ["sit", "wave", "cheer", "dance", "sit_wave", "sit_cheer"];
  const GHOST_POSES: AvatarPose[] = ["cheer", "glum"];

  it("for the user, in every view and both frames, inside the frame of the sprite", () => {
    for (const pose of GUEST_POSES) {
      for (const view of VIEWS) {
        for (const frame of [0, 1] as const) {
          const { g, points, calls } = recorder();
          drawAvatar(g, "user", view, frame, pose);
          expect(calls.length, `${pose} ${view} ${frame}`).toBeGreaterThan(10);
          for (const p of points) {
            expect(p.x, `${pose} ${view} ${frame} x`).toBeGreaterThanOrEqual(AVATAR_FRAME.x);
            expect(p.x, `${pose} ${view} ${frame} x`).toBeLessThanOrEqual(AVATAR_FRAME.x + AVATAR_FRAME.width);
            expect(p.y, `${pose} ${view} ${frame} y`).toBeGreaterThanOrEqual(AVATAR_FRAME.y);
            expect(p.y, `${pose} ${view} ${frame} y`).toBeLessThanOrEqual(AVATAR_FRAME.y + AVATAR_FRAME.height);
          }
        }
      }
    }
  });

  it("for every ghost, in every view and both frames, inside the frame of the sprite", () => {
    const roles: RoleKey[] = ["architect", "developer", "qa", "builder", "hr", "reviewer", "researcher"];
    for (const role of roles) {
      for (const pose of GHOST_POSES) {
        for (const view of VIEWS) {
          for (const frame of [0, 1] as const) {
            const { g, points } = recorder();
            drawAvatar(g, role, view, frame, pose);
            for (const p of points) {
              expect(p.x, `${role} ${pose} ${view} ${frame}`).toBeGreaterThanOrEqual(AVATAR_FRAME.x);
              expect(p.x, `${role} ${pose} ${view} ${frame}`).toBeLessThanOrEqual(AVATAR_FRAME.x + AVATAR_FRAME.width);
              expect(p.y, `${role} ${pose} ${view} ${frame}`).toBeGreaterThanOrEqual(AVATAR_FRAME.y);
              expect(p.y, `${role} ${pose} ${view} ${frame}`).toBeLessThanOrEqual(AVATAR_FRAME.y + AVATAR_FRAME.height);
            }
          }
        }
      }
    }
  });

  it("with a frame that differs from the other one, so the loop shows", () => {
    for (const pose of ["wave", "cheer", "dance"] as const) {
      const a = recorder();
      const b = recorder();
      drawAvatar(a.g, "user", 3, 0, pose);
      drawAvatar(b.g, "user", 3, 1, pose);
      expect(JSON.stringify(a.points), pose).not.toBe(JSON.stringify(b.points));
    }
    const a = recorder();
    const b = recorder();
    drawAvatar(a.g, "developer", 3, 0, "glum");
    drawAvatar(b.g, "developer", 3, 1, "glum");
    expect(JSON.stringify(a.points)).not.toBe(JSON.stringify(b.points));
  });

  it("without a pose, and for a pose the figure does not have, the stance is the one it always had", () => {
    for (const [role, pose] of [["user", undefined], ["user", "glum"], ["developer", undefined], ["developer", "wave"], ["developer", "dance"], ["developer", "sit"]] as const) {
      const plain = recorder();
      const posed = recorder();
      drawAvatar(plain.g, role, 3, 0);
      drawAvatar(posed.g, role, 3, 0, pose);
      expect(JSON.stringify(posed.points), `${role} ${String(pose)}`).toBe(JSON.stringify(plain.points));
    }
  });

  it("a ghost cheers with sparks on the high frame only, so a held first frame has none", () => {
    const low = recorder();
    const high = recorder();
    drawAvatar(low.g, "qa", 3, 0, "cheer");
    drawAvatar(high.g, "qa", 3, 1, "cheer");
    expect(high.calls.filter((c) => c === "circle").length - low.calls.filter((c) => c === "circle").length).toBe(3);
  });
});

describe("the face of the mood on the name tag", () => {
  it("is a different shape for each mood, not only a different colour", () => {
    const faces = MOODS.map((m) => moodFace(m));
    expect(new Set(faces.map((f) => `${f.eyes}/${f.mouth}`)).size).toBe(3);
    expect(new Set(faces.map((f) => f.colour)).size).toBe(3);
    expect(moodFace("rested").colour).toBe(PALETTE.moodRested);
    expect(moodFace("busy").colour).toBe(PALETTE.moodBusy);
    expect(moodFace("tired").colour).toBe(PALETTE.moodTired);
  });

  it("is drawn small enough for the tag, for each mood", () => {
    for (const mood of MOODS) {
      const { g, points, calls } = recorder();
      drawMoodFace(g, mood, 10, 8);
      expect(calls).toContain("circle");
      for (const p of points) {
        expect(Math.abs(p.x - 10)).toBeLessThanOrEqual(MOOD_FACE_WIDTH / 2);
        expect(Math.abs(p.y - 8)).toBeLessThanOrEqual(MOOD_FACE_WIDTH / 2);
      }
    }
  });
});
