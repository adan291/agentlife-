import { describe, expect, it } from "vitest";
import { PAGE_LABELS, SHOP_PAGES } from "@agentlife/shared";
import type { CatalogueItem, ShopState } from "@agentlife/shared";
import { PanelState } from "../src/ui/panel-state.ts";
import { cannotBuy, createShopPanel, itemsOnPage, ownedCount, sizeText } from "../src/ui/shop.ts";
import type { ShopView } from "../src/ui/shop.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const item = (id: string, page: CatalogueItem["page"], price: number, name = id): CatalogueItem => ({ id, name, page, price, defId: id });
const ITEMS: CatalogueItem[] = [
  item("armchair", "seating", 30, "Velvet armchair"),
  item("bench", "seating", 24, "Crypt bench"),
  item("coffee_table", "tables", 28, "Coffee table"),
  item("candelabra", "lights", 22, "Candelabra"),
  item("fern", "plants", 14, "Fern"),
  item("gravestone", "spooky", 25, "Gravestone"),
  item("wall_clock", "walls", 20, "Wall clock"),
];
const shopState = (over: Partial<ShopState> = {}): ShopState => ({ balance: 50, items: ITEMS, stock: [], stockMax: 200, ...over });

function harness(deps: Parameters<typeof createShopPanel>[2] = {}) {
  const bought: string[] = [];
  const panel = createShopPanel(fakeDoc(), { buy: (id) => bought.push(id) }, deps);
  let view: ShopView = { shop: shopState(), error: null };
  let body = panel(view, () => draw()).body;
  const draw = () => {
    body = panel(view, () => draw()).body;
  };
  return {
    bought,
    get body() {
      return body;
    },
    set(next: Partial<ShopView>) {
      view = { ...view, ...next };
      draw();
    },
    cards: () => findAll(body, (e) => e.className === "al-shop-item"),
    tab: (page: string) => findAll(body, (e) => e.dataset["page"] === page)[0]!,
    buyButton: (id: string) => findAll(findAll(body, (e) => e.dataset["item"] === id)[0], (e) => e.className === "al-btn" && e.textContent === "Buy")[0]!,
  };
}

describe("shop helpers", () => {
  it("lists the items of a page in catalogue order", () => {
    expect(itemsOnPage(ITEMS, "seating").map((i) => i.id)).toEqual(["armchair", "bench"]);
    expect(itemsOnPage(ITEMS, "walls").map((i) => i.id)).toEqual(["wall_clock"]);
  });

  it("writes the size of the footprint, and says when a piece hangs on a wall", () => {
    expect(sizeText("coffee_table")).toBe("2×1");
    expect(sizeText("round_table")).toBe("2×2");
    expect(sizeText("armchair")).toBe("1×1");
    expect(sizeText("wall_clock")).toBe("1×1, on a wall");
    expect(sizeText("no_such_piece")).toBe("");
  });

  it("says why an item cannot be bought", () => {
    expect(cannotBuy(shopState({ balance: 10 }), ITEMS[0]!)).toBe("You need 20 more Ecto.");
    expect(cannotBuy(shopState({ balance: 30 }), ITEMS[0]!)).toBeUndefined();
    expect(cannotBuy(shopState({ balance: 99, stock: [{ itemId: "fern", count: 200 }] }), ITEMS[0]!)).toBe("Your inventory is full (200 items).");
    expect(ownedCount(shopState({ stock: [{ itemId: "fern", count: 3 }] }), "fern")).toBe(3);
    expect(ownedCount(shopState(), "fern")).toBe(0);
  });
});

