import { Container, Sprite } from "pixi.js";
import { FURNI_CATALOG, LAYER, depthKey, footprintSize, tileToScreen } from "@agentlife/shared";
import type { FurniDef, PlacedFurni } from "@agentlife/shared";
import { PALETTE } from "../palette.ts";
import { attentionAlpha, attentionLift, glowAlpha } from "./glow.ts";
import type { SpriteProvider } from "./textures.ts";

/** Distance in px of the four tinted copies that make up the outline. */
const OUTLINE_PX = 2;

export class FurniView {
  readonly sprite: Sprite;
  readonly def: FurniDef;
  /** Outline behind the item; only for items with an interaction. */
  readonly glow: Container | null = null;
  /** Resting y of the sprite; the bounce is added to it. */
  private readonly baseY: number;
  private lift = 0;

  constructor(
    readonly placed: PlacedFurni,
    sprites: SpriteProvider,
    floorHeight: number,
  ) {
    const def = FURNI_CATALOG[placed.defId];
    if (!def) throw new Error(`unknown furniture def '${placed.defId}'`);
    this.def = def;
    const frame = sprites.furni(placed.defId, placed.dir);
    if (!frame) throw new Error(`no draw recipe '${def.draw}' for '${placed.defId}'`);
    this.sprite = new Sprite(frame.texture);
    this.sprite.anchor.set(frame.anchor.x, frame.anchor.y);
    const p = tileToScreen({ x: placed.x, y: placed.y, z: floorHeight });
    this.sprite.position.set(p.sx, p.sy);
    this.baseY = p.sy;
    const { w, l } = footprintSize(def, placed.dir);
    this.sprite.zIndex = depthKey({ x: placed.x, y: placed.y, w, l, layer: LAYER.furni });

    if (def.interaction) {
      // Four copies of the sprite shifted by 2 px and tinted with the accent colour: a visible outline.
      const glow = new Container();
      for (const [dx, dy] of [[-OUTLINE_PX, 0], [OUTLINE_PX, 0], [0, -OUTLINE_PX], [0, OUTLINE_PX]] as const) {
        const s = new Sprite(frame.texture);
        s.anchor.set(frame.anchor.x, frame.anchor.y);
        s.position.set(p.sx + dx, p.sy + dy);
        s.tint = PALETTE.teal;
        glow.addChild(s);
      }
      glow.zIndex = this.sprite.zIndex - 0.5;
      this.glow = glow;
    }
  }

  /** Update the outline alpha: soft pulse, stronger when hovered, constant under reduced motion. `attentionSince`: a report arrived at that time, so the item pulses brightly and bounces for a few seconds. */
  update(now: number, hovered: boolean, reduced: boolean, attentionSince: number | null = null): void {
    const alert = attentionAlpha(now, attentionSince, reduced);
    if (this.glow) this.glow.alpha = alert ?? glowAlpha(now, hovered, reduced);
    const lift = attentionLift(now, attentionSince, reduced);
    if (lift !== this.lift) {
      this.lift = lift;
      this.sprite.y = this.baseY + lift;
      if (this.glow) this.glow.y = lift;
    }
  }
}
