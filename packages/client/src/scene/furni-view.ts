import { Sprite } from "pixi.js";
import { FURNI_CATALOG, LAYER, depthKey, footprintSize, tileToScreen } from "@agentlife/shared";
import type { FurniDef, PlacedFurni } from "@agentlife/shared";
import type { SpriteProvider } from "./textures.ts";

export class FurniView {
  readonly sprite: Sprite;
  readonly def: FurniDef;

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
    const { w, l } = footprintSize(def, placed.dir);
    this.sprite.zIndex = depthKey({ x: placed.x, y: placed.y, w, l, layer: LAYER.furni });
  }
}
