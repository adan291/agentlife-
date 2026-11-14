import type { PartCtx, PartRecipe } from "./outfit.ts";

/**
 * The drawings of the outfit parts (ghost-skins). One recipe per part id of `config/outfits.json`, in the hotel's own
 * pixel style: flat shapes, a darker side, one highlight. Every recipe gets the anchors of the ghost (`PartCtx`) and draws
 * from them, never from fixed positions, so the part follows the pose.
 *
 * Palette: `main` is the body of the piece, `shade` its dark side and outlines, `light` highlights or the second colour of
 * a pattern, `accent` small details. Rules (design.md): a hat stays above `hy - 1.5` and within 7 px of the dome; a top
 * covers the body from `chest` to `hem`, 1 px inside each edge (a cape goes to the edge); front pieces are drawn only when
 * the face shows; held pieces hang at the figure's right edge.
 */

type Fill = number | { color: number; alpha: number };
const snap = Math.round;

function rect(c: PartCtx, x: number, y: number, w: number, h: number, fill: Fill): void {
  const x1 = snap(x);
  const y1 = snap(y);
  c.g.rect(x1, y1, Math.max(1, snap(x + w) - x1), Math.max(1, snap(y + h) - y1)).fill(fill);
}

function circle(c: PartCtx, x: number, y: number, r: number, fill: Fill): void {
  c.g.circle(snap(x), snap(y), r).fill(fill);
}

function ellipse(c: PartCtx, x: number, y: number, rx: number, ry: number, fill: Fill): void {
  c.g.ellipse(snap(x), snap(y), rx, ry).fill(fill);
}

function poly(c: PartCtx, points: readonly number[], fill: Fill): void {
  c.g.poly(points.map(snap)).fill(fill);
}

function line(c: PartCtx, x1: number, y1: number, x2: number, y2: number, color: number, width = 1): void {
  c.g.moveTo(snap(x1), snap(y1)).lineTo(snap(x2), snap(y2)).stroke({ color, width });
}

const alpha = (color: number, a: number): Fill => ({ color, alpha: a });

// ---- tops: the body from `chest` to `hem`, 1 px inside each edge ----

/** The left edge and width of a top, and the darker right side every body has. */
function bodyBox(c: PartCtx): { x0: number; w: number; h: number } {
  return { x0: c.hx - c.bw + 1, w: 2 * c.bw - 2, h: c.hem - c.chest };
}

/** Fills the body with a colour and gives it the same shaded right side as the ghost's own body. */
function baseTop(c: PartCtx, colour: number, sideColour: number): void {
  const { x0, w, h } = bodyBox(c);
  rect(c, x0, c.chest, w, h, colour);
  rect(c, x0 + w - 3, c.chest, 3, h, sideColour);
}

// ---- hats: above the eyes (lowest pixel `hy - 1.5`) and at most 7 px over the dome ----

const flatCap: PartRecipe = (c) => {
  const { hx, hy, hr } = c;
  const w = hr - 0.5;
  const base = hy - 4;
  // The peak sticks out to the side the ghost looks at, and shows as a strip under the crown from the front.
  if (c.front && c.lean === -1) rect(c, hx - w - 5, base - 0.5, 7, 2, c.c.shade);
  else if (c.front) rect(c, hx - 6, base - 0.5, 12, 2, c.c.shade);
  ellipse(c, hx, hy - 8, w + 1, 4.6, c.c.main);
  rect(c, hx - w, base - 2, 2 * w, 3, c.c.shade);
  // Checks on the crown: two rows of 2 px squares, every other one light.
  for (let i = -3; i <= 3; i++) {
    for (const row of [0, 1]) {
      if ((i + row) % 2 === 0) rect(c, hx + i * 2 - 1, hy - 11.5 + row * 2, 2, 2, c.c.light);
    }
  }
  if (!c.front) circle(c, hx, hy - 12.6, 1.2, c.c.accent);
  else rect(c, hx - 1, hy - 12.6, 2, 1, c.c.accent);
};

