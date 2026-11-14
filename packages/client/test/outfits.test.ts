import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Graphics, Renderer, Texture } from "pixi.js";
import { OUTFIT_SLOTS, OutfitsFileSchema, WardrobeStateSchema } from "@agentlife/shared";
import type { OutfitPart, OutfitSlot, WardrobeState } from "@agentlife/shared";
import { AVATAR_FRAME, drawAvatar } from "../src/scene/figure.ts";
import type { AvatarPose, DrawnView } from "../src/scene/figure.ts";
import { colourNumber, drawLookSlot, hasRecipe, lookKey, lookOf } from "../src/scene/outfit.ts";
import type { PartAnchors } from "../src/scene/outfit.ts";
import { PART_RECIPES } from "../src/scene/outfit-parts.ts";
import { OUTFIT_PREVIEW_ROLE, createOutfitPreviews } from "../src/scene/previews.ts";
import type { SpriteFrame, SpriteProvider } from "../src/scene/textures.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { createShopPanel, partStatus, partsOfSlot } from "../src/ui/shop.ts";
import type { ShopView } from "../src/ui/shop.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const here = dirname(fileURLToPath(import.meta.url));
const shipped = OutfitsFileSchema.parse(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "config", "outfits.json"), "utf8"))).parts;
const VIEWS: DrawnView[] = [3, 4, 5, 6, 7];

/** A Graphics stand-in that records every call as text and every point it is asked to draw. */
function recorder() {
  const points: { x: number; y: number }[] = [];
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  const box = (x: number, y: number, rx: number, ry = rx) => points.push({ x: x - rx, y: y - ry }, { x: x + rx, y: y + ry });
  const style = (s: unknown) => JSON.stringify(s);
  chain["circle"] = (x: number, y: number, r: number) => (calls.push(`circle:${x},${y},${r}`), box(x, y, r), chain);
  chain["ellipse"] = (x: number, y: number, rx: number, ry: number) => (calls.push(`ellipse:${x},${y},${rx},${ry}`), box(x, y, rx, ry), chain);
  chain["rect"] = (x: number, y: number, w: number, h: number) => (calls.push(`rect:${x},${y},${w},${h}`), points.push({ x, y }, { x: x + w, y: y + h }), chain);
  chain["poly"] = (pts: number[]) => {
    calls.push(`poly:${pts.join(",")}`);
    for (let i = 0; i < pts.length; i += 2) points.push({ x: pts[i]!, y: pts[i + 1]! });
    return chain;
  };
  chain["moveTo"] = (x: number, y: number) => (calls.push(`moveTo:${x},${y}`), points.push({ x, y }), chain);
  chain["lineTo"] = (x: number, y: number) => (calls.push(`lineTo:${x},${y}`), points.push({ x, y }), chain);
  chain["quadraticCurveTo"] = (cx: number, cy: number, x: number, y: number) => (calls.push(`quad:${cx},${cy},${x},${y}`), points.push({ x: cx, y: cy }, { x, y }), chain);
  chain["fill"] = (s: unknown) => (calls.push(`fill:${style(s)}`), chain);
  chain["stroke"] = (s: unknown) => (calls.push(`stroke:${style(s)}`), chain);
  return { g: chain as unknown as Graphics, points, calls };
}

/** The poses and frames that move the head: float (0, 3), cheer hop (4, 8) and glum sink (-2). */
const MOVES: { pose?: AvatarPose; frame: 0 | 1; lift: number }[] = [
  { frame: 0, lift: 0 },
  { frame: 1, lift: 3 },
  { pose: "cheer", frame: 0, lift: 4 },
  { pose: "cheer", frame: 1, lift: 8 },
  { pose: "glum", frame: 0, lift: -2 },
];
const HEAD_Y = (lift: number) => -36 - lift;
const HALF: Record<DrawnView, number> = { 3: 11, 4: 10.5, 5: 9.5, 6: 10.5, 7: 11 };
const SHIFT: Record<DrawnView, number> = { 3: 0, 4: -2, 5: -3, 6: -2, 7: 0 };
const dressed = (part: OutfitPart, view: DrawnView, move: (typeof MOVES)[number], role: "builder" | "developer" = "builder") => {
  const r = recorder();
  drawAvatar(r.g, role, view, move.frame, move.pose, lookOf([part]));
  return r;
};
const bare = (view: DrawnView, move: (typeof MOVES)[number], role: "builder" | "developer" = "builder") => {
  const r = recorder();
  drawAvatar(r.g, role, view, move.frame, move.pose);
  return r;
};
/** Calls of a drawing that come from the part: the dressed list minus the bare one, in order. */
function isSubsequence(small: string[], big: string[]): boolean {
  let i = 0;
  for (const call of big) if (small[i] === call) i++;
  return i === small.length;
}
/** The points the part drew: those of the dressed drawing that the bare one does not have (each bare point is used up once). */
function ownPoints(d: { points: { x: number; y: number }[] }, b: { points: { x: number; y: number }[] }): { x: number; y: number }[] {
  const left = new Map<string, number>();
  for (const p of b.points) left.set(`${p.x},${p.y}`, (left.get(`${p.x},${p.y}`) ?? 0) + 1);
  return d.points.filter((p) => {
    const key = `${p.x},${p.y}`;
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    return n === 0;
  });
}
const FRONT_ONLY = new Set(["carnation", "bat_bow_tie"]);

