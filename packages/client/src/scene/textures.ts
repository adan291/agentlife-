import { Graphics, Rectangle } from "pixi.js";
import type { Renderer, Texture } from "pixi.js";
import { FURNI_CATALOG, footprintSize } from "@agentlife/shared";
import type { AgentState } from "@agentlife/shared";
import type { RoleKey } from "../palette.ts";
import { AVATAR_FRAME, BADGE_FRAME, drawAvatar, drawBadge } from "./figure.ts";
import type { DrawnView } from "./figure.ts";
import { RECIPES } from "./recipes.ts";

export interface SpriteFrame {
  texture: Texture;
  /** Normalised anchor: the sprite is positioned so this point sits on its logical origin. */
  anchor: { x: number; y: number };
}

/**
 * Source of all sprites. The procedural implementation draws everything with PixiJS Graphics;
 * a spritesheet-backed implementation can replace it without touching the views.
 *
 * Furniture frames are anchored on the centre of the footprint's top-left tile. Avatar frames are
 * anchored on the feet. Badge frames are anchored on their centre.
 */
export interface SpriteProvider {
  furni(defId: string, dir: 0 | 2 | 4 | 6): SpriteFrame | undefined;
  avatar(role: RoleKey, view: DrawnView, frame: 0 | 1): SpriteFrame;
  badge(state: AgentState): SpriteFrame;
}

export class ProceduralSprites implements SpriteProvider {
  private readonly renderer: Renderer;
  private readonly cache = new Map<string, SpriteFrame>();

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  furni(defId: string, dir: 0 | 2 | 4 | 6): SpriteFrame | undefined {
    const def = FURNI_CATALOG[defId];
    const recipe = def ? RECIPES[def.draw] : undefined;
    if (!def || !recipe) return undefined;
    return this.cached(`f:${defId}:${dir}`, () => {
      const g = new Graphics();
      const { w, l } = footprintSize(def, dir);
      recipe(g, { w, l, dir, height: def.height });
      return this.bake(g);
    });
  }

  avatar(role: RoleKey, view: DrawnView, frame: 0 | 1): SpriteFrame {
    return this.cached(`a:${role}:${view}:${frame}`, () => {
      const g = new Graphics();
      drawAvatar(g, role, view, frame);
      return this.bakeFixed(g, AVATAR_FRAME);
    });
  }

  badge(state: AgentState): SpriteFrame {
    return this.cached(`b:${state}`, () => {
      const g = new Graphics();
      drawBadge(g, state);
      return this.bakeFixed(g, BADGE_FRAME);
    });
  }

  private cached(key: string, make: () => SpriteFrame): SpriteFrame {
    let f = this.cache.get(key);
    if (!f) {
      f = make();
      this.cache.set(key, f);
    }
    return f;
  }

  /** Bake using the drawing's own bounds (padded by 1 px). */
  private bake(g: Graphics): SpriteFrame {
    const b = g.getLocalBounds();
    const x = Math.floor(b.x) - 1;
    const y = Math.floor(b.y) - 1;
    const w = Math.ceil(b.x + b.width) + 1 - x;
    const h = Math.ceil(b.y + b.height) + 1 - y;
    return this.bakeFixed(g, { x, y, width: w, height: h });
  }

  private bakeFixed(g: Graphics, f: { x: number; y: number; width: number; height: number }): SpriteFrame {
    const texture = this.renderer.generateTexture({
      target: g,
      frame: new Rectangle(f.x, f.y, f.width, f.height),
      resolution: 1,
    });
    texture.source.scaleMode = "nearest";
    g.destroy();
    return { texture, anchor: { x: -f.x / f.width, y: -f.y / f.height } };
  }
}
