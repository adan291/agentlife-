import { Container, Graphics } from "pixi.js";

/**
 * The wisp (waiting-fun): a small glowing orb with two eyes and a few trailing sparks, drawn from shapes (no images). It
 * floats and sways while it lasts and blinks in its last second. With reduced motion it does not move, pulse or blink and
 * has no sparks; it only fades in the last second. Catching it plays a ring of sparks that spreads and fades.
 */

/** Fade-in time, and how long before its end the wisp starts to fade and blink. */
export const WISP_FADE_IN_MS = 300;
export const WISP_FADE_OUT_MS = 1000;
/** Length of the catch effect. */
export const CATCH_MS = 600;

const ORB = 0xcfe9ff;
const ORB_CORE = 0xffffff;
const HALO = 0x8fd0ff;
const EYE = 0x1b2340;
const SPARK = 0xfff2a8;

export interface WispFrame {
  /** Offset in px from the resting point (x to the right, y down). */
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  /** Number of trailing sparks drawn (0 to 3). */
  sparks: number;
  /** Eyes closed. */
  blink: boolean;
}

/** The look of a wisp `ageMs` after it appeared, with `ttlMs` to live, or null when it is over. Pure. */
export function wispFrame(ageMs: number, ttlMs: number, reduced: boolean): WispFrame | null {
  if (!(ageMs >= 0) || ageMs >= ttlMs) return null;
  const left = ttlMs - ageMs;
  const out = left < WISP_FADE_OUT_MS ? left / WISP_FADE_OUT_MS : 1;
  if (reduced) return { dx: 0, dy: 0, scale: 1, alpha: out, sparks: 0, blink: false };
  const alpha = Math.min(1, ageMs / WISP_FADE_IN_MS) * out;
  return {
    dx: Math.sin(ageMs / 700) * 6,
    dy: -Math.cos(ageMs / 500) * 5,
    scale: 1 + 0.06 * Math.sin(ageMs / 250),
    alpha,
    sparks: 3,
    blink: left < WISP_FADE_OUT_MS && Math.floor(ageMs / 120) % 2 === 0,
  };
}

export interface CatchFrame {
  radius: number;
  alpha: number;
  /** Sparks on the ring: 0 under reduced motion, where the ring is a still circle. */
  sparks: number;
  /** Turn of the ring in radians. */
  turn: number;
}

/** The catch effect `ageMs` after the click, or null when it is over. Pure. */
export function catchFrame(ageMs: number, reduced: boolean): CatchFrame | null {
  if (!(ageMs >= 0) || ageMs >= CATCH_MS) return null;
  const t = ageMs / CATCH_MS;
  if (reduced) return { radius: 14, alpha: 1 - t, sparks: 0, turn: 0 };
  return { radius: 6 + 22 * t, alpha: 1 - t, sparks: 6, turn: t * 1.2 };
}

/** Height of the orb above the floor tile it floats over, in px. */
export const WISP_LIFT = 34;

/** The drawing of one wisp. `update` returns false once it is over. */
export class WispFx {
  readonly container = new Container();
  private readonly halo = new Graphics();
  private readonly orb = new Graphics();
  private readonly eyes = new Graphics();
  private readonly sparks: Graphics[] = [];
  /** Where the orb is now, in the scene's coordinates (the point the click button follows). */
  x = 0;
  y = 0;

  constructor(
    readonly id: string,
    private readonly since: number,
    private readonly ttlMs: number,
    /** Resting point: the floor tile's centre in the scene. */
    private readonly baseX: number,
    private readonly baseY: number,
  ) {
    this.halo.circle(0, 0, 17).fill({ color: HALO, alpha: 0.28 });
    this.halo.circle(0, 0, 12).fill({ color: HALO, alpha: 0.3 });
    // A little teardrop: round head, a point at the bottom.
    this.orb.circle(0, 0, 8).fill(ORB);
    this.orb.poly([-5, 4, 5, 4, 0, 13]).fill(ORB);
    this.orb.circle(-2, -3, 3).fill({ color: ORB_CORE, alpha: 0.9 });
    this.container.addChild(this.halo, this.orb, this.eyes);
    for (let i = 0; i < 3; i++) {
      const s = new Graphics();
      s.circle(0, 0, 2.2 - i * 0.5).fill(SPARK);
      this.sparks.push(s);
      this.container.addChild(s);
    }
    this.drawEyes(false);
  }

  private drawEyes(blink: boolean): void {
    this.eyes.clear();
    if (blink) {
      this.eyes.rect(-4.5, -1, 3, 1).fill(EYE);
      this.eyes.rect(1.5, -1, 3, 1).fill(EYE);
    } else {
      this.eyes.ellipse(-3, -1, 1.4, 2).fill(EYE);
      this.eyes.ellipse(3, -1, 1.4, 2).fill(EYE);
    }
  }

  /** Puts the wisp where it is at `now`. Returns false once it is over. */
  update(now: number, reduced: boolean): boolean {
    const age = now - this.since;
    const frame = wispFrame(age, this.ttlMs, reduced);
    if (!frame) return false;
    this.x = this.baseX + frame.dx;
    this.y = this.baseY - WISP_LIFT + frame.dy;
    this.container.position.set(this.x, this.y);
    this.container.scale.set(frame.scale);
    this.container.alpha = frame.alpha;
    this.drawEyes(frame.blink);
    this.sparks.forEach((s, i) => {
      s.visible = i < frame.sparks;
      // The sparks hang behind the orb and wobble a little out of step.
      s.position.set(-8 - i * 6, 8 + i * 5 + Math.sin(age / 200 + i) * 2);
      s.alpha = 0.8 - i * 0.2;
    });
    return true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** The ring of sparks that plays where a wisp was caught. */
export class CatchFx {
  readonly container = new Container();
  private readonly sparks: Graphics[] = [];
  private readonly ring = new Graphics();

  constructor(
    private readonly since: number,
    private readonly x: number,
    private readonly y: number,
  ) {
    this.container.addChild(this.ring);
    for (let i = 0; i < 6; i++) {
      const s = new Graphics();
      s.circle(0, 0, 2.4).fill(SPARK);
      this.sparks.push(s);
      this.container.addChild(s);
    }
  }

  /** Returns false once the effect is over. */
  update(now: number, reduced: boolean): boolean {
    const frame = catchFrame(now - this.since, reduced);
    if (!frame) return false;
    this.container.alpha = frame.alpha;
    this.ring.clear().circle(this.x, this.y, frame.radius).stroke({ color: HALO, width: 2 });
    this.sparks.forEach((s, i) => {
      s.visible = i < frame.sparks;
      const a = frame.turn + (i * 2 * Math.PI) / 6;
      s.position.set(this.x + Math.cos(a) * frame.radius, this.y + Math.sin(a) * frame.radius * 0.6);
    });
    return true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
