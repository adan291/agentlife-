import { FURNI_CATALOG, PAGE_LABELS, SHOP_PAGES, footprintSize } from "@agentlife/shared";
import type { CatalogueItem, ShopPage, ShopState } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import { balanceText } from "./wallet.ts";

/** What the shop panel does: ask the server to sell one item. The server checks everything again. */
export interface ShopActions {
  buy(itemId: string): void;
}

export interface ShopDeps {
  /** A picture of the item drawn by the room's own renderer (a data URL), or undefined when there is none (tests, no renderer). */
  preview?(defId: string): string | undefined;
}

export interface ShopView {
  shop: ShopState | null;
  /** Why the last purchase or the shop itself was refused, in words. */
  error: string | null;
  /** Replay mode: the shop is off, and this is the reason. */
  locked?: string | undefined;
}

/** The items of one page, in catalogue order. */
export function itemsOnPage(items: readonly CatalogueItem[], page: ShopPage): CatalogueItem[] {
  return items.filter((i) => i.page === page);
}

/** "2×1", with "on a wall" for a piece that hangs on one. */
export function sizeText(defId: string): string {
  const def = FURNI_CATALOG[defId];
  if (!def) return "";
  const { w, l } = footprintSize(def, 4);
  return def.mount === "wall" ? `${w}×${l}, on a wall` : `${w}×${l}`;
}

/** What the user owns of an item (not placed). */
export function ownedCount(shop: ShopState, itemId: string): number {
  return shop.stock.find((s) => s.itemId === itemId)?.count ?? 0;
}

/** Why an item cannot be bought now, or undefined when it can. The server repeats these checks. */
export function cannotBuy(shop: ShopState, item: CatalogueItem): string | undefined {
  if (shop.balance < item.price) return `You need ${item.price - shop.balance} more Ecto.`;
  const total = shop.stock.reduce((sum, s) => sum + s.count, 0);
  if (total >= shop.stockMax) return `Your inventory is full (${shop.stockMax} items).`;
  return undefined;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The Shop panel (lobby counter): pages as tabs, each item with a picture, its size, its price and a Buy button. The
 * open page survives re-renders. The panel only asks; the balance, the stock and any refusal come back from the server.
 */
export function createShopPanel(doc: Document, actions: ShopActions, deps: ShopDeps = {}) {
  let page: ShopPage = SHOP_PAGES[0];

  function card(shop: ShopState, item: CatalogueItem): HTMLElement {
    const li = el(doc, "li", "al-shop-item");
    li.dataset["item"] = item.id;
    const pic = el(doc, "div", "al-shop-preview");
    const src = deps.preview?.(item.defId);
    if (src) {
      const img = el(doc, "img");
      img.setAttribute("src", src);
      img.setAttribute("alt", "");
      pic.appendChild(img);
    } else {
      pic.appendChild(el(doc, "span", "al-muted", "No picture"));
    }
    const owned = ownedCount(shop, item.id);
    const facts = el(doc, "p", "al-shop-facts");
    facts.append(el(doc, "strong", undefined, item.name), el(doc, "br"), el(doc, "span", "al-muted", sizeText(item.defId)));
    const price = el(doc, "p", "al-shop-price", balanceText(item.price));
    const why = cannotBuy(shop, item);
    const buy = el(doc, "button", "al-btn", "Buy");
    buy.type = "button";
    buy.setAttribute("aria-label", `Buy ${item.name} for ${balanceText(item.price)}`);
    if (why) {
      buy.disabled = true;
      buy.title = why;
    }
    buy.addEventListener("click", () => actions.buy(item.id));
    li.append(pic, facts, price);
    if (owned > 0) li.appendChild(el(doc, "p", "al-muted", `You own ${owned}`));
    li.appendChild(buy);
    return li;
  }

  return function render(view: ShopView, rerender: () => void): PanelContent {
    const root = el(doc, "div", "al-shop");
    if (view.locked) {
      root.appendChild(el(doc, "p", "al-muted", view.locked));
      return { body: root };
    }
    if (view.error) {
      const err = el(doc, "p", "al-error", view.error);
      err.setAttribute("role", "alert");
      root.appendChild(err);
    }
    const shop = view.shop;
    if (!shop) {
      if (!view.error) root.appendChild(el(doc, "p", "al-muted", "Opening the shop…"));
      return { body: root };
    }
    const total = shop.stock.reduce((sum, s) => sum + s.count, 0);
    root.appendChild(el(doc, "p", "al-shop-head", `You have ${balanceText(shop.balance)}. In your inventory: ${total} of ${shop.stockMax}.`));

    const tabs = el(doc, "div", "al-row al-wrap");
    tabs.setAttribute("role", "tablist");
    for (const p of SHOP_PAGES) {
      const b = el(doc, "button", "al-btn", PAGE_LABELS[p]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(p === page));
      b.dataset["page"] = p;
      if (p === page) b.disabled = true;
      b.addEventListener("click", () => {
        page = p;
        rerender();
      });
      tabs.appendChild(b);
    }
    root.appendChild(tabs);

    const list = el(doc, "ul", "al-shop-list");
    for (const item of itemsOnPage(shop.items, page)) list.appendChild(card(shop, item));
    root.appendChild(list);
    return { body: root };
  };
}
