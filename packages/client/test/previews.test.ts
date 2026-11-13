import { describe, expect, it } from "vitest";
import type { Renderer, Texture } from "pixi.js";
import { createFurniPreviews } from "../src/scene/previews.ts";
import type { SpriteFrame, SpriteProvider } from "../src/scene/textures.ts";

const texture = (name: string) => ({ name }) as unknown as Texture;

function fixture(options: { missing?: string[]; extractFails?: boolean } = {}) {
  const asked: string[] = [];
  let extracted = 0;
  const sprites = {
    furni: (defId: string, dir: number): SpriteFrame | undefined => {
      asked.push(`${defId}:${dir}`);
      return options.missing?.includes(defId) ? undefined : { texture: texture(defId), anchor: { x: 0, y: 0 } };
    },
  } as unknown as SpriteProvider;
  const renderer = {
    extract: {
      canvas: (t: unknown) => {
        extracted++;
        if (options.extractFails) throw new Error("no webgl");
        return { toDataURL: (type?: string) => `data:${type};${(t as { name: string }).name}` };
      },
    },
  } as unknown as Renderer;
  return { preview: createFurniPreviews(sprites, renderer), asked, extracted: () => extracted };
}

describe("furniture previews", () => {
  it("reads the room's own sprite facing south back as a PNG data URL", () => {
    const f = fixture();
    expect(f.preview("armchair")).toBe("data:image/png;armchair");
    expect(f.asked).toEqual(["armchair:4"]);
  });

  it("reads each picture once", () => {
    const f = fixture();
    f.preview("fern");
    f.preview("fern");
    f.preview("cactus");
    expect(f.extracted()).toBe(2);
    expect(f.asked).toEqual(["fern:4", "cactus:4"]);
  });

  it("gives no picture for a piece without a drawing, or when the renderer cannot read it, and does not ask again", () => {
    const missing = fixture({ missing: ["ghost"] });
    expect(missing.preview("ghost")).toBeUndefined();
    expect(missing.preview("ghost")).toBeUndefined();
    expect(missing.asked).toEqual(["ghost:4"]);
    const broken = fixture({ extractFails: true });
    expect(broken.preview("fern")).toBeUndefined();
    expect(broken.preview("fern")).toBeUndefined();
    expect(broken.extracted()).toBe(1);
  });
});
