import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FURNI_CATALOG, SHOP_PAGES, footprintTiles, layoutProblem, useTile } from "@agentlife/shared";
import { loadCatalogue } from "../src/economy-store.ts";
import { loadHotelRooms } from "../src/load-room.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-catalogue-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("config/catalogue-furni.json", () => {
  const items = loadCatalogue();

  it("sells at least 24 items, each mapped to a decorative definition with its own drawing", () => {
    expect(items.length).toBeGreaterThanOrEqual(24);
    for (const item of items) {
      const def = FURNI_CATALOG[item.defId];
      expect(def, item.id).toBeDefined();
      expect(def?.interaction, item.id).toBeUndefined();
      expect(def?.draw).toBe(item.defId);
    }
  });

  it("fills every page, with unique ids and a price a first job can almost pay", () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const page of SHOP_PAGES) expect(items.filter((i) => i.page === page).length, page).toBeGreaterThanOrEqual(4);
    for (const item of items) {
      expect(item.price, item.id).toBeGreaterThanOrEqual(10);
      expect(item.price, item.id).toBeLessThanOrEqual(100);
    }
  });

  it("sells wall pieces only on the Walls page, and nothing else there", () => {
    for (const item of items) expect(FURNI_CATALOG[item.defId]?.mount === "wall", item.id).toBe(item.page === "walls");
  });

  it("is checked at load: a duplicate or a template piece stops the shop from opening", () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ version: 1, items: [...items, { id: "mailbox", name: "Mailbox", page: "tables", price: 5, defId: "mailbox" }] }), "utf8");
    expect(() => loadCatalogue(file)).toThrow(/template furniture/);
    writeFileSync(file, JSON.stringify({ version: 1, items: items.slice(0, 5) }), "utf8");
    expect(() => loadCatalogue(file)).toThrow(/at least 24/);
    writeFileSync(file, "{ nope", "utf8");
    expect(() => loadCatalogue(file)).toThrow();
  });
});

describe("the shop counter in the lobby", () => {
  const { lobby, template } = loadHotelRooms();
  const counter = lobby.furni.find((p) => p.defId === "shop_counter")!;

  it("stands in the lobby only, facing south, with a walkable tile in front of it", () => {
    expect(counter).toMatchObject({ itemId: "shop_counter_1", x: 4, y: 4, dir: 4 });
    expect(template.furni.some((p) => p.defId === "shop_counter")).toBe(false);
    expect(useTile(counter)).toEqual({ x: 4, y: 5 });
  });

  it("does not overlap another piece, and everything of the lobby is still reachable from its door", () => {
    expect(layoutProblem(lobby)).toBeUndefined();
    const mine = new Set(footprintTiles(counter, FURNI_CATALOG["shop_counter"]!).map((t) => `${t.x},${t.y}`));
    for (const p of lobby.furni) {
      if (p === counter) continue;
      const def = FURNI_CATALOG[p.defId]!;
      for (const t of footprintTiles(p, def)) expect(mine.has(`${t.x},${t.y}`), p.itemId).toBe(false);
    }
  });
});