const pumpkinHat: PartRecipe = (c) => {
  const { hx, hy } = c;
  ellipse(c, hx, hy - 8, 8.6, 6.2, c.c.main);
  // Ribs and the dark side.
  c.g.ellipse(snap(hx - 3.5), snap(hy - 8), 3.6, 5.8).stroke({ color: c.c.shade, width: 1 });
  c.g.ellipse(snap(hx + 3.5), snap(hy - 8), 3.6, 5.8).stroke({ color: c.c.shade, width: 1 });
  rect(c, hx + 5, hy - 11, 3, 6, alpha(c.c.shade, 0.5));
  rect(c, hx - 1, hy - 17, 3, 4, c.c.accent);
  rect(c, hx + 1, hy - 17, 2, 1, c.c.accent);
  if (c.front) {
    // A lit face: two triangle eyes and a zigzag mouth.
    const x = c.fx;
    poly(c, [x - 5, hy - 7.5, x - 2, hy - 7.5, x - 3.5, hy - 10.5], c.c.light);
    poly(c, [x + 1.5, hy - 7.5, x + 4.5, hy - 7.5, x + 3, hy - 10.5], c.c.light);
    rect(c, x - 3, hy - 4.5, 6, 1, c.c.light);
    rect(c, x - 1, hy - 3.7, 2, 1, c.c.light);
  }
};

const witchHat: PartRecipe = (c) => {
  const { hx, hy } = c;
  ellipse(c, hx, hy - 5, 13, 2.8, c.c.main);
  poly(c, [hx - 6.5, hy - 5.5, hx + 6.5, hy - 5.5, hx + 4, hy - 12, hx + 6.5, hy - 17, hx + 1, hy - 14.5, hx - 3, hy - 11], c.c.main);
  rect(c, hx - 6.5, hy - 8, 13, 2.2, c.c.light);
  if (c.front) rect(c, c.fx - 1.5, hy - 8.4, 3, 3, c.c.accent);
  // The shaded underside of the brim and a fold on the cone.
  rect(c, hx - 12, hy - 3.5, 24, 1, alpha(c.c.shade, 0.9));
  line(c, hx + 3, hy - 9, hx + 2, hy - 14, c.c.shade);
};

const topHat: PartRecipe = (c) => {
  const { hx, hy } = c;
  ellipse(c, hx, hy - 4.8, 10, 2.2, c.c.shade);
  rect(c, hx - 6.5, hy - 16, 13, 11, c.c.main);
  rect(c, hx - 6.5, hy - 9, 13, 2.5, c.c.light);
  rect(c, hx + 3.5, hy - 16, 3, 11, alpha(c.c.shade, 0.8));
  rect(c, hx - 4.5, hy - 15, 1.5, 5, alpha(c.c.light, 0.45));
  if (c.front) rect(c, c.fx - 1.5, hy - 9, 3, 2.5, c.c.accent);
};

const beanie: PartRecipe = (c) => {
  const { hx, hy, hr } = c;
  ellipse(c, hx, hy - 8.5, hr - 0.3, 4.2, c.c.main);
  for (const dx of [-4, 0, 4]) line(c, hx + dx, hy - 12, hx + dx, hy - 7, c.c.light);
  rect(c, hx - hr + 0.7, hy - 6.2, 2 * hr - 1.4, 3.4, c.c.shade);
  rect(c, hx - hr + 0.7, hy - 5.2, 2 * hr - 1.4, 1, alpha(c.c.light, 0.5));
  circle(c, hx, hy - 13.5, 2.6, c.c.accent);
  circle(c, hx - 0.8, hy - 14.2, 1, c.c.light);
};

const catEars: PartRecipe = (c) => {
  const { hx, hy } = c;
  // A thin band over the head and two ears; the nearer ear is the left one when the ghost looks left.
  c.g.moveTo(snap(hx - 9), snap(hy - 5)).quadraticCurveTo(snap(hx), snap(hy - 14), snap(hx + 9), snap(hy - 5)).stroke({ color: c.c.shade, width: 1.5 });
  poly(c, [hx - 10, hy - 4.5, hx - 9.5, hy - 16.5, hx - 1.5, hy - 9.5], c.c.main);
  poly(c, [hx + 10, hy - 4.5, hx + 9.5, hy - 16.5, hx + 1.5, hy - 9.5], c.c.shade);
  if (c.front) {
    poly(c, [hx - 8.5, hy - 6.5, hx - 8.5, hy - 13.5, hx - 4, hy - 9], c.c.light);
    poly(c, [hx + 8.5, hy - 6.5, hx + 8.5, hy - 13.5, hx + 4, hy - 9], alpha(c.c.light, 0.8));
  }
  circle(c, hx + 8, hy - 14, 0.9, c.c.accent);
};

