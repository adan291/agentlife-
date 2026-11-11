import { Container, Graphics } from "pixi.js";
import { footprintSize } from "@agentlife/shared";
import type { FurniDef, PlacedFurni } from "@agentlife/shared";
import { FURNI_COLOURS } from "../palette.ts";
import type { Pt } from "./iso-draw.ts";
import { deskGlowCentre, deskMonitorFace } from "./recipes.ts";
import type { RecipeCtx } from "./recipes.ts";

/** Lines on the screen while the agent works. */
export const MONITOR_LINES = 6;
const SCROLL_MS = 2400;

/** Share (0 to 1) of the screen width that line `k` fills. A fixed pattern, so the text looks like text and does not jump. */
export function lineLength(k: number): number {
  const pattern = [0.9, 0.55, 0.75, 0.4, 0.85, 0.65];
  return pattern[((k % pattern.length) + pattern.length) % pattern.length] ?? 0.7;
}

/** Vertical position (0 top, 1 bottom) of line `k` at time `now`: all lines move down and come back at the top. Fixed when reduced. */
export function linePosition(k: number, now: number, reduced: boolean): number {
  const base = (k + 0.5) / MONITOR_LINES;
  if (reduced) return base;
  const shift = ((now % SCROLL_MS) + SCROLL_MS) % SCROLL_MS / SCROLL_MS / MONITOR_LINES;
  return (base + shift) % 1;
}

/** Glow strength 0.2 to 0.45, steady at 0.35 when motion is reduced. */
export function monitorGlow(now: number, reduced: boolean): number {
  return reduced ? 0.35 : 0.325 + 0.125 * Math.sin(now / 260);
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The live look of an agent's desk monitor while it works: the screen brightens and lines of text scroll down it, and the
 * desk top in front of it glows. Desks that face away from the camera show only the glow. Drawn on top of the desk
 * sprite with the same geometry as the desk recipe.
 */
export class MonitorFx {
  readonly container = new Container();
  private readonly g = new Graphics();
  private readonly face: Pt[] | null;
  private readonly glowAt: Pt;
  private active = false;

  constructor(placed: PlacedFurni, def: FurniDef, origin: { x: number; y: number }, zIndex: number) {
    const { w, l } = footprintSize(def, placed.dir);
    const ctx: RecipeCtx = { w, l, dir: placed.dir, height: def.height };
    this.face = deskMonitorFace(ctx);
    this.glowAt = deskGlowCentre(ctx);
    this.container.position.set(origin.x, origin.y);
    this.container.zIndex = zIndex;
    this.container.addChild(this.g);
    this.container.visible = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.container.visible = active;
    if (!active) this.g.clear();
  }

  update(now: number, reduced: boolean): void {
    if (!this.active) return;
    const g = this.g;
    g.clear();
    const strength = monitorGlow(now, reduced);
    // The desk top in front of the monitor.
    g.ellipse(this.glowAt[0], this.glowAt[1], 24, 11).fill({ color: FURNI_COLOURS.screen, alpha: strength });
    const f = this.face;
    if (!f) return;
    // Screen face: bottom left, bottom right, top right, top left.
    const [bl, br, tr, tl] = f as [Pt, Pt, Pt, Pt];
    g.poly([...bl, ...br, ...tr, ...tl]).fill({ color: 0xd8fff8, alpha: strength });
    for (let k = 0; k < MONITOR_LINES; k++) {
      const t = linePosition(k, now, reduced);
      const left = lerp(tl, bl, t);
      const right = lerp(tr, br, t);
      const end = lerp(left, right, lineLength(k));
      g.moveTo(left[0] + 1, left[1]).lineTo(end[0] - 1, end[1]).stroke({ color: FURNI_COLOURS.screenOff, width: 1.5, alpha: 0.75 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
