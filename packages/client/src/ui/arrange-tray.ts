import type { ArrangeView } from "./arrange.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-tray { position: absolute; z-index: 12; top: calc(var(--al-s2) + 44px); right: var(--al-s2); bottom: var(--al-s2); width: 200px; max-width: calc(50% - var(--al-s3)); display: flex; flex-direction: column; gap: var(--al-s2); padding: var(--al-s2); box-sizing: border-box; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-border); border-radius: var(--al-radius); box-shadow: var(--al-shadow); font: var(--al-font, 14px)/1.4 monospace; pointer-events: auto; }
.al-tray[hidden] { display: none; }
.al-tray-head { margin: 0; font-weight: bold; color: ${UI_COLOURS.accentText}; }
.al-tray-empty { margin: 0; }
.al-tray-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--al-s1); overflow-y: auto; min-height: 0; }
.al-tray-item { display: flex; align-items: center; gap: var(--al-s2); width: 100%; box-sizing: border-box; padding: var(--al-s1) var(--al-s2); text-align: left; cursor: grab; user-select: none; touch-action: none; }
.al-tray-item[aria-pressed="true"] { border-color: var(--al-accent); outline: 2px solid var(--al-accent); }
.al-tray-pic { flex: 0 0 48px; display: flex; align-items: center; justify-content: center; height: 40px; overflow: hidden; background: ${UI_COLOURS.inputBg}; border-radius: var(--al-radius); }
.al-tray-pic img { max-width: 100%; max-height: 100%; image-rendering: pixelated; pointer-events: none; }
.al-tray-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
`;

export interface ArrangeTrayActions {
  /** The user took an item out of the tray (pointer down on it, or Enter on it). */
  carry(itemId: string): void;
}

export interface ArrangeTrayDeps {
  /** A picture of an item (a data URL) drawn by the room's own renderer, or undefined when there is none. */
  preview?(defId: string): string | undefined;
}

export interface ArrangeTray {
  readonly element: HTMLElement;
  update(view: ArrangeView): void;
}

/**
 * The inventory tray of arrange mode (furni-shop): the items the user bought and has not placed. Pressing an item takes it;
 * the pointer then carries it over the floor and a release or a click places it (the model does the rest). The tray only
 * draws what the model says and has no state of its own.
 */
export function createArrangeTray(doc: Document, host: HTMLElement, actions: ArrangeTrayActions, deps: ArrangeTrayDeps = {}): ArrangeTray {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const root = doc.createElement("section");
  root.className = "al-tray";
  root.setAttribute("aria-label", "Your furniture");
  root.hidden = true;
  const head = doc.createElement("p");
  head.className = "al-tray-head";
  head.textContent = "Your furniture";
  const empty = doc.createElement("p");
  empty.className = "al-tray-empty al-muted";
  empty.textContent = "Nothing to place. Buy furniture at the shop counter in the lobby.";
  const list = doc.createElement("ul");
  list.className = "al-tray-list";
  root.append(head, empty, list);
  host.appendChild(root);

  // The list is rebuilt only when the items change: a button replaced under the pointer would lose the press.
  let key = "";
  let buttons: { itemId: string; button: HTMLButtonElement }[] = [];

  return {
    element: root,
    update(view) {
      root.hidden = !view.active;
      if (!view.active) return;
      const next = JSON.stringify(view.tray);
      empty.hidden = view.tray.length > 0;
      if (next === key) {
        for (const { itemId, button } of buttons) button.setAttribute("aria-pressed", String(view.carrying === itemId));
        return;
      }
      key = next;
      buttons = [];
      list.replaceChildren();
      for (const item of view.tray) {
        const li = doc.createElement("li");
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "al-btn al-tray-item";
        b.dataset["item"] = item.itemId;
        b.setAttribute("aria-pressed", String(view.carrying === item.itemId));
        b.setAttribute("aria-label", `${item.name}, you have ${item.count}`);
        b.title = "Drag it onto the floor, or click it and then click the floor";
        const pic = doc.createElement("span");
        pic.className = "al-tray-pic";
        const src = deps.preview?.(item.defId);
        if (src) {
          const img = doc.createElement("img");
          img.setAttribute("src", src);
          img.setAttribute("alt", "");
          img.setAttribute("draggable", "false");
          pic.appendChild(img);
        }
        const name = doc.createElement("span");
        name.className = "al-tray-name";
        name.textContent = `${item.name} ×${item.count}`;
        b.append(pic, name);
        // A press takes the item at once, so the same press can be dragged onto the floor. A key press has no pointer: click does it.
        b.addEventListener("pointerdown", (e) => {
          if (e.button === 0) actions.carry(item.itemId);
        });
        b.addEventListener("click", (e) => {
          if (e.detail === 0) actions.carry(item.itemId);
        });
        li.appendChild(b);
        list.appendChild(li);
        buttons.push({ itemId: item.itemId, button: b });
      }
    },
  };
}