describe("the drawings of the outfit parts", () => {
  it("has a recipe for every shipped part, and no recipe for a part that is not shipped", () => {
    for (const p of shipped) expect(hasRecipe(p.id), p.id).toBe(true);
    for (const id of Object.keys(PART_RECIPES)) expect(shipped.some((p) => p.id === id), id).toBe(true);
    expect(hasRecipe("toString")).toBe(false);
    expect(hasRecipe("no_such_part")).toBe(false);
  });

  it("draws every part in the five views and every motion without an error, inside the frame of the sprite", () => {
    for (const part of shipped) {
      for (const view of VIEWS) {
        for (const move of MOVES) {
          const { points } = dressed(part, view, move);
          for (const p of points) {
            const where = `${part.id} view ${view} lift ${move.lift}`;
            expect(p.x, where).toBeGreaterThanOrEqual(AVATAR_FRAME.x);
            expect(p.x, where).toBeLessThanOrEqual(AVATAR_FRAME.x + AVATAR_FRAME.width);
            expect(p.y, where).toBeGreaterThanOrEqual(AVATAR_FRAME.y);
            expect(p.y, where).toBeLessThanOrEqual(AVATAR_FRAME.y + AVATAR_FRAME.height);
          }
        }
      }
    }
  });

  it("adds drawing in every view, except the front-only pieces seen from behind", () => {
    for (const part of shipped) {
      for (const view of VIEWS) {
        const added = dressed(part, view, MOVES[0]!).calls.length - bare(view, MOVES[0]!).calls.length;
        if (FRONT_ONLY.has(part.id) && (view === 6 || view === 7)) expect(added, `${part.id} ${view}`).toBe(0);
        else expect(added, `${part.id} ${view}`).toBeGreaterThan(0);
      }
    }
  });

  it("only adds: the bare ghost's drawing is inside the dressed one, so the role tint, the face and the pose are untouched", () => {
    for (const part of shipped) {
      for (const view of VIEWS) {
        for (const move of MOVES) {
          for (const role of ["builder", "developer"] as const) {
            const b = bare(view, move, role).calls;
            const d = dressed(part, view, move, role).calls;
            expect(isSubsequence(b, d), `${part.id} ${view} ${move.lift} ${role}`).toBe(true);
          }
        }
      }
    }
  });

  it("puts each part in its place of the depth order: top before the face, hat and accessory after it", () => {
    const eyeIndex = (calls: string[]) => calls.findIndex((c) => c.startsWith("ellipse:") && c.endsWith(",1.8,2.8"));
    const view: DrawnView = 3;
    const base = bare(view, MOVES[0]!).calls;
    const eyes = eyeIndex(base);
    expect(eyes).toBeGreaterThan(0);
    for (const part of shipped) {
      const calls = dressed(part, view, MOVES[0]!).calls;
      const start = calls.findIndex((c, i) => c !== base[i]);
      const faceAt = eyeIndex(calls);
      if (part.slot === "top") expect(start, part.id).toBeLessThan(faceAt);
      else expect(start, part.id).toBeGreaterThan(faceAt - 1);
      // The part's own calls end before the sparks of a cheer, which are drawn last.
      expect(calls.length).toBeGreaterThan(base.length);
    }
  });

  it("keeps a hat above the eyes and within reach of the head", () => {
    for (const part of shipped.filter((p) => p.slot === "hat")) {
      for (const view of VIEWS) {
        for (const move of MOVES) {
          const hy = HEAD_Y(move.lift);
          const own = ownPoints(dressed(part, view, move), bare(view, move));
          expect(own.length, part.id).toBeGreaterThan(0);
          for (const p of own) {
            expect(p.y, `${part.id} ${view} ${move.lift} low`).toBeLessThanOrEqual(hy - 1.5 + 1e-9);
            expect(p.y, `${part.id} ${view} ${move.lift} high`).toBeGreaterThanOrEqual(hy - 17.5 - 1e-9);
          }
        }
      }
    }
  });

  it("keeps a top on the body, below the face and inside its edges (a cape may flare one pixel out)", () => {
    for (const part of shipped.filter((p) => p.slot === "top")) {
      for (const view of VIEWS) {
        const move = MOVES[0]!;
        const hy = HEAD_Y(move.lift);
        const own = ownPoints(dressed(part, view, move), bare(view, move));
        const out = part.id === "cape" ? 3 : 1;
        for (const p of own) {
          expect(p.x, `${part.id} ${view} left`).toBeGreaterThanOrEqual(SHIFT[view] - HALF[view] - out + 1e-9);
          expect(p.x, `${part.id} ${view} right`).toBeLessThanOrEqual(SHIFT[view] + HALF[view] + out - 1e-9);
          expect(p.y, `${part.id} ${view} up`).toBeGreaterThanOrEqual(hy + 8 - 1e-9);
        }
      }
    }
  });

  it("follows the head: the same part moved by the lift of the pose is the same drawing moved by that much", () => {
    for (const part of shipped) {
      const a = ownPoints(dressed(part, 3, { frame: 0, lift: 0 }), bare(3, { frame: 0, lift: 0 }));
      const b = ownPoints(dressed(part, 3, { frame: 1, lift: 3 }), bare(3, { frame: 1, lift: 3 }));
      expect(b.length, part.id).toBe(a.length);
      a.forEach((p, i) => {
        expect(b[i]!.x, part.id).toBeCloseTo(p.x, 6);
        expect(b[i]!.y, part.id).toBeCloseTo(p.y - 3, 6);
      });
    }
  });

  it("draws a part in no other place than the slot of its look", () => {
    const part = shipped.find((p) => p.slot === "hat")!;
    const look = lookOf([part]);
    const anchors: PartAnchors = { view: 3, hx: 0, hy: -36, hr: 11, bw: 11, chest: -26, hem: -17, eyes: [-3.5, 3.5] };
    const r = recorder();
    drawLookSlot(r.g, look, "top", anchors);
    drawLookSlot(r.g, look, "accessory", anchors);
    drawLookSlot(r.g, undefined, "hat", anchors);
    expect(r.calls).toEqual([]);
    drawLookSlot(r.g, look, "hat", anchors);
    expect(r.calls.length).toBeGreaterThan(0);
  });

  it("skips a part it has no drawing for", () => {
    const r = recorder();
    drawLookSlot(r.g, { hat: { id: "from_a_newer_server", palette: { main: 1, shade: 2, light: 3, accent: 4 } } }, "hat", { view: 3, hx: 0, hy: -36, hr: 11, bw: 11, chest: -26, hem: -17, eyes: [] });
    expect(r.calls).toEqual([]);
  });

  it("uses the palette of the part, not other colours", () => {
    const part = shipped.find((p) => p.id === "flat_cap")!;
    const used = new Set(dressed(part, 3, MOVES[0]!).calls.filter((c) => c.startsWith("fill:")));
    const own = new Set(Object.values(part.palette).map((hex) => `fill:${colourNumber(hex)}`));
    const bareFills = new Set(bare(3, MOVES[0]!).calls.filter((c) => c.startsWith("fill:")));
    for (const c of used) if (!bareFills.has(c)) expect(own.has(c) || c.includes("alpha"), c).toBe(true);
  });
});

