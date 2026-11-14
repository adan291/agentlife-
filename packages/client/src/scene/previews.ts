import type { Renderer } from "pixi.js";
import type { OutfitPart } from "@agentlife/shared";
import { lookOf } from "./outfit.ts";
import type { OutfitLook } from "./outfit.ts";
import type { RoleKey } from "../palette.ts";
import type { SpriteProvider } from "./textures.ts";

/**
 * Pictures of furniture for the DOM (the shop), made from the room's own sprites: the same recipes, the same colours,
 * facing south. Each picture is read back from the renderer once and kept as a PNG data URL. Returns undefined for a
 * definition that has no drawing or when the picture cannot be read.
 */
export function createFurniPreviews(sprites: SpriteProvider, renderer: Renderer): (defId: string) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (defId) => {
    if (cache.has(defId)) return cache.get(defId);
    let url: string | undefined;
    try {
      const frame = sprites.furni(defId, 4);
      const canvas = frame ? (renderer.extract.canvas(frame.texture) as { toDataURL?: (type?: string) => string }) : undefined;
      url = canvas?.toDataURL?.("image/png");
    } catch {
      url = undefined;
    }
    cache.set(defId, url);
    return url;
  };
}

/**
 * Pictures of whole figures for the DOM (the Look pickers of the HR card and the Profile panel): a figure facing the front
 * in `role`'s tint that wears `look`, drawn by the room's own renderer. Kept per role and look.
 */
export function createLookPreviews(sprites: SpriteProvider, renderer: Renderer): (role: RoleKey, look: OutfitLook | undefined) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (role, look) => {
    const key = `${role}:${JSON.stringify(look ?? {})}`;
    if (cache.has(key)) return cache.get(key);
    let url: string | undefined;
    try {
      const frame = sprites.avatar(role, 3, 0, undefined, look);
      const canvas = renderer.extract.canvas(frame.texture) as { toDataURL?: (type?: string) => string };
      url = canvas.toDataURL?.("image/png");
    } catch {
      url = undefined;
    }
    cache.set(key, url);
    return url;
  };
}

/** The role of the ghost that models a part: the pale builder tint, so the colours of the part are what shows. */
export const OUTFIT_PREVIEW_ROLE = "builder";

/**
 * Pictures of outfit parts for the DOM (the Outfits page): a neutral ghost facing the front that wears the part, drawn by
 * the room's own renderer. Kept per part id and palette.
 */
export function createOutfitPreviews(sprites: SpriteProvider, renderer: Renderer): (part: OutfitPart) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (part) => {
    const key = `${part.id}:${Object.values(part.palette).join("")}`;
    if (cache.has(key)) return cache.get(key);
    let url: string | undefined;
    try {
      const frame = sprites.avatar(OUTFIT_PREVIEW_ROLE, 3, 0, undefined, lookOf([part]));
      const canvas = renderer.extract.canvas(frame.texture) as { toDataURL?: (type?: string) => string };
      url = canvas.toDataURL?.("image/png");
    } catch {
      url = undefined;
    }
    cache.set(key, url);
    return url;
  };
}
