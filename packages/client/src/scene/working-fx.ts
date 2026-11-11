import { Container, Graphics } from "pixi.js";
import type { AgentState } from "@agentlife/shared";
import { PALETTE } from "../palette.ts";

/**
 * Signs that an agent is busy, drawn from shapes (no external images, no brand marks):
 * thinking: a thought cloud with three pulsing dots; working: a floating candle with a flickering flame;
 * waiting for approval: a bouncing envelope; error: a red exclamation mark; done: a sparkle that plays once.
 */
export type FxKind = "cloud" | "candle" | "envelope" | "alert" | "sparkle";

/** The effect of a state, or null when the state has none. */
export function fxFor(state: AgentState | null): FxKind | null {
  switch (state) {
    case "thinking":
      return "cloud";
    case "working":
      return "candle";
    case "waiting_approval":
      return "envelope";
    case "error":
      return "alert";
    case "done":
      return "sparkle";
    default:
      return null;
  }
}

/** The sparkle of `done` lasts this long and then goes away. */
export const SPARKLE_MS = 1400;

const DOT_PERIOD_MS = 1200;

/** Alpha of dot `i` (0 to 2) of the thought cloud. The dots light up one after another; steady when motion is reduced. */
export function dotAlpha(i: number, now: number, reduced: boolean): number {
  if (reduced) return 0.9;
  const phase = (((now / DOT_PERIOD_MS - i / 3) % 1) + 1) % 1;
  return 0.3 + 0.7 * Math.max(0, Math.sin(phase * Math.PI));
}

/** Vertical scale of the candle flame: a quick, uneven flicker around 1. Exactly 1 when motion is reduced. */
export function flameScale(now: number, reduced: boolean): number {
  if (reduced) return 1;
  return 1 + 0.12 * Math.sin(now / 83) + 0.08 * Math.sin(now / 47 + 1.3) + 0.04 * Math.sin(now / 29 + 0.4);
}

/** How far the candle floats up and down, in px. 0 when motion is reduced. */
export function candleBob(now: number, reduced: boolean): number {
  return reduced ? 0 : Math.sin(now / 420) * 2;
}

/** Height in px (negative: up) of the envelope's bounce. 0 when motion is reduced. */
export function envelopeLift(now: number, reduced: boolean): number {
  if (reduced) return 0;
  const phase = ((now % 900) + 900) % 900 / 900;
  return -Math.abs(Math.sin(phase * Math.PI)) * 5;
}

/** Progress 0 to 1 of the one-time sparkle, or null before it started and after it ended. */
export function sparkleProgress(since: number, now: number): number | null {
  const t = now - since;
  return t < 0 || t >= SPARKLE_MS ? null : t / SPARKLE_MS;
}

/** Where the sign for the state sits, relative to the feet: beside the head, clear of the name tag and the badge. */
export const FX_SLOT = { x: 48, y: -50 } as const;
/** Where the candle floats: beside the body. */
export const CANDLE_SLOT = { x: -30, y: -26 } as const;

const FLAME = 0xffb347;
const FLAME_CORE = 0xfff1b0;
const WAX = 0xf4efff;
const ALERT_RED = 0xd03a4a;
const SPARK = 0xffe27a;

function cloud(): { body: Container; dots: Graphics[] } {
  const body = new Container();
  const g = new Graphics();
  // Little bubbles lead from the head to the cloud.
  g.circle(-30, 8, 2).fill(PALETTE.bubbleBg).stroke({ color: PALETTE.purple, width: 1 });
  g.circle(-23, 3, 3).fill(PALETTE.bubbleBg).stroke({ color: PALETTE.purple, width: 1 });
  // The cloud: three lobes and a flat base.
  for (const [x, y, r] of [[-9, 0, 6], [0, -3, 8], [9, 0, 6]] as const) g.circle(x, y, r).fill(PALETTE.bubbleBg).stroke({ color: PALETTE.purple, width: 1 });
  g.rect(-9, -1, 18, 7).fill(PALETTE.bubbleBg);
  for (const [x, y, r] of [[-9, 0, 6], [0, -3, 8], [9, 0, 6]] as const) g.circle(x, y, r - 1).fill(PALETTE.bubbleBg);
  body.addChild(g);
  const dots = [-7, 0, 7].map((x) => {
    const d = new Graphics().circle(x, 0, 2).fill(PALETTE.purple);
    body.addChild(d);
    return d;
  });
  return { body, dots };
}

