import type { Graphics } from "pixi.js";
import { FURNI_COLOURS as C, shade } from "../palette.ts";
import { P, WALL_UNITS, drawBoxes, fillPoly } from "./iso-draw.ts";
import type { BoxPiece, Pt } from "./iso-draw.ts";

/**
 * Procedural draw recipes, one per furniture `draw` id. Coordinates are continuous tile
 * coordinates relative to the footprint's top-left tile, whose centre is (0, 0); the footprint
 * covers x in [-0.5, w - 0.5] and y in [-0.5, l - 0.5]. This module only uses the Graphics type,
 * so it can run under a fake Graphics in tests.
 */
export interface RecipeCtx {
  /** Footprint size after applying the facing (w and l already swapped for dir 2/6). */
  w: number;
  l: number;
  /** Facing: 0 north (-y), 2 east (+x), 4 south (+y), 6 west (-x). */
  dir: 0 | 2 | 4 | 6;
  height: number;
}

export type Recipe = (g: Graphics, c: RecipeCtx) => void;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function full(c: RecipeCtx, inset = 0): Rect {
  return { x0: -0.5 + inset, y0: -0.5 + inset, x1: c.w - 0.5 - inset, y1: c.l - 0.5 - inset };
}

/** A slab of the given depth hugging the back (opposite the facing) side of the footprint. */
function backRect(c: RecipeCtx, depth: number, inset = 0): Rect {
  const f = full(c);
  switch (c.dir) {
    case 4:
      return { x0: f.x0, x1: f.x1, y0: f.y0 + inset, y1: f.y0 + inset + depth };
    case 0:
      return { x0: f.x0, x1: f.x1, y0: f.y1 - inset - depth, y1: f.y1 - inset };
    case 2:
      return { y0: f.y0, y1: f.y1, x0: f.x0 + inset, x1: f.x0 + inset + depth };
    case 6:
      return { y0: f.y0, y1: f.y1, x0: f.x1 - inset - depth, x1: f.x1 - inset };
  }
}

function frontRect(c: RecipeCtx, depth: number, inset = 0): Rect {
  return backRect({ ...c, dir: ((c.dir + 4) % 8) as RecipeCtx["dir"] }, depth, inset);
}

/** Shrink a rect by `amount` at both ends of its long axis. */
function shrinkLong(r: Rect, amount: number): Rect {
  return r.x1 - r.x0 >= r.y1 - r.y0
    ? { ...r, x0: r.x0 + amount, x1: r.x1 - amount }
    : { ...r, y0: r.y0 + amount, y1: r.y1 - amount };
}

function piece(r: Rect, z0: number, z1: number, colour: number): BoxPiece {
  return { ...r, z0, z1, colour };
}

/**
 * Quad on the visible front face of a slab (only when the item faces south or east, the two
 * directions the camera can see). u0..u1 is the fraction across the face.
 */
function frontFace(c: RecipeCtx, s: Rect, u0: number, u1: number, z0: number, z1: number): Pt[] | null {
  if (c.dir === 4) {
    const xa = s.x0 + u0 * (s.x1 - s.x0);
    const xb = s.x0 + u1 * (s.x1 - s.x0);
    return [P(xa, s.y1, z0), P(xb, s.y1, z0), P(xb, s.y1, z1), P(xa, s.y1, z1)];
  }
  if (c.dir === 2) {
    const ya = s.y0 + u0 * (s.y1 - s.y0);
    const yb = s.y0 + u1 * (s.y1 - s.y0);
    return [P(s.x1, ya, z0), P(s.x1, yb, z0), P(s.x1, yb, z1), P(s.x1, ya, z1)];
  }
  return null;
}

function desk(colour: number): Recipe {
  return (g, c) => {
    const top = full(c, 0.06);
    const monitor = deskMonitor(c);
    const keyboard = shrinkLong(frontRect(c, 0.2, 0.14), 0.3);
    drawBoxes(g, [
      piece(top, 0, 1.7, colour),
      piece(monitor, 1.7, 3.0, C.screenOff),
      piece(keyboard, 1.7, 1.8, C.metal),
    ]);
    const face = deskMonitorFace(c);
    if (face) fillPoly(g, face, C.screen);
    // Small glow on the desk top in front of the monitor.
    const [gx, gy] = P((monitor.x0 + monitor.x1) / 2, (monitor.y0 + monitor.y1) / 2, 1.72);
    g.ellipse(gx, gy, 18, 8).fill({ color: C.screen, alpha: 0.12 });
  };
}

/** The monitor block on the back of a desk. */
function deskMonitor(c: RecipeCtx): Rect {
  return shrinkLong(backRect(c, 0.14, 0.14), 0.3);
}