const crown: PartRecipe = (c) => {
  const { hx, hy } = c;
  poly(c, [hx - 7, hy - 5, hx - 7, hy - 14, hx - 3.5, hy - 10.5, hx, hy - 15, hx + 3.5, hy - 10.5, hx + 7, hy - 14, hx + 7, hy - 5], c.c.main);
  rect(c, hx - 7, hy - 7, 14, 2, c.c.shade);
  rect(c, hx + 4, hy - 12, 3, 5, alpha(c.c.shade, 0.5));
  for (const [x, y] of [[-7, -14], [0, -15], [7, -14]] as const) circle(c, hx + x, hy + y, 1, c.c.light);
  if (c.front) {
    circle(c, c.fx, hy - 6, 1.1, c.c.accent);
    circle(c, c.fx - 4, hy - 6, 0.8, c.c.light);
    circle(c, c.fx + 4, hy - 6, 0.8, c.c.light);
  }
};

const halo: PartRecipe = (c) => {
  const { hx, hy } = c;
  c.g.ellipse(snap(hx), snap(hy - 14), 7.5, 2.2).stroke({ color: c.c.main, width: 1.8 });
  c.g.ellipse(snap(hx), snap(hy - 14), 7.5, 2.2).stroke({ color: c.c.shade, width: 0.6, alpha: 0.6 });
  rect(c, hx - 5, hy - 16.2, 3, 1, c.c.light);
  circle(c, hx + 7, hy - 14, 0.8, c.c.accent);
};

// ---- tops ----

const waistcoat: PartRecipe = (c) => {
  const { cx, chest, hem } = c;
  baseTop(c, c.c.main, c.c.shade);
  if (c.front) {
    // The shirt shows in a V, with the edge of the waistcoat along it.
    poly(c, [cx - 3.5, chest, cx + 3.5, chest, cx, chest + 6], c.c.light);
    line(c, cx - 3.5, chest, cx, chest + 6, c.c.shade);
    line(c, cx + 3.5, chest, cx, chest + 6, c.c.shade);
    circle(c, cx, chest + 7.3, 0.9, c.c.accent);
    rect(c, cx + 3.5, chest + 5, 3, 1, c.c.shade);
  } else {
    line(c, c.hx, chest, c.hx, hem, c.c.shade);
    rect(c, c.hx - 2, chest + 5.5, 4, 1.5, c.c.shade);
    rect(c, c.hx - 0.5, chest + 5.5, 1.5, 1.5, c.c.accent);
  }
};

const hoodie: PartRecipe = (c) => {
  const { cx, chest, hem, hx, bw } = c;
  baseTop(c, c.c.main, c.c.shade);
  if (c.front) {
    ellipse(c, hx, chest + 0.5, bw - 2.5, 2.1, c.c.shade);
    line(c, cx - 2.5, chest + 1.5, cx - 2.5, chest + 5.5, c.c.light);
    line(c, cx + 2.5, chest + 1.5, cx + 2.5, chest + 5.5, c.c.light);
    circle(c, cx - 2.5, chest + 6, 0.8, c.c.accent);
    circle(c, cx + 2.5, chest + 6, 0.8, c.c.accent);
    rect(c, cx - 4.5, chest + 6.2, 9, hem - chest - 6.2, alpha(c.c.shade, 0.75));
  } else {
    // The hood lies on the back.
    ellipse(c, hx, chest + 2.5, bw - 3, 3.4, c.c.shade);
    ellipse(c, hx, chest + 2.2, bw - 5, 2, c.c.light);
  }
};

