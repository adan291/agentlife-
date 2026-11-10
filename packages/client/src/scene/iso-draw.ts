import type { Graphics } from "pixi.js";
import { tileToScreen } from "@agentlife/shared";
import { shade } from "../palette.ts";

export type Pt = readonly [number, number];

/** Screen point of continuous tile coordinates (x, y) at height z (units of 16 px). */
export function P(x: number, y: number, z = 0): Pt {
  const p = tileToScreen({ x, y, z });
  return [p.sx, p.sy];
}

export function fillPoly(g: Graphics, pts: readonly Pt[], colour: number, alpha = 1): void {
  g.poly(pts.flat()).fill({ color: colour, alpha });
}

export function strokePoly(g: Graphics, pts: readonly Pt[], colour: number, width = 1, alpha = 1): void {
  g.poly(pts.flat()).stroke({ color: colour, width, alpha });
}

/** Height of the two back walls, in height units. */
export const WALL_UNITS = 6;

export interface BoxPiece {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
  colour: number;
}

/** Draw several boxes in a stacking-safe order: lower first, then back to front. */
export function drawBoxes(g: Graphics, pieces: readonly BoxPiece[]): void {
  const sorted = [...pieces].sort((a, b) => a.z0 - b.z0 || a.x1 + a.y1 - (b.x1 + b.y1));
  for (const p of sorted) box(g, p.x0, p.y0, p.x1, p.y1, p.z0, p.z1, p.colour);
}

/**
 * Isometric box between continuous tile coordinates (x0,y0)-(x1,y1) and heights z0..z1.
 * Draws the three visible faces (top, south = +y, east = +x) with an outline.
 */
export function box(
  g: Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z0: number,
  z1: number,
  colour: number,
): void {
  const south = [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)];
  const east = [P(x1, y1, z0), P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1)];
  const top = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
  const line = shade(colour, 0.3);
  fillPoly(g, south, shade(colour, 0.74));
  strokePoly(g, south, line);
  fillPoly(g, east, shade(colour, 0.5));
  strokePoly(g, east, line);
  fillPoly(g, top, colour);
  strokePoly(g, top, line);
}
