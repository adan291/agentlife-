import type { Graphics } from "pixi.js";
import type { OutfitPart, OutfitSlot } from "@agentlife/shared";
import { PART_RECIPES } from "./outfit-parts.ts";

/**
 * Outfits on a ghost (ghost-skins). A part is a recipe drawn with the same `Graphics` calls as the ghost itself; the ghost
 * tells the recipe where its head and body are (`PartAnchors`), so a part follows the float bob, the cheer hop and the
 * glum sink. The design is in `.kiro/specs/ghost-skins/design.md`.
 */

/** The four colours of a part as numbers (`main`, `shade`, `light`, `accent`). */
export interface Colours {
  main: number;
  shade: number;
  light: number;
  accent: number;
}

/** A part ready to draw: its id picks the recipe, its palette the colours. */
export interface LookPart {
  id: string;
  palette: Colours;
}

/** What a figure wears: at most one part per slot. */
export type OutfitLook = Partial<Record<OutfitSlot, LookPart>>;

/** The five views a ghost is drawn in (see `figure.ts`). */
export type PartView = 3 | 4 | 5 | 6 | 7;

/** Where the parts of the ghost are, in sprite pixels with the feet at (0, 0). */
export interface PartAnchors {
  view: PartView;
  /** Centre of the head dome. */
  hx: number;
  hy: number;
  /** Radius of the head dome and half width of the body. */
  hr: number;
  bw: number;
  /** First row of the body below the face, and the row where the hem scallops start. */
  chest: number;
  hem: number;
  /** Offsets of the eyes from `hx` (empty from behind). */
  eyes: readonly number[];
}

/** What a recipe gets: the anchors, the colours and what follows from the view. */
export interface PartCtx extends PartAnchors {
  g: Graphics;
  c: Colours;
  /** The face shows (views 3, 4, 5). */
  front: boolean;
  /** The figure looks to screen-left (views 4, 5, 6): -1. Views 3 and 7: 0. */
  lean: -1 | 0;
  /** Middle of the face, and of the chest (a little less turned than the face). */
  fx: number;
  cx: number;
}

export type PartRecipe = (c: PartCtx) => void;

/** `#rrggbb` as a number. */
export function colourNumber(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

export function lookPart(part: OutfitPart): LookPart {
  const p = part.palette;
  return { id: part.id, palette: { main: colourNumber(p.main), shade: colourNumber(p.shade), light: colourNumber(p.light), accent: colourNumber(p.accent) } };
}

/** The look of a list of parts: one per slot, the last of a slot wins. */
export function lookOf(parts: readonly OutfitPart[]): OutfitLook {
  const look: OutfitLook = {};
  for (const part of parts) look[part.slot] = lookPart(part);
  return look;
}

/** The part ids of a look, as a short text for a cache key. Empty for a bare figure. */
export function lookKey(look: OutfitLook | undefined): string {
  if (!look) return "";
  const key = `${look.hat?.id ?? ""}|${look.top?.id ?? ""}|${look.accessory?.id ?? ""}`;
  return key === "||" ? "" : key;
}

/** True when the id has a drawing. A part that has none (an id from a newer server) is skipped, never an error. */
export function hasRecipe(partId: string): boolean {
  return Object.hasOwn(PART_RECIPES, partId);
}

/** Draws the part a look has in `slot`, if any. Called by the figure at the three points of the depth order. */
export function drawLookSlot(g: Graphics, look: OutfitLook | undefined, slot: OutfitSlot, a: PartAnchors): void {
  const part = look?.[slot];
  if (!part || !hasRecipe(part.id)) return;
  const front = a.view === 3 || a.view === 4 || a.view === 5;
  const lean = a.view === 4 || a.view === 5 || a.view === 6 ? -1 : 0;
  const mid = a.eyes.length > 0 ? a.eyes.reduce((s, e) => s + e, 0) / a.eyes.length : 0;
  const fx = a.hx + (front ? mid : 0);
  PART_RECIPES[part.id]!({ ...a, g, c: part.palette, front, lean, fx, cx: a.hx + (fx - a.hx) * 0.5 });
}
