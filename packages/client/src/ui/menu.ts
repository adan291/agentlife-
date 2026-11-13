import { nextEnabled } from "./menu-model.ts";
import type { MenuItem, MenuItemId } from "./menu-model.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-menu-wrap { position: relative; }
.al-menu-list { position: absolute; z-index: 30; top: calc(100% + var(--al-s1)); right: 0; min-width: 240px; max-width: calc(100vw - var(--al-s4)); margin: 0; padding: var(--al-s1); box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); }
.al-menu-list[hidden] { display: none; }
.al-menu-item { display: flex; align-items: baseline; justify-content: space-between; gap: var(--al-s4); width: 100%; box-sizing: border-box; text-align: left; border-color: transparent; background: transparent; }
.al-menu-item:focus-visible, .al-menu-item[data-active="true"] { border-color: var(--al-accent); background: ${UI_COLOURS.inputBg}; }
.al-menu-key { color: ${UI_COLOURS.muted}; white-space: nowrap; }
.al-menu-item:disabled .al-menu-key { color: ${UI_COLOURS.muted}; }
.al-menu-sep { height: 1px; margin: var(--al-s1) 0; background: var(--al-border); }
`;

export interface MenuOptions {
  /** The items to list now. Called each time the menu opens. */
  items(): MenuItem[];
  /** The user chose an item. The menu has already closed. */
  choose(id: MenuItemId): void;
}

export interface Menu {
  readonly element: HTMLElement;
  readonly button: HTMLButtonElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * The Menu button and its dropdown (ui-tidy). The model decides the items (`menuItems`); this file only draws them and
 * handles the keyboard: Enter, Space or ArrowDown on the button open it, arrows, Home and End move, Enter or Space choose,
 * Esc closes and gives the focus back, Tab and a click outside close.
 */
export function createMenu(doc: Document, options: MenuOptions): Menu {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const wrap = doc.createElement("div");
  wrap.className = "al-menu-wrap";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "al-btn al-menu-button";
  button.textContent = "Menu ▾";
  button.title = "Commands, zoom, text size and help";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const list = doc.createElement("div");
  list.className = "al-menu-list";
  list.setAttribute("role", "menu");
  list.setAttribute("aria-label", "Menu");
  list.hidden = true;
  wrap.append(button, list);

  let items: MenuItem[] = [];
  let buttons: HTMLButtonElement[] = [];
  let opened = false;

  const focusItem = (at: number): void => {
    if (at < 0) return;
    buttons[at]?.focus();
  };
  const activeIndex = (): number => buttons.findIndex((b) => b === doc.activeElement);

  const close = (refocus: boolean): void => {
    if (!opened) return;
    opened = false;
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    list.replaceChildren();
    buttons = [];
    if (refocus) button.focus();
  };

  const run = (item: MenuItem): void => {
    if (item.disabled) return;
    close(true);
    options.choose(item.id);
  };

  const open = (focus: "first" | "last"): void => {
    if (opened) return;
    items = options.items();
    list.replaceChildren();
    buttons = [];
    for (const item of items) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "al-btn al-menu-item";
      b.dataset["item"] = item.id;
      b.setAttribute("role", "menuitem");
      b.tabIndex = -1;
      b.disabled = item.disabled === true;
      const label = doc.createElement("span");
      label.textContent = item.label;
      b.appendChild(label);
      if (item.shortcut) {
        const key = doc.createElement("span");
        key.className = "al-menu-key";
        key.textContent = item.shortcut;
        b.appendChild(key);
      }
      if (item.note) b.title = item.note;
      b.addEventListener("click", () => run(item));
      list.appendChild(b);
      buttons.push(b);
      if (item.separatorAfter) {
        const sep = doc.createElement("div");
        sep.className = "al-menu-sep";
        sep.setAttribute("role", "separator");
        list.appendChild(sep);
      }
    }
    opened = true;
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    focusItem(nextEnabled(items, -1, focus === "first" ? 1 : -1));
  };

  button.addEventListener("click", () => (opened ? close(false) : open("first")));
  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (opened) focusItem(nextEnabled(items, activeIndex(), e.key === "ArrowDown" ? 1 : -1));
      else open(e.key === "ArrowDown" ? "first" : "last");
    }
  });

  list.addEventListener("keydown", (e) => {
    const at = activeIndex();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(nextEnabled(items, at, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(nextEnabled(items, at, -1));
        break;
      case "Home":
        e.preventDefault();
        focusItem(nextEnabled(items, -1, 1));
        break;
      case "End":
        e.preventDefault();
        focusItem(nextEnabled(items, -1, -1));
        break;
      case "Escape":
        e.preventDefault();
        // Nothing else (a panel, arrange mode) may react to this Esc.
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        break;
    }
  });

  doc.addEventListener("pointerdown", (e) => {
    if (opened && !wrap.contains(e.target as Node)) close(false);
  });

  return {
    element: wrap,
    button,
    open: () => open("first"),
    close: () => close(false),
    get isOpen() {
      return opened;
    },
  };
}
