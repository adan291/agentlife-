import { Container, Graphics } from "pixi.js";

/**
 * The level-up effect: a ring of eight small stars that rises over a ghost and fades out. Drawn from shapes (no images).
 * With reduced motion the ring does not move: it stays over the head and only fades.
 */
export const LEVEL_UP_MS = 1600;
const STARS = 8;
const GOLD = 0xffd75e;
const GOLD_CORE = 0xfff6c9;

export interface LevelUpFrame {
  /** Height in px above the resting place (positive: up). */
  rise: number;
  /** Radius of the ring in px. */
  radius: number;
  /** Turn of the whole ring in radians. */
  turn: number;
  alpha: number;
}

/** The look of the effect at `t` (0 to 1), or null when it is over. Pure. */
export function levelUpFrame(t: number, reduced: boolean): LevelUpFrame | null {
  if (!(t >= 0) || t >= 1) return null;
  // Fully visible for the first half, then it fades out.
  const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
  if (reduced) return { rise: 0, radius: 18, turn: 0, alpha };
  return { rise: 34 * t, radius: 12 + 10 * t, turn: t * Math.PI, alpha };
}

/** A four-point star as a flat list of x, y pairs around (0, 0). */
export function starPoints(outer: number, inner: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}

export class LevelUpFx {
  readonly container = new Container();
  private readonly stars: Graphics[] = [];
  private readonly since: number;

  constructor(since: number) {
    this.since = since;
    for (let i = 0; i < STARS; i++) {
      const g = new Graphics();
      g.poly(starPoints(4, 1.5)).fill(GOLD);
      g.circle(0, 0, 1).fill(GOLD_CORE);
      this.stars.push(g);
      this.container.addChild(g);
    }
  }

  /** Puts the ring over (x, y) for the moment `now`. Returns false once the effect is over. */
  update(now: number, x: number, y: number, reduced: boolean): boolean {
    const frame = levelUpFrame((now - this.since) / LEVEL_UP_MS, reduced);
    if (!frame) return false;
    this.container.alpha = frame.alpha;
    this.stars.forEach((g, i) => {
      const a = frame.turn + (i * 2 * Math.PI) / STARS;
      g.position.set(x + Math.cos(a) * frame.radius, y - 56 - frame.rise + Math.sin(a) * frame.radius * 0.45);
      g.rotation = a;
    });
    return true;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
