import type { Graphics } from "pixi.js";
import type { AgentState } from "@agentlife/shared";
import { HAIR_COLOURS, PALETTE, ROLE_COLOURS, STATE_COLOURS, shade } from "../palette.ts";
import type { RoleKey } from "../palette.ts";

/**
 * Avatars have 8 logical directions (see shared geometry/dir.ts). Because the camera is rotated
 * 45 degrees, a horizontal screen mirror swaps dx and dy: N<->W (0<->6), E<->S (2<->4), NE<->SW
 * (1<->5); SE (3) and NW (7) mirror onto themselves. So 5 views are drawn (3, 4, 5, 6, 7) and 3
 * are mirrors (0, 1, 2).
 */
export type DrawnView = 3 | 4 | 5 | 6 | 7;

export function viewFor(dir: number): { view: DrawnView; mirror: boolean } {
  switch (((dir % 8) + 8) % 8) {
    case 0:
      return { view: 6, mirror: true };
    case 1:
      return { view: 5, mirror: true };
    case 2:
      return { view: 4, mirror: true };
    case 3:
      return { view: 3, mirror: false };
    case 4:
      return { view: 4, mirror: false };
    case 5:
      return { view: 5, mirror: false };
    case 6:
      return { view: 6, mirror: false };
    default:
      return { view: 7, mirror: false };
  }
}

export const AVATAR_FRAME = { x: -16, y: -56, width: 32, height: 60 } as const;
export const BADGE_FRAME = { x: -8, y: -8, width: 16, height: 16 } as const;

interface ViewSpec {
  /** Horizontal offset of head and torso, towards the side the figure faces (screen-left). */
  shift: number;
  torsoW: number;
  face: boolean;
  /** x offsets of the eyes relative to the head centre. */
  eyes: readonly number[];
  side: boolean;
}

const VIEWS: Record<DrawnView, ViewSpec> = {
  3: { shift: 0, torsoW: 16, face: true, eyes: [-3.5, 3.5], side: false },
  4: { shift: -2, torsoW: 14, face: true, eyes: [-8, -2], side: false },
  5: { shift: -3, torsoW: 10, face: true, eyes: [-7], side: true },
  6: { shift: -2, torsoW: 14, face: false, eyes: [], side: false },
  7: { shift: 0, torsoW: 16, face: false, eyes: [], side: false },
};

/** Draw one avatar frame with the feet at (0, 0). `frame` 0/1 is the walk animation phase (ghosts: float phase). */
export function drawAvatar(g: Graphics, role: RoleKey, view: DrawnView, frame: 0 | 1): void {
  if (role !== "user") {
    drawGhost(g, role, view, frame);
    return;
  }
  drawGuest(g, role, view, frame);
}

/** Pixels a ghost rises on its "up" float frame. */
export const GHOST_BOB_PX = 3;

/**
 * The hotel staff: an original floating ghost (rounded head, wavy hem, two eyes), tinted per role.
 * `frame` 1 is the raised half of the float bob. Directions are the same 5 drawn views as guests;
 * back views have no eyes.
 */
function drawGhost(g: Graphics, role: RoleKey, view: DrawnView, frame: 0 | 1): void {
  const spec = VIEWS[view];
  const body = ROLE_COLOURS[role];
  const lift = frame === 1 ? GHOST_BOB_PX : 0;
  const hx = spec.shift;
  const top = -36 - lift; // centre of the head dome
  const hem = -17 - lift; // where the wavy hem starts

  // Shadow stays on the floor and shrinks slightly while the ghost is raised.
  g.ellipse(0, -1, 11 - lift / 2, 5 - lift / 4).fill({ color: PALETTE.shadow, alpha: 0.35 - lift * 0.03 });

  const half = 7 + spec.torsoW / 4; // 10.5..11
  // Body: dome + column + three scallops.
  g.circle(hx, top, half).fill(body);
  g.rect(hx - half, top, half * 2, hem - top).fill(body);
  const r = half / 3;
  for (const i of [-1, 0, 1]) g.circle(hx + i * 2 * r, hem, r).fill(body);
  // Shaded side and a light sheen so it reads as rounded.
  g.rect(hx + half - 4, top, 4, hem - top).fill(shade(body, 0.78));
  g.circle(hx + 2 * r, hem, r).fill(shade(body, 0.78));
  g.ellipse(hx - half / 2, top - half / 2, 3, 2).fill({ color: 0xffffff, alpha: 0.35 });

  // Eyes (front and side views only).
  if (spec.face) {
    for (const ex of spec.eyes) g.ellipse(hx + ex, top + 1, 1.8, 2.8).fill(PALETTE.eye);
  }
}