/**
 * The lit face of a desk monitor as four screen points (bottom left, bottom right, top right, top left), relative to the
 * item's origin, or null when the monitor faces away from the camera. The live monitor effect draws on the same quad.
 */
export function deskMonitorFace(c: RecipeCtx): Pt[] | null {
  return frontFace(c, deskMonitor(c), 0.08, 0.92, 1.85, 2.9);
}

/** Centre of the desk top in front of the monitor, relative to the item's origin (where the baked glow sits). */
export function deskGlowCentre(c: RecipeCtx): Pt {
  const m = deskMonitor(c);
  return P((m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, 1.72);
}

const mailbox: Recipe = (g) => {
  drawBoxes(g, [
    piece({ x0: -0.1, y0: -0.1, x1: 0.1, y1: 0.1 }, 0, 1.2, C.woodDark),
    piece({ x0: -0.36, y0: -0.28, x1: 0.36, y1: 0.28 }, 1.2, 2.6, C.mailbox),
    piece({ x0: -0.4, y0: -0.32, x1: 0.4, y1: 0.32 }, 2.6, 2.8, shade(C.mailbox, 0.8)),
    piece({ x0: 0.36, y0: -0.05, x1: 0.46, y1: 0.05 }, 1.9, 2.7, C.mailboxFlag),
  ]);
  // Mail slot on the south face.
  fillPoly(g, [P(-0.22, 0.28, 1.95), P(0.22, 0.28, 1.95), P(0.22, 0.28, 2.1), P(-0.22, 0.28, 2.1)], C.screenOff);
};

/** A reception counter: a dark body, a lighter top, a service bell and an open guest book. */
const receptionDesk: Recipe = (g, c) => {
  const body = full(c, 0.05);
  const top = full(c, 0.02);
  const mid = { x: (top.x0 + top.x1) / 2, y: (top.y0 + top.y1) / 2 };
  drawBoxes(g, [
    piece(body, 0, 1.6, C.woodDark),
    piece(top, 1.6, 1.8, C.wood),
    piece({ x0: mid.x - 0.1, y0: mid.y - 0.1, x1: mid.x + 0.1, y1: mid.y + 0.1 }, 1.8, 2.15, C.pumpkin),
    piece({ x0: mid.x - 0.03, y0: mid.y - 0.03, x1: mid.x + 0.03, y1: mid.y + 0.03 }, 2.15, 2.3, C.metal),
    piece({ x0: mid.x + 0.3, y0: mid.y - 0.14, x1: mid.x + 0.6, y1: mid.y + 0.14 }, 1.8, 1.88, C.lampShade),
  ]);
};

const board: Recipe = (g, c) => {
  const slab = backRect(c, 0.14, 0.04);
  const legs: BoxPiece[] = [];
  const longX = slab.x1 - slab.x0 >= slab.y1 - slab.y0;
  const leg = (a: number, b: number): Rect =>
    longX ? { ...slab, x0: a, x1: b } : { ...slab, y0: a, y1: b };
  const [lo, hi] = longX ? [slab.x0, slab.x1] : [slab.y0, slab.y1];
  legs.push(piece(leg(lo + 0.05, lo + 0.17), 0, 1.0, C.woodDark));
  legs.push(piece(leg(hi - 0.17, hi - 0.05), 0, 1.0, C.woodDark));
  drawBoxes(g, [...legs, piece(slab, 1.0, 3.9, C.wood)]);
  const cork = frontFace(c, slab, 0.05, 0.95, 1.2, 3.7);
  if (cork) fillPoly(g, cork, C.cork);
  const notes = [C.note1, C.note2, C.note3, C.note2, C.note1];
  notes.forEach((colour, k) => {
    const row = k % 2;
    const u0 = 0.1 + k * 0.17;
    const q = frontFace(c, slab, u0, u0 + 0.12, 2.0 + row * 0.8, 2.6 + row * 0.8);
    if (q) fillPoly(g, q, colour);
  });
};

const chair: Recipe = (g, c) => {
  drawBoxes(g, [
    piece(full(c, 0.2), 0, 0.9, C.chair),
    piece(backRect(c, 0.1, 0.2), 0.9, 2.0, shade(C.chair, 0.85)),
  ]);
};

const plant: Recipe = (g) => {
  drawBoxes(g, [piece({ x0: -0.22, y0: -0.22, x1: 0.22, y1: 0.22 }, 0, 0.9, C.pot)]);
  const [bx, by] = P(0, 0, 0.9);
  const leaves: [number, number, number, number, number][] = [
    [0, -22, 14, 18, C.leafDark],
    [-10, -14, 8, 12, C.leafDark],
    [10, -16, 8, 12, C.leafDark],
    [-3, -26, 7, 11, C.leafLight],
    [7, -22, 5, 8, C.leafLight],
  ];
  for (const [dx, dy, rx, ry, colour] of leaves) g.ellipse(bx + dx, by + dy, rx, ry).fill(colour);
};

const lamp: Recipe = (g) => {
  drawBoxes(g, [
    piece({ x0: -0.18, y0: -0.18, x1: 0.18, y1: 0.18 }, 0, 0.15, C.metal),
    piece({ x0: -0.04, y0: -0.04, x1: 0.04, y1: 0.04 }, 0.15, 4.0, C.metal),
    piece({ x0: -0.22, y0: -0.22, x1: 0.22, y1: 0.22 }, 4.0, 5.0, C.lampShade),
  ]);
  const [gx, gy] = P(0, 0, 4.5);
  g.ellipse(gx, gy, 34, 26).fill({ color: C.lampGlow, alpha: 0.1 });
  g.ellipse(gx, gy, 20, 15).fill({ color: C.lampGlow, alpha: 0.14 });
};

const sofa: Recipe = (g, c) => {
  const f = full(c, 0.04);
  const back = backRect(c, 0.28, 0.04);
  const longX = f.x1 - f.x0 >= f.y1 - f.y0;
  const armA: Rect = longX ? { ...f, x1: f.x0 + 0.2 } : { ...f, y1: f.y0 + 0.2 };
  const armB: Rect = longX ? { ...f, x0: f.x1 - 0.2 } : { ...f, y0: f.y1 - 0.2 };
  drawBoxes(g, [
    piece(f, 0, 0.9, C.sofa),
    piece(back, 0.9, 2.1, C.sofa),
    piece(armA, 0.9, 1.5, C.sofaLight),
    piece(armB, 0.9, 1.5, C.sofaLight),
  ]);
};

const jackOLanternLamp: Recipe = (g) => {
  drawBoxes(g, [piece({ x0: -0.3, y0: -0.3, x1: 0.3, y1: 0.3 }, 0, 0.25, C.woodDark)]);
  const [cx, cy] = P(0, 0, 0.9);
  g.ellipse(cx, cy, 34, 26).fill({ color: C.pumpkinFace, alpha: 0.1 });
  g.ellipse(cx, cy, 20, 16).fill(C.pumpkinDark);
  g.ellipse(cx - 8, cy, 13, 16).fill(C.pumpkin);
  g.ellipse(cx + 8, cy, 13, 16).fill(C.pumpkin);
  g.ellipse(cx, cy, 8, 16).fill(shade(C.pumpkin, 1.15));
  g.rect(cx - 2, cy - 21, 4, 6).fill(C.stem);
  g.poly([cx - 11, cy - 3, cx - 4, cy - 3, cx - 7.5, cy - 10]).fill(C.pumpkinFace);
  g.poly([cx + 4, cy - 3, cx + 11, cy - 3, cx + 7.5, cy - 10]).fill(C.pumpkinFace);
  g.poly([
    cx - 11, cy + 4, cx - 7, cy + 8, cx - 3, cy + 4, cx + 1, cy + 8, cx + 5, cy + 4, cx + 11, cy + 4,
    cx + 8, cy + 11, cx - 8, cy + 11,
  ]).fill(C.pumpkinFace);
};

const cobweb: Recipe = (g) => {
  const top = WALL_UNITS;
  const A = (t: number): Pt => P(-0.5, -0.5 + t, top);
  const B = (t: number): Pt => P(-0.5 + t, -0.5, top);
  const V = (t: number): Pt => P(-0.5, -0.5, top - t * 1.6);
  const corner = P(-0.5, -0.5, top);
  const web = { color: C.web, width: 1, alpha: 0.55 };
  for (const end of [A(1.8), B(1.8), V(1.8)]) g.moveTo(corner[0], corner[1]).lineTo(end[0], end[1]).stroke(web);
  for (const t of [0.6, 1.1, 1.6]) {
    const a = A(t);
    const b = B(t);
    const v = V(t);
    g.moveTo(a[0], a[1]).lineTo(v[0], v[1]).lineTo(b[0], b[1]).stroke(web);
  }
  // A small spider hanging from the corner thread.
  const hang = V(1.2);
  const spider = P(-0.5, -0.5, top - 3.4);
  g.moveTo(hang[0], hang[1]).lineTo(spider[0], spider[1]).stroke({ color: C.web, width: 1, alpha: 0.7 });
  g.circle(spider[0], spider[1], 2.5).fill(0x0b0a12);
};

export const RECIPES: Readonly<Record<string, Recipe>> = {
  computer_desk: desk(C.deskArchitect),
  agent_desk: desk(C.wood),
  mailbox,
  board,
  reception_desk: receptionDesk,
  chair,
  plant,
  lamp,
  sofa,
  jack_o_lantern_lamp: jackOLanternLamp,
  cobweb,
};