function candle(): { body: Container; flame: Container; halo: Graphics } {
  const body = new Container();
  const halo = new Graphics().circle(0, -9, 11).fill({ color: FLAME, alpha: 0.22 });
  const g = new Graphics();
  g.ellipse(0, 7, 6, 2).fill({ color: PALETTE.shadow, alpha: 0.35 });
  g.rect(-3, -4, 6, 11).fill(WAX);
  g.rect(1, -4, 2, 11).fill(0xc9c0e4);
  g.rect(-0.5, -7, 1, 3).fill(0x3a2a2a);
  const flame = new Container();
  flame.position.set(0, -7);
  flame.addChild(new Graphics().ellipse(0, -4, 3, 5).fill(FLAME), new Graphics().ellipse(0, -3, 1.4, 3).fill(FLAME_CORE));
  body.addChild(halo, g, flame);
  return { body, flame, halo };
}

function envelope(): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(-9, -6, 18, 12).fill(WAX).stroke({ color: PALETTE.tagBg, width: 1 });
  g.poly([-9, -6, 0, 1, 9, -6]).fill(0xd9d0f2).stroke({ color: PALETTE.tagBg, width: 1 });
  g.circle(0, 1, 2).fill(PALETTE.pumpkin);
  c.addChild(g);
  return c;
}

function alertSign(): Container {
  const c = new Container();
  const g = new Graphics();
  g.circle(0, 0, 9).fill(ALERT_RED).stroke({ color: PALETTE.tagBg, width: 1.5 });
  g.rect(-1.3, -5.5, 2.6, 7).fill(0xffffff);
  g.rect(-1.3, 3, 2.6, 2.6).fill(0xffffff);
  c.addChild(g);
  return c;
}

function sparkle(): Container {
  const c = new Container();
  const star = (x: number, y: number, r: number) =>
    new Graphics().poly([x, y - r, x + r * 0.25, y - r * 0.25, x + r, y, x + r * 0.25, y + r * 0.25, x, y + r, x - r * 0.25, y + r * 0.25, x - r, y, x - r * 0.25, y - r * 0.25]).fill(SPARK);
  c.addChild(star(0, 0, 9), star(-11, -7, 4), star(10, 8, 3.5));
  return c;
}

/**
 * The sign above one ghost for its state. Call `setState` when the state changes and `update` every frame; the effects
 * hold still (static icons) when `reduced` is true.
 */
export class WorkingFx {
  readonly container = new Container();
  private readonly slot = new Container();
  private readonly cloud = cloud();
  private readonly candle = candle();
  private readonly envelope = envelope();
  private readonly alert = alertSign();
  private readonly sparkle = sparkle();
  private kind: FxKind | null = null;
  private since = 0;

  constructor() {
    this.slot.position.set(FX_SLOT.x, FX_SLOT.y);
    this.slot.addChild(this.cloud.body, this.envelope, this.alert, this.sparkle);
    this.candle.body.position.set(CANDLE_SLOT.x, CANDLE_SLOT.y);
    this.container.addChild(this.slot, this.candle.body);
    this.show(null);
  }

  get current(): FxKind | null {
    return this.kind;
  }

  private show(kind: FxKind | null): void {
    this.cloud.body.visible = kind === "cloud";
    this.candle.body.visible = kind === "candle";
    this.envelope.visible = kind === "envelope";
    this.alert.visible = kind === "alert";
    this.sparkle.visible = kind === "sparkle";
  }

  /** A new state starts its effect; the same state again changes nothing (a status text update must not restart the sparkle). */
  setState(state: AgentState | null, now: number): void {
    const kind = fxFor(state);
    if (kind === this.kind) return;
    this.kind = kind;
    this.since = now;
    this.show(kind);
  }

  update(now: number, reduced: boolean): void {
    switch (this.kind) {
      case "cloud":
        this.cloud.dots.forEach((d, i) => (d.alpha = dotAlpha(i, now, reduced)));
        break;
      case "candle":
        this.candle.flame.scale.set(1, flameScale(now, reduced));
        this.candle.halo.alpha = reduced ? 0.8 : 0.6 + 0.4 * Math.sin(now / 160);
        this.candle.body.y = CANDLE_SLOT.y + candleBob(now, reduced);
        break;
      case "envelope":
        this.envelope.y = envelopeLift(now, reduced);
        break;
      case "alert":
        this.alert.scale.set(reduced ? 1 : 1 + 0.08 * Math.sin(now / 150));
        break;
      case "sparkle": {
        const p = sparkleProgress(this.since, now);
        if (p === null) {
          this.sparkle.visible = false;
          break;
        }
        this.sparkle.visible = true;
        // Reduced motion: the star stays as it is until its time is up.
        this.sparkle.alpha = reduced ? 1 : 1 - p;
        this.sparkle.scale.set(reduced ? 1 : 0.6 + 0.6 * p);
        this.sparkle.rotation = reduced ? 0 : p * 1.2;
        break;
      }
      default:
        break;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
