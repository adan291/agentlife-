import type { TextStyleOptions } from "pixi.js";
import { PALETTE } from "../palette.ts";

/** Smallest text size on the canvas, in px: name tags, status badges and bubbles stay legible at zoom 1×. */
export const MIN_LABEL_PX = 11;
/** Dark outline around light label text, in px. */
export const LABEL_OUTLINE_PX = 2;

/** Bold monospace text with a dark outline; sizes below the minimum are raised to it. */
export function labelStyle(size: number, fill: number): TextStyleOptions {
  return {
    fontFamily: "monospace",
    fontSize: Math.max(MIN_LABEL_PX, size),
    fill,
    fontWeight: "bold",
    stroke: { color: PALETTE.background, width: LABEL_OUTLINE_PX, join: "round" },
  };
}

/** Speech bubble text: dark on a light bubble, so no outline; same minimum size. */
export function bubbleTextStyle(size: number, wrapWidth: number): TextStyleOptions {
  return {
    fontFamily: "monospace",
    fontSize: Math.max(MIN_LABEL_PX, size),
    fill: PALETTE.bubbleText,
    wordWrap: true,
    wordWrapWidth: wrapWidth,
  };
}