describe("the look", () => {
  it("holds one part per slot, the last of a slot wins, and has a key for the cache", () => {
    const [cap, other] = shipped.filter((p) => p.slot === "hat") as [OutfitPart, OutfitPart];
    const vest = shipped.find((p) => p.slot === "top")!;
    const look = lookOf([cap, vest, other]);
    expect(look.hat?.id).toBe(other.id);
    expect(look.top?.id).toBe(vest.id);
    expect(look.accessory).toBeUndefined();
    expect(lookKey(look)).toBe(`${other.id}|${vest.id}|`);
    expect(lookKey(undefined)).toBe("");
    expect(lookKey({})).toBe("");
    expect(lookKey(lookOf([cap]))).not.toBe(lookKey(lookOf([other])));
  });

  it("turns #rrggbb into a number", () => {
    expect(colourNumber("#ff8a1f")).toBe(0xff8a1f);
    expect(lookOf([shipped[0]!]).hat?.palette.main).toBe(colourNumber(shipped[0]!.palette.main));
    expect(OUTFIT_SLOTS).toEqual(["hat", "top", "accessory"]);
  });
});

describe("outfit previews", () => {
  const texture = (name: string) => ({ name }) as unknown as Texture;
  function fixture(extractFails = false) {
    const asked: string[] = [];
    let extracted = 0;
    const sprites = {
      avatar: (role: string, view: number, frame: number, pose: unknown, look: unknown): SpriteFrame => {
        asked.push(`${role}:${view}:${frame}:${String(pose)}:${lookKey(look as never)}`);
        return { texture: texture(lookKey(look as never)), anchor: { x: 0, y: 0 } };
      },
    } as unknown as SpriteProvider;
    const renderer = {
      extract: {
        canvas: (t: unknown) => {
          extracted++;
          if (extractFails) throw new Error("no webgl");
          return { toDataURL: (type?: string) => `data:${type};${(t as { name: string }).name}` };
        },
      },
    } as unknown as Renderer;
    return { preview: createOutfitPreviews(sprites, renderer), asked, extracted: () => extracted };
  }

  it("draws the part on a neutral ghost facing the front and reads it back once", () => {
    const f = fixture();
    const cap = shipped.find((p) => p.id === "flat_cap")!;
    expect(f.preview(cap)).toBe("data:image/png;flat_cap||");
    expect(f.preview(cap)).toBe("data:image/png;flat_cap||");
    expect(f.asked).toEqual([`${OUTFIT_PREVIEW_ROLE}:3:0:undefined:flat_cap||`]);
    expect(f.extracted()).toBe(1);
    expect(OUTFIT_PREVIEW_ROLE).toBe("builder");
  });

  it("gives no picture when the renderer cannot read it, and does not ask again", () => {
    const f = fixture(true);
    const cap = shipped[0]!;
    expect(f.preview(cap)).toBeUndefined();
    expect(f.preview(cap)).toBeUndefined();
    expect(f.extracted()).toBe(1);
  });
});

