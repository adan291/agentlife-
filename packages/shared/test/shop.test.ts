import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CATALOGUE_MIN_ITEMS,
  CatalogueFileSchema,
  FURNI_CATALOG,
  GRANT_REASONS,
  INVENTORY_MAX,
  InventoryFileSchema,
  PAGE_LABELS,
  SHOP_PAGES,
  ServerMsgSchema,
  ClientMsgSchema,
  WalletSchema,
  applyGrant,
  applyPurchase,
  checkCatalogue,
  newWallet,
  stockCount,
  stockList,
} from "../src/index.ts";
import type { CatalogueItem, GrantInput, Stock, Wallet } from "../src/index.ts";

/** The 25 decorative definitions the shop sells (furni-shop task 2). */
const SOLD = [
  "armchair", "bench", "beanbag", "throne",
  "side_table", "coffee_table", "round_table", "potion_bar",
  "candelabra", "floor_torch", "lava_lamp", "crystal_ball",
  "fern", "palm", "cactus", "bonsai",
  "gravestone", "coffin", "cauldron", "skeleton", "rune_rug",
  "wall_clock", "moon_poster", "tall_mirror", "banner",
];
const WALL = ["wall_clock", "moon_poster", "tall_mirror", "banner"];

const item = (id: string, price = 30, defId = id): CatalogueItem => ({ id, name: id, page: "seating", price, defId });
const SOLD_ITEMS = SOLD.map((id) => item(id));
const wallet = (balance: number): Wallet => ({ ...newWallet(0), balance });

describe("furniture definitions of the shop", () => {
  it("has 25 decorative pieces and the shop counter", () => {
    expect(SOLD.length).toBeGreaterThanOrEqual(CATALOGUE_MIN_ITEMS);
    for (const id of SOLD) {
      const def = FURNI_CATALOG[id];
      expect(def, id).toBeDefined();
      expect(def?.interaction, id).toBeUndefined();
      expect(def?.hint, id).toBeUndefined();
      expect(def?.draw, id).toBe(id);
      expect(def?.mount, id).toBe(WALL.includes(id) ? "wall" : undefined);
    }
    expect(FURNI_CATALOG["shop_counter"]).toMatchObject({ interaction: "shop", walkable: false, w: 2, l: 1 });
    expect(FURNI_CATALOG["shop_counter"]?.hint?.length).toBeLessThanOrEqual(80);
  });

  it("only the rug can be walked on", () => {
    expect(SOLD.filter((id) => FURNI_CATALOG[id]?.walkable)).toEqual(["rune_rug"]);
  });
});

describe("checkCatalogue", () => {
  it("accepts 25 decorative items", () => {
    expect(checkCatalogue(SOLD_ITEMS)).toEqual([]);
  });

  it("asks for at least 24 items", () => {
    expect(checkCatalogue(SOLD_ITEMS.slice(0, 23))[0]).toContain("at least 24");
    expect(checkCatalogue(SOLD_ITEMS.slice(0, 24))).toEqual([]);
  });

  it("refuses a duplicate id, an unknown piece and an inherited name", () => {
    expect(checkCatalogue([...SOLD_ITEMS, item("armchair")])).toEqual(["duplicate item id 'armchair'"]);
    expect(checkCatalogue([...SOLD_ITEMS, item("ghost", 5, "no_such_piece")])).toEqual(["item 'ghost' uses the unknown furniture 'no_such_piece'"]);
    expect(checkCatalogue([...SOLD_ITEMS, item("odd", 5, "constructor")])[0]).toContain("unknown furniture");
  });

  it.each(["computer_desk", "mailbox", "board", "review_desk", "test_lab", "library_shelf", "elevator", "agent_desk", "shop_counter", "door"])(
    "does not sell template furniture: %s",
    (defId) => {
      expect(checkCatalogue([...SOLD_ITEMS, item("template", 5, defId)])).toEqual([`item 'template' is template furniture ('${defId}'), which is not for sale`]);
    },
  );

  it("knows every page and gives each a label", () => {
    expect(SHOP_PAGES).toEqual(["seating", "tables", "lights", "plants", "spooky", "walls"]);
    for (const p of SHOP_PAGES) expect(PAGE_LABELS[p].length).toBeGreaterThan(0);
  });

  it("reads the file format", () => {
    expect(CatalogueFileSchema.safeParse({ version: 1, items: SOLD_ITEMS }).success).toBe(true);
    expect(CatalogueFileSchema.safeParse({ version: 1, items: [{ ...item("a"), price: 0 }] }).success).toBe(false);
    expect(CatalogueFileSchema.safeParse({ version: 1, items: [{ ...item("a"), page: "garden" }] }).success).toBe(false);
    expect(CatalogueFileSchema.safeParse({ version: 1, items: [{ ...item("A b") }] }).success).toBe(false);
  });
});

