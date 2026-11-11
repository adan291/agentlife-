import { needsAttention } from "@agentlife/shared";
import type { FloorStatus } from "@agentlife/shared";
import { floorTag, statusText } from "./floors.ts";

export interface FloorListActions {
  /** Choose a floor. Absent: the list is only to read (the directory board). */
  go?(roomId: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The floors with their live status, for the elevator panel (with buttons) and the lobby directory (read-only).
 * A floor that waits for the user is marked with `data-attention="true"` and its status is in words as well as colour.
 */
export function renderFloorList(doc: Document, floors: readonly FloorStatus[], currentRoom: string | undefined, actions: FloorListActions = {}): HTMLElement {
  const root = el(doc, "div", "al-floors");
  if (floors.length === 0) {
    root.appendChild(el(doc, "p", "al-muted", "No floors yet."));
    return root;
  }
  const list = el(doc, "ul", "al-floor-list");
  for (const f of floors) {
    const here = f.roomId === currentRoom;
    const item = el(doc, "li", "al-floor");
    item.dataset["room"] = f.roomId;
    item.dataset["status"] = f.status;
    item.dataset["attention"] = String(needsAttention(f.status));
    item.dataset["here"] = String(here);
    const tag = el(doc, "span", "al-floor-tag", floorTag(floors, f.roomId));
    tag.setAttribute("aria-hidden", "true");
    const name = el(doc, "strong", "al-floor-name", f.name);
    const status = el(doc, "span", "al-floor-status", here ? `You are here · ${statusText(f)}` : statusText(f));
    item.append(tag, name, status);
    if (actions.go) {
      const go = actions.go;
      const b = el(doc, "button", "al-btn", here ? "Here" : "Go");
      b.type = "button";
      b.disabled = here;
      b.setAttribute("aria-label", here ? `${f.name}, you are here` : `Go to ${f.name}`);
      b.dataset["go"] = f.roomId;
      b.addEventListener("click", () => go(f.roomId));
      item.appendChild(b);
    }
    list.appendChild(item);
  }
  root.appendChild(list);
  return root;
}
