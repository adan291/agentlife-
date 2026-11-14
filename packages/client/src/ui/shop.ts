import { FURNI_CATALOG, OUTFIT_SLOTS, PAGE_LABELS, SHOP_PAGES, SLOT_HEADINGS, footprintSize } from "@agentlife/shared";
import type { CatalogueItem, OutfitPart, OutfitSlot, ShopPage, ShopState, WardrobeState } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import { balanceText } from "./wallet.ts";

/** What the shop panel does: ask the server to sell one item or one outfit part. The server checks everything again. */
export interface ShopActions {
  buy(itemId: string): void;
  buyPart?(partId: string): void;
}

export interface ShopDeps {
  /** A picture of the item drawn by the room's own renderer (a data URL), or undefined when there is none (tests, no renderer). */
  preview?(defId: string): string | undefined;
  /** A picture of an outfit part on a ghost, drawn by the room's own renderer. */
  outfitPreview?(part: OutfitPart): string | undefined;
}

export interface ShopView {
  shop: ShopState | null;
  /** The outfit parts and the wardrobe; null when the hotel has none (the Outfits tab is then not shown). */
  wardrobe?: WardrobeState | null;
  /** Why the last purchase or the shop itself was refused, in words. */
  error: string | null;
  /** Replay mode: the shop is off, and this is the reason. */
  locked?: string | undefined;
}

/** The tab of the outfits, after the furniture pages. */
export const OUTFITS_TAB = "outfits";
type Tab = ShopPage | typeof OUTFITS_TAB;

/** The parts of one slot, in file order. */
export function partsOfSlot(parts: readonly OutfitPart[], slot: OutfitSlot): OutfitPart[] {
  return parts.filter((p) => p.slot === slot);
}

export type PartStatus = { kind: "owned" } | { kind: "badge"; badge: string } | { kind: "buy"; price: number; why?: string };

/** What the user can do with a part: wear it already (owned), earn it, or buy it (with the reason it cannot be bought now). */
export function partStatus(w: WardrobeState, part: OutfitPart): PartStatus {
  if (w.owned.includes(part.id)) return { kind: "owned" };
  if (part.badge !== undefined || part.price === undefined) return { kind: "badge", badge: w.badges.find((b) => b.id === part.badge)?.name ?? part.badge ?? "special" };
  if (w.balance < part.price) return { kind: "buy", price: part.price, why: `You need ${part.price - w.balance} more Ecto.` };
  return { kind: "buy", price: part.price };
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
  let page: Tab = SHOP_PAGES[0];

  function partCard(w: WardrobeState, part: OutfitPart): HTMLElement {
    const li = el(doc, "li", "al-shop-item");
    li.dataset["part"] = part.id;
    const pic = el(doc, "div", "al-shop-preview");
    const src = deps.outfitPreview?.(part);
    if (src) {
      const img = el(doc, "img");
      img.setAttribute("src", src);
      img.setAttribute("alt", "");
      pic.appendChild(img);
    } else {
      pic.appendChild(el(doc, "span", "al-muted", "No picture"));
    }
    li.append(pic, el(doc, "p", "al-shop-facts", part.name));
    const status = partStatus(w, part);
    if (status.kind === "owned") {
      li.appendChild(el(doc, "p", "al-muted", "Owned"));
    } else if (status.kind === "badge") {
      li.appendChild(el(doc, "p", "al-muted", `Locked: earn the ${status.badge} badge`));
    } else {
      li.appendChild(el(doc, "p", "al-shop-price", balanceText(status.price)));
      const buy = el(doc, "button", "al-btn", "Buy");
      buy.type = "button";
      buy.setAttribute("aria-label", `Buy ${part.name} for ${balanceText(status.price)}`);
      if (status.why) {
        buy.disabled = true;
        buy.title = status.why;
      }
      buy.addEventListener("click", () => actions.buyPart?.(part.id));
      li.appendChild(buy);
    }
    return li;
  }

  /** The Outfits tab: the parts in three groups, one per slot. */
  function outfitsPage(w: WardrobeState): HTMLElement {
    const wrap = el(doc, "div", "al-outfits");
    wrap.appendChild(el(doc, "p", "al-muted", `You own ${w.owned.length} of ${w.parts.length} outfit parts. Put them on a ghost at the HR desk.`));
    for (const slot of OUTFIT_SLOTS) {
      const group = partsOfSlot(w.parts, slot);
      if (group.length === 0) continue;
      wrap.appendChild(el(doc, "h3", "al-shop-head", SLOT_HEADINGS[slot]));
      const list = el(doc, "ul", "al-shop-list");
      list.dataset["slot"] = slot;
      for (const part of group) list.appendChild(partCard(w, part));
      wrap.appendChild(list);
    }
    return wrap;
  }

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
    const wardrobe = view.wardrobe ?? null;
    if (page === OUTFITS_TAB && !wardrobe) page = SHOP_PAGES[0];
    const tabList: Tab[] = wardrobe ? [...SHOP_PAGES, OUTFITS_TAB] : [...SHOP_PAGES];
    for (const p of tabList) {
      const b = el(doc, "button", "al-btn", p === OUTFITS_TAB ? "Outfits" : PAGE_LABELS[p]);
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

    if (page === OUTFITS_TAB && wardrobe) {
      root.appendChild(outfitsPage(wardrobe));
      return { body: root };
    }
    const list = el(doc, "ul", "al-shop-list");
    for (const item of itemsOnPage(shop.items, page as ShopPage)) list.appendChild(card(shop, item));
    root.appendChild(list);
    return { body: root };
  };
}