describe("applyPurchase", () => {
  it("takes the price, writes a negative ledger entry and adds one to the stock", () => {
    const r = applyPurchase(wallet(100), {}, item("armchair", 30), 5000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallet.balance).toBe(70);
    expect(r.stock).toEqual({ armchair: 1 });
    expect(r.entry).toEqual({ ts: 5000, amount: -30, reason: "purchase", ref: "armchair" });
    expect(r.wallet.ledger.at(-1)).toEqual(r.entry);
    expect(applyPurchase(r.wallet, r.stock, item("armchair", 30), 5001)).toMatchObject({ ok: true, stock: { armchair: 2 } });
  });

  it("answers the first rule that fails and changes nothing", () => {
    const w = wallet(10);
    expect(applyPurchase(w, {}, undefined, 0)).toEqual({ ok: false, code: "unknown_item", reason: "That item is not in the shop." });
    expect(applyPurchase(w, {}, item("armchair", 30), 0)).toEqual({ ok: false, code: "not_enough_ecto", reason: "You need 30 Ecto and have 10." });
    const full: Stock = { fern: INVENTORY_MAX };
    expect(applyPurchase(wallet(100), full, item("armchair", 30), 0)).toEqual({ ok: false, code: "inventory_full", reason: "Your inventory is full (200 items)." });
    // Not enough Ecto is checked before the inventory.
    expect(applyPurchase(w, full, item("armchair", 30), 0)).toMatchObject({ code: "not_enough_ecto" });
    expect(w.balance).toBe(10);
  });

  it("can spend the last Ecto but not one more", () => {
    expect(applyPurchase(wallet(30), {}, item("armchair", 30), 0)).toMatchObject({ ok: true, wallet: { balance: 0 } });
    expect(applyPurchase(wallet(29), {}, item("armchair", 30), 0)).toMatchObject({ ok: false });
  });

  it("allows the 200th item and refuses the 201st", () => {
    const almost: Stock = { fern: INVENTORY_MAX - 1 };
    const r = applyPurchase(wallet(100), almost, item("armchair", 1), 0);
    expect(r.ok && stockCount(r.stock)).toBe(INVENTORY_MAX);
    expect(r.ok && applyPurchase(r.wallet, r.stock, item("armchair", 1), 0).ok).toBe(false);
  });

  it("is not fooled by an item called like an object property", () => {
    const r = applyPurchase(wallet(100), {}, item("constructor", 5), 0);
    expect(r.ok && r.stock).toEqual({ constructor: 1 });
  });
});

describe("stock and messages", () => {
  it("lists the stock in catalogue order", () => {
    const items = [item("a"), item("b"), item("c")];
    expect(stockList({ c: 2, a: 1, zz: 3 }, items)).toEqual([
      { itemId: "a", count: 1 },
      { itemId: "c", count: 2 },
      { itemId: "zz", count: 3 },
    ]);
  });

  it("checks the inventory file", () => {
    expect(InventoryFileSchema.safeParse({ version: 1, stock: { fern: 2 } }).success).toBe(true);
    expect(InventoryFileSchema.safeParse({ version: 1, stock: { fern: 0 } }).success).toBe(false);
    expect(InventoryFileSchema.safeParse({ version: 1, stock: { fern: 201 } }).success).toBe(false);
    expect(InventoryFileSchema.safeParse({ version: 1, stock: { "Bad Id": 1 } }).success).toBe(false);
    expect(InventoryFileSchema.safeParse({ version: 1, stock: { __proto__x: 1 } }).success).toBe(false);
  });

  it("accepts the two client messages and the shop message", () => {
    expect(ClientMsgSchema.safeParse({ type: "shop_state" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "shop_buy", itemId: "armchair" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "shop_buy", itemId: "../x" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "shop_buy", itemId: "" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "shop_buy", itemId: "armchair", price: 0 }).success).toBe(true);
    const state = { balance: 10, items: SOLD_ITEMS, stock: [{ itemId: "fern", count: 1 }], stockMax: 200 };
    expect(ServerMsgSchema.safeParse({ type: "shop", state }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "shop", state: { ...state, stockMax: 100 } }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "shop_error", message: "You need 30 Ecto and have 10." }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "open_panel", panel: "shop" }).success).toBe(true);
  });
});

describe("property: any sequence of grants and purchases", () => {
  type Op = { kind: "grant"; g: GrantInput } | { kind: "buy"; item: string };
  const prices: Record<string, number> = { a: 5, b: 50, c: 400, d: 1 };
  const catalogue = Object.entries(prices).map(([id, price]) => item(id, price));
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant("grant" as const),
      g: fc.record({
        reason: fc.constantFrom(...GRANT_REASONS),
        ref: fc.constantFrom("t1", "t2", "t3", "t4"),
        amount: fc.integer({ min: 1, max: 600 }),
        ts: fc.integer({ min: 0, max: 100 }),
      }),
    }),
    fc.record({ kind: fc.constant("buy" as const), item: fc.constantFrom("a", "b", "c", "d", "zzz") }),
  );

  const step = (s: { wallet: Wallet; stock: Stock }, op: Op) => {
    if (op.kind === "grant") return { ...s, wallet: applyGrant(s.wallet, op.g).wallet };
    const r = applyPurchase(s.wallet, s.stock, catalogue.find((i) => i.id === op.item), 50);
    return r.ok ? { wallet: r.wallet, stock: r.stock } : s;
  };

  it("never makes the balance negative, never passes the stock cap, and replaying the grants changes no balance", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        let s = { wallet: newWallet(0), stock: {} as Stock };
        for (const op of ops) {
          s = step(s, op);
          expect(s.wallet.balance).toBeGreaterThanOrEqual(0);
          expect(stockCount(s.stock)).toBeLessThanOrEqual(INVENTORY_MAX);
        }
        expect(WalletSchema.safeParse(s.wallet).success).toBe(true);
        // The same events again (a gateway replay): every grant is already counted, so only purchases can move the balance.
        const replayed = ops.filter((o) => o.kind === "grant").reduce((w, o) => (o.kind === "grant" ? applyGrant(w, o.g).wallet : w), s.wallet);
        expect(replayed.balance).toBe(s.wallet.balance);
      }),
    );
  });

  it("spends exactly what the ledger says: balance = grants - purchases while the ledger holds everything", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const s = ops.reduce(step, { wallet: newWallet(0), stock: {} as Stock });
        expect(s.wallet.ledger.reduce((sum, e) => sum + e.amount, 0)).toBe(s.wallet.balance);
        const bought = s.wallet.ledger.filter((e) => e.reason === "purchase").length;
        expect(stockCount(s.stock)).toBe(bought);
      }),
    );
  });
});
