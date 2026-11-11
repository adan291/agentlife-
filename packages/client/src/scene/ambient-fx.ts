import { Container, Graphics } from "pixi.js";
import type { PlacedFurni } from "@agentlife/shared";
import { FURNI_COLOURS, PALETTE } from "../palette.ts";
import { P } from "./iso-draw.ts";
import type { Bounds } from "./room-view.ts";

/**
 * Kiroween ambience: candle flicker on the two lamps and a few wisps drifting through the room. Purely decorative;
 * nothing here reads server state. All motion stops (steady glow, no wisps) when the user asks for reduced motion.
 */

/** Glow strength of a flame, 0.55 to 1. `seed` keeps two flames from flickering in step. Steady 0.8 when motion is reduced. */
export function flicker(now: number, seed: number, reduced: boolean): number {
  if (reduced) return 0.8;
  const v = 0.8 + 0.1 * Math.sin(now / 130 + seed) + 0.06 * Math.sin(now / 47 + seed * 2.1) + 0.04 * Math.sin(now / 311 + seed * 0.7);
  return Math.max(0.55, Math.min(1, v));
}

/** Where the halo of a flame sits, relative to the sprite origin of the item (the recipes' glow centres). */
const FLAMES: Readonly<Record<string, { at: () => readonly [number, number]; colour: number; radius: number }>> = {
  lamp: { at: () => P(0, 0, 4.5), colour: FURNI_COLOURS.lampGlow, radius: 30 },
  jack_o_lantern_lamp: { at: () => P(0, 0, 0.9), colour: FURNI_COLOURS.pumpkinFace, radius: 28 },
};

export function isFlameItem(defId: string): boolean {
  return defId in FLAMES;
}

/** The moving halo over a lamp or a jack-o'-lantern. Drawn on top of the item's sprite, which already has a faint baked glow. */
export class FlameFx {
  readonly container = new Container();
  private readonly g = new Graphics();
  private readonly seed: number;
  private readonly flame: { at: () => readonly [number, number]; colour: number; radius: number };

  constructor(placed: PlacedFurni, origin: { x: number; y: number }, zIndex: number) {
    const flame = FLAMES[placed.defId];
    if (!flame) throw new Error(`'${placed.defId}' has no flame`);
    this.flame = flame;
    // A stable seed from the position, so the same item always flickers the same way.
    this.seed = placed.x * 12.9898 + placed.y * 78.233;
    this.container.position.set(origin.x, origin.y);
    this.container.zIndex = zIndex;
    this.container.addChild(this.g);
  }

  update(now: number, reduced: boolean): void {
    const k = flicker(now, this.seed, reduced);
    const [x, y] = this.flame.at();
    const r = this.flame.radius;
    this.g.clear();
    this.g.ellipse(x, y, r * (0.8 + 0.4 * k), r * 0.75 * (0.8 + 0.4 * k)).fill({ color: this.flame.colour, alpha: 0.1 * k });
    this.g.ellipse(x, y, r * 0.5, r * 0.38).fill({ color: this.flame.colour, alpha: 0.16 * k });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

export const MOTE_COUNT = 14;
const MOTE_COLOURS = [PALETTE.teal, PALETTE.purple, PALETTE.pumpkin, PALETTE.lilac] as const;

export interface Mote {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  colour: number;
}

/** Deterministic value in [0, 1) from an index and a channel (no random state: tests and replays see the same wisps). */
function unit(i: number, channel: number): number {
  const s = Math.sin(i * 127.1 + channel * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * State of wisp `i` at time `now`, inside `bounds`. Each wisp rises slowly from the lower part of the room while it
 * sways sideways, fades in, then out, and starts again somewhere else (every 16 to 30 s).
 */
export function moteAt(i: number, now: number, bounds: Bounds): Mote {
  const period = 16_000 + unit(i, 1) * 14_000;
  const t = now + unit(i, 2) * period;
  const cycle = Math.floor(t / period);
  const phase = (t - cycle * period) / period;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const x0 = bounds.minX + (0.1 + 0.8 * unit(i + cycle * 17, 3)) * width;
  const y0 = bounds.minY + (0.55 + 0.4 * unit(i + cycle * 17, 4)) * height;
  const x = x0 + Math.sin(phase * Math.PI * 4 + unit(i, 5) * 6.28) * 10;
  const y = y0 - phase * height * 0.45;
  const fade = Math.sin(phase * Math.PI);
  return {
    x,
    y,
    radius: 1.2 + unit(i, 6) * 1.6,
    alpha: 0.5 * fade * (0.5 + 0.5 * unit(i, 7)),
    colour: MOTE_COLOURS[Math.floor(unit(i, 8) * MOTE_COLOURS.length)] ?? PALETTE.teal,
  };
}

/** A handful of slow wisps above the floor and below the labels. Hidden when motion is reduced. */
export class MoteLayer {
  readonly container = new Container();
  private readonly g = new Graphics();

  constructor(private readonly bounds: Bounds) {
    this.container.addChild(this.g);
  }

  update(now: number, reduced: boolean): void {
    this.container.visible = !reduced;
    if (reduced) return;
    this.g.clear();
    for (let i = 0; i < MOTE_COUNT; i++) {
      const m = moteAt(i, now, this.bounds);
      if (m.alpha < 0.01) continue;
      this.g.circle(m.x, m.y, m.radius * 2.4).fill({ color: m.colour, alpha: m.alpha * 0.25 });
      this.g.circle(m.x, m.y, m.radius).fill({ color: m.colour, alpha: m.alpha });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