// ---- the Outfits page ----

const wardrobeOf = (over: Partial<WardrobeState> = {}): WardrobeState => ({
  balance: 50,
  parts: shipped,
  owned: [],
  badges: [{ id: "veteran", name: "Hotel veteran" }],
  ...over,
});

function harness() {
  const items = [{ id: "fern", name: "Fern", page: "plants" as const, price: 14, defId: "fern" }];
  const bought: string[] = [];
  const parts: string[] = [];
  const panel = createShopPanel(fakeDoc(), { buy: (id) => bought.push(id), buyPart: (id) => parts.push(id) }, { outfitPreview: (p) => `data:image/png;${p.id}` });
  let view: ShopView = { shop: { balance: 50, items, stock: [], stockMax: 200 }, wardrobe: wardrobeOf(), error: null };
  let body = panel(view, () => draw()).body;
  const draw = () => {
    body = panel(view, () => draw()).body;
  };
  return {
    bought,
    parts,
    get body() {
      return body;
    },
    set(next: Partial<ShopView>) {
      view = { ...view, ...next };
      draw();
    },
    tab: (page: string) => findAll(body, (e) => e.dataset["page"] === page)[0]!,
    cards: () => findAll(body, (e) => e.dataset["part"] !== undefined),
    card: (id: string) => findAll(body, (e) => e.dataset["part"] === id)[0]!,
    buy: (id: string) => findAll(findAll(body, (e) => e.dataset["part"] === id)[0], (e) => e.className === "al-btn")[0],
  };
}

