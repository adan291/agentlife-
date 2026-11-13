import type { Graphics } from "pixi.js";
import { FURNI_COLOURS as C, PALETTE, shade } from "../palette.ts";
import { P, WALL_UNITS, drawBoxes, fillPoly, strokePoly } from "./iso-draw.ts";
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

/**
 * Where a candle stands on a desk, relative to the item's origin: on the desk top at the far end of the back edge,
 * beside the monitor (which is shorter than the desk by 0.3 at each end), so it never covers the screen.
 */
export function deskCandlePoint(c: RecipeCtx): Pt {
  const b = backRect(c, 0.14, 0.14);
  const longX = b.x1 - b.x0 >= b.y1 - b.y0;
  return longX ? P(b.x1 - 0.1, (b.y0 + b.y1) / 2, 1.7) : P((b.x0 + b.x1) / 2, b.y1 - 0.1, 1.7);
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

/** The HR desk: a wooden counter with a stack of personnel folders, a name plate and a candle-coloured lamp. */
const hrDesk: Recipe = (g, c) => {
  const body = full(c, 0.05);
  const top = full(c, 0.02);
  const mid = { x: (top.x0 + top.x1) / 2, y: (top.y0 + top.y1) / 2 };
  drawBoxes(g, [
    piece(body, 0, 1.5, C.woodDark),
    piece(top, 1.5, 1.7, C.deskArchitect),
    // Three folders in a leaning stack.
    piece({ x0: mid.x - 0.55, y0: mid.y - 0.16, x1: mid.x - 0.2, y1: mid.y + 0.16 }, 1.7, 1.8, C.note1),
    piece({ x0: mid.x - 0.53, y0: mid.y - 0.15, x1: mid.x - 0.18, y1: mid.y + 0.17 }, 1.8, 1.9, C.note2),
    piece({ x0: mid.x - 0.56, y0: mid.y - 0.16, x1: mid.x - 0.21, y1: mid.y + 0.15 }, 1.9, 2.0, C.note3),
    // Name plate.
    piece({ x0: mid.x + 0.05, y0: mid.y - 0.12, x1: mid.x + 0.35, y1: mid.y + 0.12 }, 1.7, 1.95, C.metal),
    // Small lamp.
    piece({ x0: mid.x + 0.5, y0: mid.y - 0.05, x1: mid.x + 0.6, y1: mid.y + 0.05 }, 1.7, 2.3, C.metal),
    piece({ x0: mid.x + 0.43, y0: mid.y - 0.12, x1: mid.x + 0.67, y1: mid.y + 0.12 }, 2.3, 2.6, C.lampGlow),
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

/** A metal lift shaft: two dark doors with a gap between them and a lit floor indicator above. */
const elevator: Recipe = (g, c) => {
  const slab = backRect(c, 0.2, 0.02);
  drawBoxes(g, [piece(slab, 0, 5.0, C.metal)]);
  for (const [a, b] of [
    [0.1, 0.48],
    [0.52, 0.9],
  ] as const) {
    const door = frontFace(c, slab, a, b, 0.2, 4.0);
    if (door) fillPoly(g, door, C.screenOff);
  }
  const indicator = frontFace(c, slab, 0.4, 0.6, 4.3, 4.7);
  if (indicator) fillPoly(g, indicator, C.pumpkin);
};

/** A wall board with a list of floors: dark panel, coloured rows. */
const directoryBoard: Recipe = (g, c) => {
  const slab = backRect(c, 0.14, 0.04);
  drawBoxes(g, [piece(slab, 1.0, 3.9, C.woodDark)]);
  const panel = frontFace(c, slab, 0.05, 0.95, 1.2, 3.7);
  if (panel) fillPoly(g, panel, C.screenOff);
  [C.screen, C.pumpkin, C.note3].forEach((colour, k) => {
    const row = frontFace(c, slab, 0.12, 0.88, 3.1 - k * 0.6, 3.4 - k * 0.6);
    if (row) fillPoly(g, row, colour);
  });
};

/** A wall board with a blueprint and progress bars: what is being built. */
const constructionBoard: Recipe = (g, c) => {
  const slab = backRect(c, 0.14, 0.04);
  drawBoxes(g, [piece(slab, 1.0, 3.9, C.woodDark)]);
  const panel = frontFace(c, slab, 0.05, 0.95, 1.2, 3.7);
  if (panel) fillPoly(g, panel, C.cork);
  // Three progress bars of different length, as on a site hoarding.
  [0.8, 0.55, 0.3].forEach((fill, k) => {
    const y0 = 3.1 - k * 0.6;
    const track = frontFace(c, slab, 0.12, 0.88, y0, y0 + 0.3);
    if (track) fillPoly(g, track, C.screenOff);
    const bar = frontFace(c, slab, 0.12, 0.12 + 0.76 * fill, y0, y0 + 0.3);
    if (bar) fillPoly(g, bar, k === 0 ? C.pumpkin : C.screen);
  });
};

/** A lectern with a paper, a board of check marks behind it: where a branch is reviewed. */
const reviewDesk: Recipe = (g, c) => {
  const back = backRect(c, 0.12, 0.1);
  drawBoxes(g, [
    piece(full(c, 0.12), 0, 1.5, C.wood),
    piece(full(c, 0.08), 1.5, 1.65, C.woodDark),
    piece(shrinkLong(frontRect(c, 0.3, 0.16), 0.15), 1.65, 1.75, C.lampShade),
    piece(back, 1.65, 3.0, C.woodDark),
  ]);
  const board = frontFace(c, back, 0.1, 0.9, 1.85, 2.9);
  if (board) fillPoly(g, board, C.screenOff);
  [C.screen, C.pumpkin].forEach((colour, k) => {
    const mark = frontFace(c, back, 0.2, 0.8, 2.5 - k * 0.4, 2.7 - k * 0.4);
    if (mark) fillPoly(g, mark, colour);
  });
};

/** A bench with three flasks and a faint glow: where tests are written. */
const testLab: Recipe = (g, c) => {
  drawBoxes(g, [
    piece(full(c, 0.1), 0, 1.5, C.metal),
    piece(full(c, 0.06), 1.5, 1.65, C.woodDark),
    piece({ x0: -0.3, y0: -0.12, x1: -0.14, y1: 0.04 }, 1.65, 2.5, C.screen),
    piece({ x0: -0.08, y0: -0.12, x1: 0.08, y1: 0.04 }, 1.65, 2.0, C.pumpkin),
    piece({ x0: 0.14, y0: -0.12, x1: 0.3, y1: 0.04 }, 1.65, 2.8, C.note3),
  ]);
  const [gx, gy] = P(0, -0.04, 2.0);
  g.ellipse(gx, gy, 20, 10).fill({ color: C.screen, alpha: 0.14 });
};

/** A tall bookcase with three rows of books. */
const libraryShelf: Recipe = (g, c) => {
  const body = full(c, 0.06);
  drawBoxes(g, [piece(body, 0, 4.0, C.woodDark)]);
  const inside = frontFace(c, body, 0.08, 0.92, 0.3, 3.8);
  if (inside) fillPoly(g, inside, C.screenOff);
  const books = [C.note1, C.note2, C.note3, C.wood, C.pumpkin, C.note1];
  [0.4, 1.55, 2.7].forEach((z, row) => {
    books.forEach((colour, k) => {
      const u0 = 0.14 + k * 0.12;
      const q = frontFace(c, body, u0, u0 + 0.09, z, z + 0.85 + ((k + row) % 3) * 0.08);
      if (q) fillPoly(g, q, colour);
    });
  });
};

/** A small standing board with a moon and stars: where the night shift is planned. */
const nightBoard: Recipe = (g, c) => {
  const body = full(c, 0.12);
  drawBoxes(g, [piece(full(c, 0.2), 0, 0.5, C.woodDark), piece(body, 0.5, 4.0, C.metal)]);
  const face = frontFace(c, body, 0.08, 0.92, 0.8, 3.7);
  if (face) fillPoly(g, face, C.screenOff);
  const moon = frontFace(c, body, 0.3, 0.7, 1.7, 3.1);
  if (moon) fillPoly(g, moon, C.lampGlow);
  // Stars: a few small squares around the moon.
  for (const [u, z] of [
    [0.16, 3.3],
    [0.8, 3.4],
    [0.2, 1.1],
    [0.76, 1.3],
  ] as const) {
    const star = frontFace(c, body, u, u + 0.06, z, z + 0.14);
    if (star) fillPoly(g, star, C.screen);
  }
};

/** A door in the wall with a lit sign above it. */
const door: Recipe = (g, c) => {
  const slab = backRect(c, 0.12, 0.04);
  drawBoxes(g, [piece(slab, 0, 5.0, C.woodDark)]);
  const leaf = frontFace(c, slab, 0.12, 0.88, 0.1, 4.0);
  if (leaf) fillPoly(g, leaf, C.wood);
  const knob = frontFace(c, slab, 0.7, 0.78, 1.8, 2.0);
  if (knob) fillPoly(g, knob, C.pumpkin);
  const sign = frontFace(c, slab, 0.25, 0.75, 4.2, 4.7);
  if (sign) fillPoly(g, sign, C.pumpkinFace);
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

// ---- Furniture of the shop (furni-shop). All drawn here, in code; nothing is loaded from a file. ----

/** A flat ellipse at tile coordinates (x, y) and height z; rx and ry are screen pixels. */
function disc(g: Graphics, x: number, y: number, z: number, rx: number, ry: number, colour: number, alpha = 1): void {
  const [sx, sy] = P(x, y, z);
  g.ellipse(sx, sy, rx, ry).fill({ color: colour, alpha });
}

function centreOf(r: Rect): { x: number; y: number } {
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
}

/** The two slabs at the sides of a seat (perpendicular to its facing). */
function armsOf(c: RecipeCtx, f: Rect, thick: number): [Rect, Rect] {
  return c.dir === 4 || c.dir === 0
    ? [{ ...f, x1: f.x0 + thick }, { ...f, x0: f.x1 - thick }]
    : [{ ...f, y1: f.y0 + thick }, { ...f, y0: f.y1 - thick }];
}

/** The two ends of a long piece along its long axis. */
function endsOf(f: Rect, thick: number): [Rect, Rect] {
  return f.x1 - f.x0 >= f.y1 - f.y0
    ? [{ ...f, x1: f.x0 + thick }, { ...f, x0: f.x1 - thick }]
    : [{ ...f, y1: f.y0 + thick }, { ...f, y0: f.y1 - thick }];
}

/** The point at fraction t along the long axis of a rect, on its centre line. */
function alongOf(f: Rect, t: number): { x: number; y: number } {
  const m = centreOf(f);
  return f.x1 - f.x0 >= f.y1 - f.y0 ? { x: f.x0 + t * (f.x1 - f.x0), y: m.y } : { x: m.x, y: f.y0 + t * (f.y1 - f.y0) };
}

function around(x: number, y: number, r: number): Rect {
  return { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
}

const armchair: Recipe = (g, c) => {
  const f = full(c, 0.1);
  const [a, b] = armsOf(c, f, 0.18);
  drawBoxes(g, [
    piece(f, 0, 0.9, C.velvet),
    piece(backRect(c, 0.24, 0.1), 0.9, 2.4, C.velvetLight),
    piece(a, 0.9, 1.5, C.velvet),
    piece(b, 0.9, 1.5, C.velvet),
  ]);
};

const bench: Recipe = (g, c) => {
  const f = full(c, 0.08);
  const [a, b] = endsOf(f, 0.2);
  drawBoxes(g, [piece(a, 0, 1.0, C.stoneDark), piece(b, 0, 1.0, C.stoneDark), piece(f, 1.0, 1.4, C.stone)]);
};

const beanbag: Recipe = (g, c) => {
  const m = centreOf(full(c));
  disc(g, m.x, m.y, 0, 24, 12, PALETTE.shadow, 0.35);
  disc(g, m.x, m.y, 0.45, 23, 13, shade(C.cloth, 0.8));
  disc(g, m.x, m.y, 0.75, 20, 11, C.cloth);
  disc(g, m.x - 0.05, m.y - 0.05, 1.0, 11, 5, shade(C.cloth, 1.25));
};

const throne: Recipe = (g, c) => {
  const f = full(c, 0.1);
  const [a, b] = armsOf(c, f, 0.16);
  const back = backRect(c, 0.2, 0.1);
  drawBoxes(g, [piece(f, 0, 1.0, C.bone), piece(back, 1.0, 4.4, C.bone), piece(a, 1.0, 1.8, C.bone), piece(b, 1.0, 1.8, C.bone)]);
  // A skull on the top of the backrest.
  const m = centreOf(back);
  const [sx, sy] = P(m.x, m.y, 4.4);
  g.circle(sx, sy - 7, 7).fill(shade(C.bone, 1.1));
  g.circle(sx - 2.6, sy - 7, 1.6).fill(C.ink);
  g.circle(sx + 2.6, sy - 7, 1.6).fill(C.ink);
};

const coffeeMachine: Recipe = (g, c) => {
  drawBoxes(g, [
    piece(around(0, 0, 0.28), 0, 2.2, C.metal),
    piece(around(0, 0, 0.3), 2.2, 2.6, C.stoneDark),
  ]);
  // A cup under the spout, on the side that faces the room.
  const m = centreOf(frontRect(c, 0.2, 0.05));
  drawBoxes(g, [piece(around(m.x, m.y, 0.09), 0.5, 0.95, C.glass)]);
  // A red light and a brass knob on top.
  const [lx, ly] = P(0, 0, 2.6);
  g.circle(lx - 4, ly - 2, 1.8).fill(C.lava);
  g.circle(lx + 4, ly - 2, 1.8).fill(C.brass);
};

const sideTable: Recipe = (g, c) => {
  drawBoxes(g, [piece(around(0, 0, 0.07), 0, 1.4, C.woodDark), piece(full(c, 0.14), 1.4, 1.6, C.wood)]);
};

const coffeeTable: Recipe = (g, c) => {
  const f = full(c, 0.08);
  const leg = (x: number, y: number): BoxPiece => piece({ x0: x, y0: y, x1: x + 0.1, y1: y + 0.1 }, 0, 0.9, C.woodDark);
  drawBoxes(g, [leg(f.x0, f.y0), leg(f.x1 - 0.1, f.y0), leg(f.x0, f.y1 - 0.1), leg(f.x1 - 0.1, f.y1 - 0.1), piece(f, 0.9, 1.2, C.wood)]);
};

const roundTable: Recipe = (g, c) => {
  const m = centreOf(full(c));
  disc(g, m.x, m.y, 0, 34, 17, PALETTE.shadow, 0.3);
  drawBoxes(g, [piece(around(m.x, m.y, 0.14), 0, 1.6, C.woodDark)]);
  disc(g, m.x, m.y, 1.6, 54, 27, shade(C.wood, 0.7));
  disc(g, m.x, m.y, 1.8, 54, 27, C.wood);
  disc(g, m.x, m.y, 1.82, 34, 17, C.velvet);
  disc(g, m.x, m.y, 1.84, 14, 7, C.brass);
};

const potionBar: Recipe = (g, c) => {
  const f = full(c, 0.05);
  const top = full(c, 0.02);
  const bottle = (t: number, h: number, colour: number): BoxPiece => {
    const p = alongOf(top, t);
    return piece(around(p.x, p.y, 0.07), 1.8, 1.8 + h, colour);
  };
  drawBoxes(g, [
    piece(f, 0, 1.6, C.woodDark),
    piece(top, 1.6, 1.8, C.wood),
    bottle(0.18, 0.7, C.potion),
    bottle(0.38, 0.5, C.lava),
    bottle(0.58, 0.8, C.glass),
    bottle(0.8, 0.55, C.note3),
  ]);
  const g1 = alongOf(top, 0.5);
  disc(g, g1.x, g1.y, 2.1, 46, 16, C.potion, 0.08);
};

const candelabra: Recipe = (g) => {
  drawBoxes(g, [
    piece(around(0, 0, 0.2), 0, 0.2, C.stoneDark),
    piece(around(0, 0, 0.04), 0.2, 2.5, C.brass),
    piece({ x0: -0.3, y0: -0.04, x1: 0.3, y1: 0.04 }, 2.4, 2.5, C.brass),
    piece(around(-0.27, 0, 0.05), 2.5, 3.1, C.bone),
    piece(around(0, 0, 0.05), 2.5, 3.3, C.bone),
    piece(around(0.27, 0, 0.05), 2.5, 3.1, C.bone),
  ]);
  for (const [x, z] of [[-0.27, 3.1], [0, 3.3], [0.27, 3.1]] as const) {
    const [fx, fy] = P(x, 0, z);
    g.ellipse(fx, fy - 4, 2.6, 4.6).fill(C.pumpkin);
    g.ellipse(fx, fy - 3, 1.2, 2.6).fill(C.pumpkinFace);
  }
  disc(g, 0, 0, 3.4, 34, 24, C.lampGlow, 0.1);
};

const floorTorch: Recipe = (g) => {
  drawBoxes(g, [
    piece(around(0, 0, 0.2), 0, 0.2, C.stoneDark),
    piece(around(0, 0, 0.05), 0.2, 3.7, C.woodDark),
    piece(around(0, 0, 0.2), 3.7, 4.3, C.metal),
  ]);
  const [fx, fy] = P(0, 0, 4.3);
  g.poly([fx - 8, fy, fx - 2, fy - 18, fx, fy - 26, fx + 3, fy - 16, fx + 8, fy]).fill(C.pumpkin);
  g.poly([fx - 4, fy, fx, fy - 15, fx + 4, fy]).fill(C.pumpkinFace);
  disc(g, 0, 0, 4.9, 38, 28, C.pumpkin, 0.1);
};

const lavaLamp: Recipe = (g) => {
  drawBoxes(g, [
    piece(around(0, 0, 0.2), 0, 0.5, C.metal),
    piece(around(0, 0, 0.13), 0.5, 2.0, C.lavaGlass),
    piece(around(0, 0, 0.09), 2.0, 2.4, C.metal),
  ]);
  const [bx, by] = P(0, 0, 1.0);
  g.ellipse(bx - 1, by, 4.5, 6).fill(C.lava);
  const [cx, cy] = P(0, 0, 1.6);
  g.ellipse(cx + 1, cy, 3, 4).fill(C.lava);
  disc(g, 0, 0, 1.4, 22, 16, C.lava, 0.08);
};

const crystalBall: Recipe = (g) => {
  drawBoxes(g, [piece(around(0, 0, 0.22), 0, 0.5, C.stoneDark), piece(around(0, 0, 0.14), 0.5, 0.8, C.brass)]);
  const [bx, by] = P(0, 0, 1.6);
  g.circle(bx, by, 12).fill(shade(C.glass, 0.55));
  g.circle(bx, by, 10).fill(C.glassDark);
  g.circle(bx - 3, by - 3, 4).fill({ color: C.glass, alpha: 0.7 });
  g.circle(bx + 3, by + 3, 2).fill({ color: C.rune, alpha: 0.9 });
  disc(g, 0, 0, 1.6, 30, 22, C.rune, 0.1);
};

const fern: Recipe = (g) => {
  drawBoxes(g, [piece(around(0, 0, 0.22), 0, 0.9, C.pot)]);
  const [bx, by] = P(0, 0, 0.9);
  const fronds: [number, number, number, number, number][] = [
    [-14, -10, 12, 6, C.leafDark],
    [14, -10, 12, 6, C.leafDark],
    [0, -26, 6, 16, C.leafDark],
    [-8, -22, 5, 12, C.leafLight],
    [9, -21, 5, 12, C.leafLight],
    [-16, -20, 8, 5, C.leafLight],
    [16, -19, 8, 5, C.leafLight],
  ];
  for (const [dx, dy, rx, ry, colour] of fronds) g.ellipse(bx + dx, by + dy, rx, ry).fill(colour);
};

const palm: Recipe = (g) => {
  drawBoxes(g, [piece(around(0, 0, 0.24), 0, 0.9, C.pot), piece(around(0, 0, 0.05), 0.9, 4.6, C.woodDark)]);
  const [tx, ty] = P(0, 0, 4.6);
  const leaf = (dx: number, dy: number, colour: number) => g.poly([tx, ty, tx + dx * 0.5, ty + dy - 8, tx + dx, ty + dy, tx + dx * 0.45, ty + dy * 0.2 + 4]).fill(colour);
  leaf(-34, 4, C.leafDark);
  leaf(34, 4, C.leafDark);
  leaf(-22, -14, C.leafLight);
  leaf(22, -14, C.leafLight);
  leaf(-10, 14, C.leafDark);
  leaf(10, 14, C.leafDark);
  g.ellipse(tx, ty - 4, 7, 9).fill(C.leafLight);
};

const cactus: Recipe = (g) => {
  drawBoxes(g, [
    piece(around(0, 0, 0.2), 0, 0.8, C.pot),
    piece(around(0, 0, 0.14), 0.8, 2.8, C.cactus),
    piece({ x0: -0.34, y0: -0.06, x1: -0.1, y1: 0.06 }, 1.5, 1.75, C.cactus),
    piece({ x0: -0.34, y0: -0.06, x1: -0.22, y1: 0.06 }, 1.75, 2.4, C.cactus),
    piece({ x0: 0.1, y0: -0.06, x1: 0.32, y1: 0.06 }, 1.9, 2.15, C.cactus),
    piece({ x0: 0.2, y0: -0.06, x1: 0.32, y1: 0.06 }, 2.15, 2.7, C.cactus),
  ]);
  const [fx, fy] = P(0, 0, 2.8);
  g.circle(fx, fy - 2, 3.5).fill(C.lava);
};

const bonsai: Recipe = (g, c) => {
  drawBoxes(g, [piece(full(c, 0.22), 0, 0.35, C.stone), piece(around(0, 0, 0.05), 0.35, 1.2, C.woodDark)]);
  const [bx, by] = P(0, 0, 1.4);
  g.ellipse(bx - 8, by + 2, 11, 7).fill(C.leafDark);
  g.ellipse(bx + 8, by, 11, 7).fill(C.leafDark);
  g.ellipse(bx, by - 7, 12, 8).fill(C.leafLight);
  g.ellipse(bx - 3, by - 9, 6, 4).fill(shade(C.leafLight, 1.2));
};

const gravestone: Recipe = (g) => {
  drawBoxes(g, [piece({ x0: -0.34, y0: -0.16, x1: 0.34, y1: 0.16 }, 0, 0.3, C.stoneDark), piece({ x0: -0.26, y0: -0.07, x1: 0.26, y1: 0.07 }, 0.3, 2.6, C.stone)]);
  const [tx, ty] = P(0, 0, 2.6);
  g.ellipse(tx, ty, 17, 5).fill(C.stone);
  // A cross carved into the south face.
  const bar = (x0: number, x1: number, z0: number, z1: number) => fillPoly(g, [P(x0, 0.07, z0), P(x1, 0.07, z0), P(x1, 0.07, z1), P(x0, 0.07, z1)], C.stoneDark);
  bar(-0.03, 0.03, 0.8, 2.1);
  bar(-0.13, 0.13, 1.6, 1.74);
};

const coffin: Recipe = (g, c) => {
  const f = full(c, 0.1);
  const lid = full(c, 0.18);
  const stripe = shrinkLong(full(c, 0.4), 0.25);
  drawBoxes(g, [piece(f, 0, 1.4, C.woodDark), piece(lid, 1.4, 1.7, C.wood), piece(stripe, 1.7, 1.75, C.brass)]);
};

const cauldron: Recipe = (g) => {
  disc(g, 0, 0, 0, 26, 13, PALETTE.shadow, 0.35);
  drawBoxes(g, [piece(around(0, 0, 0.3), 0.2, 1.5, C.stoneDark)]);
  disc(g, 0, 0, 1.55, 25, 13, C.metal);
  disc(g, 0, 0, 1.5, 20, 10, C.potion);
  disc(g, -0.1, 0, 1.52, 6, 3, shade(C.potion, 1.3));
  const [bx, by] = P(0.12, 0.05, 1.7);
  g.circle(bx, by, 2.5).fill({ color: shade(C.potion, 1.4), alpha: 0.9 });
  g.circle(bx - 12, by - 6, 1.8).fill({ color: shade(C.potion, 1.4), alpha: 0.7 });
  disc(g, 0, 0, 2.0, 30, 18, C.potion, 0.1);
};

const skeleton: Recipe = (g) => {
  drawBoxes(g, [
    piece(around(0, 0, 0.26), 0, 0.2, C.stoneDark),
    piece({ x0: -0.14, y0: -0.04, x1: -0.06, y1: 0.04 }, 0.2, 1.7, C.bone),
    piece({ x0: 0.06, y0: -0.04, x1: 0.14, y1: 0.04 }, 0.2, 1.7, C.bone),
    piece(around(0, 0, 0.035), 1.7, 3.5, C.bone),
    piece({ x0: -0.17, y0: -0.04, x1: 0.17, y1: 0.04 }, 2.2, 2.3, C.bone),
    piece({ x0: -0.2, y0: -0.04, x1: 0.2, y1: 0.04 }, 2.6, 2.7, C.bone),
    piece({ x0: -0.23, y0: -0.04, x1: 0.23, y1: 0.04 }, 3.0, 3.1, C.bone),
  ]);
  const [sx, sy] = P(0, 0, 3.5);
  g.circle(sx, sy - 7, 7.5).fill(shade(C.bone, 1.1));
  g.rect(sx - 4, sy - 2, 8, 4).fill(shade(C.bone, 0.9));
  g.circle(sx - 2.8, sy - 8, 1.8).fill(C.ink);
  g.circle(sx + 2.8, sy - 8, 1.8).fill(C.ink);
};

/** A flat rug with a border and a rune circle. Walkable: avatars stand on it. */
const runeRug: Recipe = (g, c) => {
  const f = full(c, 0.06);
  const quad = (r: Rect): Pt[] => [P(r.x0, r.y0, 0.05), P(r.x1, r.y0, 0.05), P(r.x1, r.y1, 0.05), P(r.x0, r.y1, 0.05)];
  fillPoly(g, quad(f), C.cloth);
  fillPoly(g, quad(full(c, 0.2)), C.ink);
  strokePoly(g, quad(full(c, 0.2)), C.rune, 1);
  const m = centreOf(f);
  const [sx, sy] = P(m.x, m.y, 0.05);
  g.ellipse(sx, sy, 30, 15).stroke({ color: C.rune, width: 2, alpha: 0.9 });
  g.ellipse(sx, sy, 14, 7).stroke({ color: C.rune, width: 1, alpha: 0.8 });
  g.poly([sx, sy - 7, sx + 5, sy, sx, sy + 7, sx - 5, sy]).fill({ color: C.rune, alpha: 0.9 });
};

/** A plaque on the wall, drawn only when it faces the camera (south or east). */
function plaque(c: RecipeCtx, depth = 0.1): Rect {
  return backRect(c, depth, 0.04);
}

const wallClock: Recipe = (g, c) => {
  const slab = shrinkLong(plaque(c), 0.12);
  drawBoxes(g, [piece(slab, 1.4, 3.6, C.woodDark)]);
  const face = frontFace(c, slab, 0.1, 0.9, 1.6, 3.4);
  if (face) fillPoly(g, face, C.parchment);
  for (const [u0, u1, z0, z1] of [
    [0.46, 0.54, 2.5, 3.15],
    [0.5, 0.74, 2.46, 2.56],
    [0.44, 0.56, 1.7, 1.8],
    [0.44, 0.56, 3.2, 3.3],
  ] as const) {
    const hand = frontFace(c, slab, u0, u1, z0, z1);
    if (hand) fillPoly(g, hand, C.ink);
  }
};

const moonPoster: Recipe = (g, c) => {
  const slab = plaque(c, 0.08);
  drawBoxes(g, [piece(slab, 1.2, 3.9, C.woodDark)]);
  const paper = frontFace(c, slab, 0.08, 0.92, 1.4, 3.7);
  if (paper) fillPoly(g, paper, C.ink);
  const moon = frontFace(c, slab, 0.3, 0.7, 2.1, 3.2);
  if (moon) fillPoly(g, moon, C.lampGlow);
  for (const [u, z] of [[0.16, 3.3], [0.8, 3.2], [0.2, 1.7], [0.76, 1.8]] as const) {
    const star = frontFace(c, slab, u, u + 0.06, z, z + 0.14);
    if (star) fillPoly(g, star, C.screen);
  }
};

const tallMirror: Recipe = (g, c) => {
  const slab = shrinkLong(plaque(c), 0.1);
  drawBoxes(g, [piece(slab, 0.6, 4.6, C.brass)]);
  const glass = frontFace(c, slab, 0.12, 0.88, 0.9, 4.3);
  if (glass) fillPoly(g, glass, C.glassDark);
  const shine = frontFace(c, slab, 0.2, 0.34, 2.6, 4.0);
  if (shine) fillPoly(g, shine, C.glass, 0.55);
};

const banner: Recipe = (g, c) => {
  const slab = shrinkLong(plaque(c, 0.08), 0.14);
  drawBoxes(g, [piece(plaque(c, 0.1), 4.7, 4.9, C.brass), piece(slab, 1.4, 4.7, C.velvet)]);
  const emblem = frontFace(c, slab, 0.28, 0.72, 2.7, 3.7);
  if (emblem) fillPoly(g, emblem, C.pumpkin);
  const stripe = frontFace(c, slab, 0.1, 0.9, 1.7, 1.9);
  if (stripe) fillPoly(g, stripe, C.brass);
};

/** The shop counter in the lobby: a wooden counter with a till, a stack of coins and a striped awning. */
const shopCounter: Recipe = (g, c) => {
  const body = full(c, 0.05);
  const top = full(c, 0.02);
  const back = backRect(c, 0.5, 0.05);
  const [a, b] = endsOf(back, 0.1);
  const [s0, s1] = endsOf(shrinkLong(back, 0), 0.5);
  const till = alongOf(top, 0.22);
  const coins = alongOf(top, 0.72);
  drawBoxes(g, [
    piece(body, 0, 1.5, C.wood),
    piece(top, 1.5, 1.7, C.woodDark),
    piece(around(till.x, till.y, 0.16), 1.7, 2.0, C.metal),
    piece(around(coins.x, coins.y, 0.1), 1.7, 2.0, C.brass),
    piece(around(coins.x, coins.y, 0.1), 2.0, 2.05, C.pumpkin),
    piece(a, 1.7, 2.3, C.woodDark),
    piece(b, 1.7, 2.3, C.woodDark),
    piece(s0, 2.3, 2.45, C.pumpkin),
    piece(s1, 2.3, 2.45, C.web),
  ]);
};

export const RECIPES: Readonly<Record<string, Recipe>> = {
  computer_desk: desk(C.deskArchitect),
  agent_desk: desk(C.wood),
  mailbox,
  board,
  reception_desk: receptionDesk,
  elevator,
  directory_board: directoryBoard,
  construction_board: constructionBoard,
  review_desk: reviewDesk,
  test_lab: testLab,
  library_shelf: libraryShelf,
  night_board: nightBoard,
  hr_desk: hrDesk,
  door,
  chair,
  plant,
  lamp,
  sofa,
  jack_o_lantern_lamp: jackOLanternLamp,
  cobweb,
  shop_counter: shopCounter,
  armchair,
  bench,
  beanbag,
  throne,
  side_table: sideTable,
  coffee_table: coffeeTable,
  round_table: roundTable,
  potion_bar: potionBar,
  coffee_machine: coffeeMachine,
  candelabra,
  floor_torch: floorTorch,
  lava_lamp: lavaLamp,
  crystal_ball: crystalBall,
  fern,
  palm,
  cactus,
  bonsai,
  gravestone,
  coffin,
  cauldron,
  skeleton,
  rune_rug: runeRug,
  wall_clock: wallClock,
  moon_poster: moonPoster,
  tall_mirror: tallMirror,
  banner,
};
