import type { Graphics } from "pixi.js";
import type { Mood } from "@agentlife/shared";
import { PALETTE } from "../palette.ts";

/**
 * The small face on the name tag of a desk ghost (waiting-fun): the mood in a shape, not only in a colour. Rested has round
 * eyes and a smile, busy round eyes and a straight mouth, tired flat (half-closed) eyes and a frown.
 */
export interface MoodFace {
  eyes: "round" | "flat";
  mouth: "smile" | "straight" | "frown";
  colour: number;
}

export function moodFace(mood: Mood): MoodFace {
  switch (mood) {
    case "rested":
      return { eyes: "round", mouth: "smile", colour: PALETTE.moodRested };
    case "busy":
      return { eyes: "round", mouth: "straight", colour: PALETTE.moodBusy };
    case "tired":
      return { eyes: "flat", mouth: "frown", colour: PALETTE.moodTired };
  }
}

/** Width the face takes on the tag, with its gap. */
export const MOOD_FACE_WIDTH = 14;

/** Draws the face of `mood` centred on (x, y), 10 px wide. */
export function drawMoodFace(g: Graphics, mood: Mood, x: number, y: number): void {
  const face = moodFace(mood);
  const ink = PALETTE.tagBg;
  g.circle(x, y, 5).fill(face.colour);
  if (face.eyes === "round") {
    g.circle(x - 2, y - 1.2, 0.9).fill(ink);
    g.circle(x + 2, y - 1.2, 0.9).fill(ink);
  } else {
    g.rect(x - 3.2, y - 1.6, 2.4, 1).fill(ink);
    g.rect(x + 0.8, y - 1.6, 2.4, 1).fill(ink);
  }
  if (face.mouth === "smile") g.moveTo(x - 2.5, y + 1.2).quadraticCurveTo(x, y + 4, x + 2.5, y + 1.2).stroke({ color: ink, width: 1 });
  else if (face.mouth === "straight") g.rect(x - 2, y + 2, 4, 1).fill(ink);
  else g.moveTo(x - 2.5, y + 3).quadraticCurveTo(x, y + 0.8, x + 2.5, y + 3).stroke({ color: ink, width: 1 });
}
