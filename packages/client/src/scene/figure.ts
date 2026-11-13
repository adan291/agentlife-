import type { Graphics } from "pixi.js";
import type { AgentState } from "@agentlife/shared";
import { HAIR_COLOURS, PALETTE, ROLE_COLOURS, STATE_COLOURS, glyphColourOn, shade } from "../palette.ts";
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
/**
 * A short animation or posture of a figure (waiting-fun). The user's figure sits, waves, cheers and dances (`sit_wave` and
 * `sit_cheer` do it from a seat); a ghost cheers or looks glum. Every pose is a two-frame loop like the walk cycle, so
 * `frame` is the phase of the animation.
 */
export type AvatarPose = "sit" | "wave" | "cheer" | "dance" | "glum" | "sit_wave" | "sit_cheer";

/** Pixels the sprite of a seated figure is lifted so that it sits on the seat of the piece, not inside it. */
export const SIT_LIFT_PX = 6;

export function drawAvatar(g: Graphics, role: RoleKey, view: DrawnView, frame: 0 | 1, pose?: AvatarPose): void {
  if (role !== "user") {
    drawGhost(g, role, view, frame, pose);
    return;
  }
  drawGuest(g, role, view, frame, pose);
}

/** Pixels a ghost rises on its "up" float frame. */
export const GHOST_BOB_PX = 3;

/**
 * The hotel staff: an original floating ghost (rounded head, wavy hem, two eyes), tinted per role.
 * `frame` 1 is the raised half of the float bob. Directions are the same 5 drawn views as guests;
 * back views have no eyes.
 */
function drawGhost(g: Graphics, role: RoleKey, view: DrawnView, frame: 0 | 1, pose?: AvatarPose): void {
  const spec = VIEWS[view];
  const body = ROLE_COLOURS[role];
  const cheer = pose === "cheer";
  const glum = pose === "glum";
  // A cheering ghost hops high, a glum one sinks a little.
  const lift = cheer ? (frame === 1 ? 8 : 4) : glum ? -2 : frame === 1 ? GHOST_BOB_PX : 0;
  const hx = spec.shift;
  const top = -36 - lift; // centre of the head dome
  const hem = -17 - lift; // where the wavy hem starts

  // Shadow stays on the floor and shrinks slightly while the ghost is raised.
  g.ellipse(0, -1, Math.min(11, 11 - lift / 2), Math.min(5, 5 - lift / 4)).fill({ color: PALETTE.shadow, alpha: Math.max(0.1, 0.35 - lift * 0.03) });

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
    const mid = spec.eyes.reduce((a, b) => a + b, 0) / spec.eyes.length;
    if (cheer) {
      // Happy eyes (a little roof each) and an open mouth.
      for (const ex of spec.eyes) g.moveTo(hx + ex - 2.2, top + 3).lineTo(hx + ex, top - 0.5).lineTo(hx + ex + 2.2, top + 3).stroke({ color: PALETTE.eye, width: 1.6 });
      g.ellipse(hx + mid, top + 7, 2.2, 2.6).fill(PALETTE.eye);
    } else if (glum) {
      // Sunken eyes, a frown and a tear that runs down.
      for (const ex of spec.eyes) g.ellipse(hx + ex, top + 3, 1.6, 2.2).fill(PALETTE.eye);
      g.moveTo(hx + mid - 3, top + 9).lineTo(hx + mid, top + 7).lineTo(hx + mid + 3, top + 9).stroke({ color: PALETTE.eye, width: 1.4 });
      const last = spec.eyes[spec.eyes.length - 1]!;
      g.ellipse(hx + last + 1, top + 7 + (frame === 1 ? 2 : 0), 1, 1.7).fill(0x7ec8ff);
    } else {
      for (const ex of spec.eyes) g.ellipse(hx + ex, top + 1, 1.8, 2.8).fill(PALETTE.eye);
    }
  }
  // A few sparks around a cheering ghost on the high frame (a still frame, as under reduced motion, has none).
  if (cheer && frame === 1) {
    g.circle(hx - half - 1, top - 2, 1.4).fill(0xffd75e);
    g.circle(hx + half + 1, top - 7, 1.4).fill(0xffd75e);
    g.circle(hx + half + 1, top + 6, 1.4).fill(0xffd75e);
  }
}

