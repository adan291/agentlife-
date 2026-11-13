import type { Renderer } from "pixi.js";
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