function drawGuest(g: Graphics, role: RoleKey, view: DrawnView, frame: 0 | 1): void {
  const spec = VIEWS[view];
  const body = ROLE_COLOURS[role];
  const hair = HAIR_COLOURS[role];
  const step = frame;
  const bob = step === 1 ? -1 : 0;

  g.ellipse(0, -1, 11, 5).fill({ color: PALETTE.shadow, alpha: 0.35 });

  // Legs.
  const legColour = shade(body, 0.45);
  if (spec.side) {
    const a = step === 1 ? 4 : 1;
    g.rect(-3 + spec.shift - a, -14, 4, 14).fill(legColour);
    g.rect(-1 + spec.shift + a, -14, 4, 14).fill(shade(legColour, 0.8));
  } else if (view === 4 || view === 6) {
    const a = step === 1 ? 3 : 1;
    g.rect(-5 + spec.shift - a, -14 + (step === 1 ? 1 : 0), 4, 14 - (step === 1 ? 1 : 0)).fill(legColour);
    g.rect(1 + spec.shift + a, -14, 4, 14).fill(shade(legColour, 0.8));
  } else {
    g.rect(-5, -14 + (step === 1 ? 2 : 0), 4, 14 - (step === 1 ? 2 : 0)).fill(legColour);
    g.rect(1, -14, 4, 14).fill(shade(legColour, 0.8));
  }

  // Arms behind the torso for side views.
  const armSwing = step === 1 ? 2 : 0;
  const tx = spec.shift - spec.torsoW / 2;
  if (spec.side) g.rect(spec.shift - 2 + armSwing, -29 + bob, 4, 11).fill(shade(body, 0.7));

  // Torso.
  g.rect(tx, -30 + bob, spec.torsoW, 17).fill(body);
  g.rect(tx + spec.torsoW - 3, -30 + bob, 3, 17).fill(shade(body, 0.75));
  g.rect(tx, -14 + bob, spec.torsoW, 2).fill(shade(body, 0.55));

  // Arms in front.
  if (!spec.side) {
    g.rect(tx - 3, -29 + bob + armSwing, 3, 11).fill(shade(body, 0.8));
    g.rect(tx + spec.torsoW, -29 + bob - armSwing, 3, 11).fill(shade(body, 0.65));
  } else {
    g.rect(spec.shift - 2 - armSwing, -29 + bob, 4, 11).fill(shade(body, 0.9));
  }

  // Head.
  const hx = spec.shift;
  const hy = -39 + bob;
  g.circle(hx, hy, 9.5).fill(hair);
  if (spec.face) {
    g.ellipse(hx + (spec.eyes.length === 1 ? -2 : 0), hy + 2, 7.5, 7).fill(PALETTE.skin);
    for (const ex of spec.eyes) g.rect(hx + ex - 1, hy, 2, 3).fill(PALETTE.eye);
    if (spec.side) g.rect(hx - 10, hy + 2, 2, 2).fill(PALETTE.skin);
  } else {
    // Back of the head: a lighter tuft so it reads differently from the front.
    g.ellipse(hx, hy - 4, 6, 3).fill(shade(hair, 1.4));
  }
}

const GLYPH = 0xffffff;

/** Draw the 16x16 status icon for an agent state, centred on (0, 0). Each state has its own glyph and colour. */
export function drawBadge(g: Graphics, state: AgentState): void {
  g.circle(0, 0, 7.5).fill(STATE_COLOURS[state]).stroke({ color: PALETTE.tagBg, width: 1 });
  switch (state) {
    case "idle": {
      g.circle(0, 0, 3.5).stroke({ color: GLYPH, width: 1.5 });
      break;
    }
    case "walking": {
      g.poly([-2.5, -4, 4, 0, -2.5, 4]).fill(GLYPH);
      break;
    }
    case "thinking": {
      for (const x of [-4, 0, 4]) g.circle(x, 0, 1.4).fill(GLYPH);
      break;
    }
    case "working": {
      g.circle(0, 0, 3).stroke({ color: GLYPH, width: 2 });
      for (const [x, y] of [[0, -5.5], [0, 5.5], [-5.5, 0], [5.5, 0]] as const) g.rect(x - 1, y - 1, 2, 2).fill(GLYPH);
      break;
    }
    case "waiting_approval": {
      g.poly([-3.5, -4.5, 3.5, -4.5, 0, 0]).fill(GLYPH);
      g.poly([-3.5, 4.5, 3.5, 4.5, 0, 0]).fill(GLYPH);
      break;
    }
    case "blocked": {
      g.rect(-4, -1.2, 8, 2.4).fill(GLYPH);
      break;
    }
    case "done": {
      g.moveTo(-3.5, 0).lineTo(-1, 3).lineTo(4, -3).stroke({ color: GLYPH, width: 2 });
      break;
    }
    case "error": {
      g.rect(-1, -4.5, 2, 5.5).fill(GLYPH);
      g.rect(-1, 2.5, 2, 2).fill(GLYPH);
      break;
    }
  }
}