function drawGuest(g: Graphics, role: RoleKey, view: DrawnView, frame: 0 | 1, pose?: AvatarPose): void {
  const spec = VIEWS[view];
  const body = ROLE_COLOURS[role];
  const hair = HAIR_COLOURS[role];
  const sitting = pose === "sit" || pose === "sit_wave" || pose === "sit_cheer";
  const gesture = pose === "wave" || pose === "sit_wave" ? "wave" : pose === "cheer" || pose === "sit_cheer" ? "cheer" : pose === "dance" ? "dance" : undefined;
  // A gesture or a seat has no walk cycle: `frame` is then the phase of the gesture.
  const step = gesture || sitting ? 0 : frame;
  const phase = gesture ? frame : 0;
  const hop = !sitting && (gesture === "cheer" || gesture === "dance") && phase === 1 ? -3 : 0;
  const sway = gesture === "dance" ? (phase === 1 ? 2 : -2) : 0;
  const drop = sitting ? 8 : 0;
  const bob = (step === 1 ? -1 : 0) + hop + drop;
  const leftUp = gesture === "cheer" || (gesture === "dance" && phase === 0);
  const rightUp = gesture === "cheer" || gesture === "wave" || (gesture === "dance" && phase === 1);

  g.ellipse(0, -1, 11, 5).fill({ color: PALETTE.shadow, alpha: 0.35 });

  // Legs.
  const legColour = shade(body, 0.45);
  const tx = spec.shift + sway - spec.torsoW / 2;
  if (sitting) {
    // Thighs forward, shins down.
    if (spec.side) {
      g.rect(spec.shift - 12, -6, 14, 4).fill(legColour);
      g.rect(spec.shift - 12, -2, 4, 4).fill(shade(legColour, 0.8));
    } else {
      g.rect(tx, -6, spec.torsoW, 4).fill(legColour);
      g.rect(tx + 1, -2, 4, 4).fill(shade(legColour, 0.8));
      g.rect(tx + spec.torsoW - 5, -2, 4, 4).fill(legColour);
    }
  } else if (spec.side) {
    const a = step === 1 ? 4 : 1;
    g.rect(-3 + spec.shift - a, -14 + hop, 4, 14).fill(legColour);
    g.rect(-1 + spec.shift + a, -14 + hop, 4, 14).fill(shade(legColour, 0.8));
  } else if (view === 4 || view === 6) {
    const a = step === 1 ? 3 : 1;
    g.rect(-5 + spec.shift - a, -14 + hop + (step === 1 ? 1 : 0), 4, 14 - (step === 1 ? 1 : 0)).fill(legColour);
    g.rect(1 + spec.shift + a, -14 + hop, 4, 14).fill(shade(legColour, 0.8));
  } else {
    g.rect(-5, -14 + hop + (step === 1 ? 2 : 0), 4, 14 - (step === 1 ? 2 : 0)).fill(legColour);
    g.rect(1, -14 + hop, 4, 14).fill(shade(legColour, 0.8));
  }

  // An arm that is up: the arm and a hand. A waving arm swings its end from side to side.
  const armUp = (x: number, width: number, tone: number, wave: boolean): void => {
    const swing = wave && phase === 1 ? 2 : 0;
    g.rect(x, -29 + bob, width, 5).fill(shade(body, tone));
    g.rect(x + swing, -41 + bob, width, 13).fill(shade(body, tone));
    g.circle(x + swing + width / 2, -42 + bob, 2.4).fill(PALETTE.skin);
  };

  // Arms behind the torso for side views.
  const armSwing = step === 1 ? 2 : 0;
  if (spec.side && !rightUp && !leftUp) g.rect(spec.shift - 2 + armSwing, -29 + bob, 4, 11).fill(shade(body, 0.7));
  else if (spec.side) g.rect(spec.shift - 2, -29 + bob, 4, 11).fill(shade(body, 0.7));

  // Torso.
  g.rect(tx, -30 + bob, spec.torsoW, 17).fill(body);
  g.rect(tx + spec.torsoW - 3, -30 + bob, 3, 17).fill(shade(body, 0.75));
  g.rect(tx, -14 + bob, spec.torsoW, 2).fill(shade(body, 0.55));

  // Arms in front.
  if (!spec.side) {
    if (leftUp) armUp(tx - 3, 3, 0.8, false);
    else g.rect(tx - 3, -29 + bob + armSwing, 3, 11).fill(shade(body, 0.8));
    if (rightUp) armUp(tx + spec.torsoW, 3, 0.65, gesture === "wave");
    else g.rect(tx + spec.torsoW, -29 + bob - armSwing, 3, 11).fill(shade(body, 0.65));
  } else if (leftUp || rightUp) {
    armUp(spec.shift - 2, 4, 0.9, gesture === "wave");
  } else {
    g.rect(spec.shift - 2 - armSwing, -29 + bob, 4, 11).fill(shade(body, 0.9));
  }

  // Head.
  const hx = spec.shift + sway;
  const hy = -39 + bob;
  g.circle(hx, hy, 9.5).fill(hair);
  if (spec.face) {
    const fx = hx + (spec.eyes.length === 1 ? -2 : 0);
    g.ellipse(fx, hy + 2, 7.5, 7).fill(PALETTE.skin);
    for (const ex of spec.eyes) g.rect(hx + ex - 1, hy, 2, 3).fill(PALETTE.eye);
    if (spec.side) g.rect(hx - 10, hy + 2, 2, 2).fill(PALETTE.skin);
    // A gesture comes with a smile; a cheer with an open mouth.
    if (gesture === "cheer") g.ellipse(fx, hy + 5, 2, 1.6).fill(PALETTE.eye);
    else if (gesture) g.rect(fx - 2, hy + 5, 4, 1).fill(PALETTE.eye);
  } else {
    // Back of the head: a lighter tuft so it reads differently from the front.
    g.ellipse(hx, hy - 4, 6, 3).fill(shade(hair, 1.4));
  }
}

/** Draw the 16x16 status icon for an agent state, centred on (0, 0). Each state has its own glyph and colour. */
export function drawBadge(g: Graphics, state: AgentState): void {
  const GLYPH = glyphColourOn(STATE_COLOURS[state]);
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