const cape: PartRecipe = (c) => {
  const { hx, bw, chest, hem } = c;
  // The one top that goes out to the edge: a cape hangs from the neck and flares.
  poly(c, [hx - bw + 1, chest - 0.5, hx + bw - 1, chest - 0.5, hx + bw + 1.5, hem + 2, hx - bw - 1.5, hem + 2], c.c.main);
  poly(c, [hx + bw - 4, chest - 0.5, hx + bw - 1, chest - 0.5, hx + bw + 1.5, hem + 2, hx + bw - 2, hem + 2], c.c.shade);
  line(c, hx - 3, chest + 1, hx - 4.5, hem + 1, c.c.shade);
  line(c, hx + 2.5, chest + 1, hx + 3, hem + 1, c.c.shade);
  rect(c, hx - bw - 1.5, hem + 1, 2 * bw + 3, 1, c.c.light);
  ellipse(c, hx, chest - 0.2, bw - 1.5, 1.6, c.c.light);
  if (c.front) {
    circle(c, c.cx, chest + 0.8, 1.6, c.c.accent);
    rect(c, c.cx - 0.5, chest + 2, 1, 2, c.c.accent);
  }
};

const stripedSweater: PartRecipe = (c) => {
  const { x0, w } = bodyBox(c);
  baseTop(c, c.c.main, c.c.shade);
  for (const k of [1.5, 4.5, 7.5]) {
    rect(c, x0, c.chest + k, w - 3, 1.5, c.c.light);
    rect(c, x0 + w - 3, c.chest + k, 3, 1.5, alpha(c.c.light, 0.7));
  }
  ellipse(c, c.hx, c.chest + 0.4, 5.5, 1.6, c.c.shade);
  if (c.front) rect(c, c.cx - 0.5, c.chest + 0.4, 1, 1, c.c.accent);
};

const labCoat: PartRecipe = (c) => {
  const { cx, chest, hem } = c;
  baseTop(c, c.c.main, c.c.shade);
  if (c.front) {
    poly(c, [cx - 4.5, chest, cx - 1, chest, cx - 2, chest + 5, cx - 5.5, chest + 3], c.c.light);
    poly(c, [cx + 4.5, chest, cx + 1, chest, cx + 2, chest + 5, cx + 5.5, chest + 3], c.c.light);
    line(c, cx - 1, chest, cx - 2, chest + 5, c.c.shade);
    line(c, cx + 1, chest, cx + 2, chest + 5, c.c.shade);
    line(c, cx, chest + 5, cx, hem, c.c.shade);
    circle(c, cx + 1.2, chest + 6.2, 0.7, c.c.accent);
    rect(c, cx + 4, chest + 5, 4, 3, c.c.light);
    rect(c, cx + 5, chest + 3.8, 1, 2, c.c.accent);
  } else {
    line(c, c.hx, chest, c.hx, hem, c.c.shade);
    rect(c, c.hx - 3, chest + 1, 6, 1, c.c.shade);
  }
};

const bandages: PartRecipe = (c) => {
  const { x0, w } = bodyBox(c);
  baseTop(c, c.c.main, c.c.shade);
  for (const k of [0, 3, 6]) {
    line(c, x0, c.chest + k + 1, x0 + w, c.chest + k + 3.5, c.c.shade);
    line(c, x0, c.chest + k + 2, x0 + w, c.chest + k + 4.5, c.c.light);
  }
  // A loose end hangs below the hem.
  rect(c, c.hx + c.bw - 5, c.hem, 2, 4, c.c.main);
  rect(c, c.hx + c.bw - 4, c.hem + 1, 1, 3, c.c.shade);
};

const overalls: PartRecipe = (c) => {
  const { x0, w } = bodyBox(c);
  const { cx, chest, hem } = c;
  // The shirt on top and the denim from the middle down.
  baseTop(c, c.c.light, c.c.shade);
  rect(c, x0, chest + 3.5, w - 3, hem - chest - 3.5, c.c.main);
  rect(c, x0 + w - 3, chest + 3.5, 3, hem - chest - 3.5, c.c.shade);
  if (c.front) {
    rect(c, cx - 4.5, chest + 1.5, 9, 3, c.c.main);
    rect(c, cx - 4.5, chest, 2, 2, c.c.main);
    rect(c, cx + 2.5, chest, 2, 2, c.c.main);
    circle(c, cx - 3.5, chest + 3.4, 0.8, c.c.accent);
    circle(c, cx + 3.5, chest + 3.4, 0.8, c.c.accent);
    c.g.rect(snap(cx - 2.5), snap(chest + 5.5), 5, 2).stroke({ color: c.c.shade, width: 0.8 });
  } else {
    line(c, c.hx - 4, chest, c.hx + 4, chest + 4, c.c.main, 2);
    line(c, c.hx + 4, chest, c.hx - 4, chest + 4, c.c.main, 2);
    circle(c, c.hx, chest + 2, 0.9, c.c.accent);
  }
};