describe("the Outfits page of the shop", () => {
  it("adds an Outfits tab after the furniture pages only when the hotel has a wardrobe", () => {
    const h = harness();
    expect(h.tab("outfits")).toBeDefined();
    h.set({ wardrobe: null });
    expect(findAll(h.body, (e) => e.dataset["page"] === "outfits")).toEqual([]);
    expect(findAll(h.body, (e) => e.dataset["page"] !== undefined)).toHaveLength(6);
  });

  it("shows every part in three groups with a picture, a name and what to do about it", () => {
    const h = harness();
    h.tab("outfits").click();
    expect(h.cards()).toHaveLength(shipped.length);
    const groups = findAll(h.body, (e) => e.dataset["slot"] !== undefined).map((e) => e.dataset["slot"]);
    expect(groups).toEqual(["hat", "top", "accessory"]);
    expect(textOf(h.body)).toContain("Hats");
    expect(textOf(h.body)).toContain("Tops");
    expect(textOf(h.body)).toContain("Accessories");
    const cap = h.card("flat_cap");
    expect(textOf(cap)).toContain("Checked flat cap");
    expect(textOf(cap)).toContain("40 Ecto");
    expect(findAll(cap, (e) => e.getAttribute?.("src") === "data:image/png;flat_cap")).toHaveLength(1);
  });

  it("sends the part id when Buy is pressed, and only when the user can pay", () => {
    const h = harness();
    h.tab("outfits").click();
    h.buy("flat_cap")!.click();
    expect(h.parts).toEqual(["flat_cap"]);
    expect(h.bought).toEqual([]);
    // 50 Ecto: the waistcoat costs 60.
    const waistcoat = h.buy("waistcoat")!;
    expect(waistcoat.disabled).toBe(true);
    expect(waistcoat.title).toBe("You need 10 more Ecto.");
  });

  it("marks an owned part, and a badge part as locked with the badge to earn, neither with a Buy button", () => {
    const h = harness();
    h.set({ wardrobe: wardrobeOf({ owned: ["flat_cap"] }) });
    h.tab("outfits").click();
    expect(textOf(h.card("flat_cap"))).toContain("Owned");
    expect(h.buy("flat_cap")).toBeUndefined();
    expect(textOf(h.card("crown"))).toContain("Locked: earn the Hotel veteran badge");
    expect(h.buy("crown")).toBeUndefined();
  });

  it("keeps the open tab when it re-renders", () => {
    const h = harness();
    h.tab("outfits").click();
    h.set({ error: "You need 60 Ecto and have 50." });
    expect(h.cards()).toHaveLength(shipped.length);
    expect(textOf(h.body)).toContain("You need 60 Ecto and have 50.");
  });

  it("says what each part is in plain helpers", () => {
    const w = wardrobeOf({ balance: 45, owned: ["rose"] });
    const find = (id: string) => shipped.find((p) => p.id === id)!;
    expect(partStatus(w, find("flat_cap"))).toEqual({ kind: "buy", price: 40 });
    expect(partStatus(w, find("waistcoat"))).toEqual({ kind: "buy", price: 60, why: "You need 15 more Ecto." });
    expect(partStatus(wardrobeOf({ owned: ["flat_cap"] }), find("flat_cap"))).toEqual({ kind: "owned" });
    expect(partStatus(w, find("crown"))).toEqual({ kind: "badge", badge: "Hotel veteran" });
    expect(partsOfSlot(shipped, "top").every((p) => p.slot === "top")).toBe(true);
    for (const slot of OUTFIT_SLOTS as readonly OutfitSlot[]) expect(partsOfSlot(shipped, slot).length).toBeGreaterThan(0);
  });
});

describe("panel state of the wardrobe", () => {
  it("keeps the wardrobe, follows the wallet and re-renders only the open shop", () => {
    const state = new PanelState();
    const w = WardrobeStateSchema.parse(wardrobeOf());
    expect(state.apply({ type: "wardrobe", state: w })).toBe(false);
    expect(state.wardrobe?.balance).toBe(50);
    expect(state.apply({ type: "wallet", balance: 20 })).toBe(false);
    expect(state.wardrobe?.balance).toBe(20);
    state.apply({ type: "open_panel", panel: "shop" });
    expect(state.apply({ type: "wallet", balance: 35 })).toBe(true);
    expect(state.apply({ type: "wallet", balance: 35 })).toBe(false);
    expect(state.apply({ type: "wardrobe", state: { ...w, owned: ["flat_cap"] } })).toBe(true);
    expect(state.apply({ type: "error", code: "shop_error", message: "You already own the Checked flat cap." })).toBe(true);
    expect(state.shopError).toBe("You already own the Checked flat cap.");
  });
});