describe("the Shop panel", () => {
  it("shows the balance, the stock count and one tab per page", () => {
    const h = harness();
    expect(textOf(h.body)).toContain("You have 50 Ecto. In your inventory: 0 of 200.");
    const tabs = findAll(h.body, (e) => e.getAttribute("role") === "tab");
    expect(tabs.map((t) => t.textContent)).toEqual(SHOP_PAGES.map((p) => PAGE_LABELS[p]));
    expect(findAll(h.body, (e) => e.getAttribute("role") === "tablist")).toHaveLength(1);
  });

  it("opens on the first page, and a tab shows the items of its page only", () => {
    const h = harness();
    expect(h.cards().map((c) => c.dataset["item"])).toEqual(["armchair", "bench"]);
    expect(h.tab("seating").getAttribute("aria-selected")).toBe("true");
    h.tab("spooky").click();
    expect(h.cards().map((c) => c.dataset["item"])).toEqual(["gravestone"]);
    expect(h.tab("spooky").getAttribute("aria-selected")).toBe("true");
    expect(h.tab("seating").getAttribute("aria-selected")).toBe("false");
  });

  it("keeps the open page when the balance changes", () => {
    const h = harness();
    h.tab("plants").click();
    h.set({ shop: shopState({ balance: 80 }) });
    expect(h.cards().map((c) => c.dataset["item"])).toEqual(["fern"]);
    expect(textOf(h.body)).toContain("You have 80 Ecto.");
  });

  it("shows name, size and price of each item", () => {
    const h = harness();
    h.tab("tables").click();
    const text = textOf(h.cards()[0]);
    expect(text).toContain("Coffee table");
    expect(text).toContain("2×1");
    expect(text).toContain("28 Ecto");
  });

  it("sends the item id when Buy is pressed", () => {
    const h = harness();
    h.buyButton("bench").click();
    expect(h.bought).toEqual(["bench"]);
    expect(h.buyButton("bench").getAttribute("aria-label")).toBe("Buy Crypt bench for 24 Ecto");
  });

  it("disables Buy for an item the user cannot pay, with the missing amount as the reason", () => {
    const h = harness();
    h.set({ shop: shopState({ balance: 25 }) });
    expect(h.buyButton("armchair").disabled).toBe(true);
    expect(h.buyButton("armchair").title).toBe("You need 5 more Ecto.");
    h.buyButton("armchair").click();
    expect(h.bought).toEqual([]);
    expect(h.buyButton("bench").disabled).toBe(false);
  });

  it("says how many of an item the user owns", () => {
    const h = harness();
    h.set({ shop: shopState({ stock: [{ itemId: "armchair", count: 2 }] }) });
    expect(textOf(h.cards()[0])).toContain("You own 2");
    expect(textOf(h.cards()[1])).not.toContain("You own");
    expect(textOf(h.body)).toContain("In your inventory: 2 of 200.");
  });

  it("draws the preview of the room's renderer, or says there is none", () => {
    const h = harness({ preview: (defId) => (defId === "armchair" ? "data:image/png;base64,AAAA" : undefined) });
    const imgs = findAll(h.body, (e) => e.getAttribute("src") !== null);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(imgs[0]!.getAttribute("alt")).toBe("");
    expect(textOf(h.cards()[1])).toContain("No picture");
  });

  it("shows a refusal as an alert, above the catalogue", () => {
    const h = harness();
    h.set({ error: "You need 30 Ecto and have 12." });
    const alert = findAll(h.body, (e) => e.getAttribute("role") === "alert");
    expect(alert.map((a) => a.textContent)).toEqual(["You need 30 Ecto and have 12."]);
    expect(h.cards().length).toBe(2);
  });

  it("says the shop is closed with the reason when the server has no catalogue", () => {
    const h = harness();
    h.set({ shop: null, error: "The shop is closed: it needs the real engine." });
    expect(textOf(h.body)).toContain("The shop is closed: it needs the real engine.");
    expect(h.cards()).toEqual([]);
    h.set({ shop: null, error: null });
    expect(textOf(h.body)).toContain("Opening the shop");
  });

  it("is off in the recorded demo", () => {
    const h = harness();
    h.set({ locked: "The shop is off in the recorded demo." });
    expect(textOf(h.body)).toBe("The shop is off in the recorded demo.");
  });
});

describe("panel state of the shop", () => {
  const open = (s: PanelState) => s.apply({ type: "open_panel", panel: "shop" });

  it("stores the shop and re-renders only while the panel is open", () => {
    const s = new PanelState();
    expect(s.apply({ type: "shop", state: shopState() })).toBe(false);
    open(s);
    expect(s.apply({ type: "shop", state: shopState({ balance: 10 }) })).toBe(true);
    expect(s.shop?.balance).toBe(10);
  });

  it("follows the wallet: a grant raises the balance in the open shop", () => {
    const s = new PanelState();
    expect(s.apply({ type: "wallet", balance: 5 })).toBe(false);
    s.apply({ type: "shop", state: shopState({ balance: 50 }) });
    open(s);
    expect(s.apply({ type: "wallet", balance: 50 })).toBe(false);
    expect(s.apply({ type: "wallet", balance: 70, grant: { amount: 20, reason: "branch_delivered" } })).toBe(true);
    expect(s.shop?.balance).toBe(70);
  });

  it("keeps a refusal until the next answer or the next opening", () => {
    const s = new PanelState();
    open(s);
    expect(s.apply({ type: "error", code: "shop_error", message: "You need 30 Ecto and have 12." })).toBe(true);
    expect(s.shopError).toBe("You need 30 Ecto and have 12.");
    s.apply({ type: "shop", state: shopState() });
    expect(s.shopError).toBeNull();
    s.apply({ type: "error", code: "shop_error", message: "x" });
    open(s);
    expect(s.shopError).toBeNull();
  });

  it("does not repaint another panel for a shop error", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "mailbox" });
    expect(s.apply({ type: "error", code: "shop_error", message: "x" })).toBe(false);
  });
});