// ---- accessories: in front of everything ----

const neckerchief: PartRecipe = (c) => {
  const { cx, chest, hx, bw } = c;
  if (c.front) {
    poly(c, [cx - 6.5, chest - 0.2, cx + 6.5, chest - 0.2, cx, chest + 6.5], c.c.main);
    line(c, cx - 6.5, chest - 0.2, cx, chest + 6.5, c.c.shade);
    line(c, cx + 6.5, chest - 0.2, cx, chest + 6.5, c.c.shade);
    for (const [x, y] of [[-3, 1.2], [3, 1.2], [0, 4]] as const) circle(c, cx + x, chest + y, 0.6, c.c.accent);
    circle(c, cx, chest + 0.4, 1.3, c.c.light);
  } else {
    rect(c, hx - bw + 1.5, chest - 0.2, 2 * bw - 3, 2.4, c.c.main);
    poly(c, [hx - 1, chest + 2, hx + 2, chest + 2, hx + 1, chest + 5.5], c.c.shade);
    circle(c, hx, chest + 1, 1.4, c.c.light);
  }
};

const carnation: PartRecipe = (c) => {
  if (!c.front) return;
  const x = c.cx - c.bw * 0.45;
  const y = c.chest + 3.5;
  line(c, x, y + 1.5, x + 1.5, y + 5, c.c.accent, 1.2);
  ellipse(c, x + 2.5, y + 3.4, 1.7, 0.9, c.c.accent);
  circle(c, x, y, 2.7, c.c.main);
  circle(c, x + 0.4, y + 0.5, 1.3, c.c.shade);
  circle(c, x - 1.2, y - 1, 0.8, c.c.light);
};

const batBowTie: PartRecipe = (c) => {
  if (!c.front) return;
  const { cx, chest } = c;
  const span = Math.min(7.5, c.bw * 0.7);
  // Two wings with scalloped edges and a small knot.
  poly(c, [cx - 1.2, chest + 0.2, cx - span, chest - 0.8, cx - span + 1, chest + 1, cx - span, chest + 2.8, cx - span + 2, chest + 2.6, cx - 1.2, chest + 2.4], c.c.main);
  poly(c, [cx + 1.2, chest + 0.2, cx + span, chest - 0.8, cx + span - 1, chest + 1, cx + span, chest + 2.8, cx + span - 2, chest + 2.6, cx + 1.2, chest + 2.4], c.c.shade);
  rect(c, cx - 1.5, chest, 3, 3, c.c.light);
  rect(c, cx - 0.5, chest + 1, 1, 1, c.c.accent);
};

const candle: PartRecipe = (c) => {
  const x = c.hx + c.bw + 1;
  const y = c.chest;
  circle(c, x, y - 1.5, 4.2, alpha(c.c.accent, 0.22));
  ellipse(c, x, y + 7.6, 3.4, 1.2, c.c.shade);
  rect(c, x - 1.5, y + 1, 3, 6.5, c.c.main);
  rect(c, x + 0.5, y + 1, 1, 6.5, c.c.shade);
  rect(c, x - 1.5, y + 1, 3, 1, c.c.light);
  rect(c, x, y, 1, 1.2, c.c.shade);
  ellipse(c, x, y - 1.6, 1.3, 2, c.c.accent);
  ellipse(c, x, y - 1, 0.6, 1.1, c.c.light);
};

const roundGlasses: PartRecipe = (c) => {
  const { hx, hy, hr } = c;
  if (!c.front) {
    // From behind only the ends of the frame show at the sides of the head.
    rect(c, hx - hr, hy + 0.5, 2, 1.2, c.c.main);
    rect(c, hx + hr - 2, hy + 0.5, 2, 1.2, c.c.main);
    return;
  }
  const two = c.eyes.length === 2;
  const r = two ? Math.min(3.3, (c.eyes[1]! - c.eyes[0]!) / 2 - 0.2) : 3.3;
  for (const ex of c.eyes) {
    circle(c, hx + ex, hy + 1.5, r, alpha(c.c.light, 0.3));
    c.g.circle(snap(hx + ex), snap(hy + 1.5), r).stroke({ color: c.c.main, width: 1.2 });
    rect(c, hx + ex - r + 0.8, hy + 0.2, 1.5, 1, alpha(c.c.accent, 0.9));
  }
  if (two) line(c, hx + c.eyes[0]! + r, hy + 1, hx + c.eyes[1]! - r, hy + 1, c.c.main);
  else line(c, hx + c.eyes[0]! + r, hy + 1, hx + hr - 1, hy + 0.5, c.c.main);
};

const scarf: PartRecipe = (c) => {
  const { hx, bw, chest, cx } = c;
  const x0 = hx - bw - 0.5;
  const w = 2 * bw + 1;
  rect(c, x0, chest, w, 3, c.c.main);
  for (let x = x0 + 1; x < x0 + w - 1; x += 4.5) rect(c, x, chest, 1.8, 3, c.c.light);
  rect(c, x0 + w - 3, chest, 3, 3, alpha(c.c.shade, 0.5));
  // The end hangs down on the side the ghost does not look at.
  const tx = c.front ? cx + c.bw * 0.3 : hx + c.bw * 0.3;
  rect(c, tx, chest + 2, 3.6, 7, c.c.main);
  rect(c, tx, chest + 4, 3.6, 1.3, c.c.light);
  rect(c, tx, chest + 6.8, 3.6, 1.3, c.c.light);
  for (const dx of [0, 1.4, 2.8]) rect(c, tx + dx, chest + 9, 0.8, 1.6, c.c.accent);
};

const lantern: PartRecipe = (c) => {
  const x = c.hx + c.bw + 0.5;
  const y = c.chest;
  c.g.moveTo(snap(x - 2.5), snap(y + 0.5)).quadraticCurveTo(snap(x), snap(y - 4), snap(x + 2.5), snap(y + 0.5)).stroke({ color: c.c.shade, width: 1 });
  circle(c, x, y + 4, 5, alpha(c.c.accent, 0.2));
  rect(c, x - 3, y + 0.5, 6, 7, c.c.main);
  rect(c, x - 2, y + 1.5, 4, 5, alpha(c.c.light, 0.6));
  circle(c, x, y + 4.2, 1.4, c.c.accent);
  rect(c, x - 3.5, y - 0.3, 7, 1.4, c.c.shade);
  rect(c, x - 3.5, y + 7.2, 7, 1.4, c.c.shade);
};

const ribbon: PartRecipe = (c) => {
  const { chest } = c;
  if (!c.front) {
    rect(c, c.hx - c.bw + 1.5, chest, 2 * c.bw - 3, 1.4, c.c.accent);
    return;
  }
  const { cx } = c;
  poly(c, [cx - 3.5, chest, cx - 1, chest, cx + 1.5, chest + 3.5, cx - 0.5, chest + 3.5], c.c.accent);
  poly(c, [cx + 3.5, chest, cx + 1, chest, cx - 1.5, chest + 3.5, cx + 0.5, chest + 3.5], c.c.accent);
  circle(c, cx, chest + 5.4, 2.7, c.c.main);
  circle(c, cx, chest + 5.4, 1.5, c.c.light);
  circle(c, cx + 1, chest + 6.2, 0.9, c.c.shade);
};

/** Every drawing, keyed by the part id of `config/outfits.json`. */
export const PART_RECIPES: Readonly<Record<string, PartRecipe>> = {
  flat_cap: flatCap,
  pumpkin_hat: pumpkinHat,
  witch_hat: witchHat,
  top_hat: topHat,
  beanie,
  cat_ears: catEars,
  crown,
  halo,
  waistcoat,
  hoodie,
  cape,
  striped_sweater: stripedSweater,
  lab_coat: labCoat,
  bandages,
  overalls,
  neckerchief,
  carnation,
  bat_bow_tie: batBowTie,
  candle,
  round_glasses: roundGlasses,
  scarf,
  lantern,
  ribbon,
};
