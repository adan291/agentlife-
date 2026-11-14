import { OUTFIT_SLOTS, SLOT_LABELS } from "@agentlife/shared";
import type { OutfitPart, OutfitSlot, WearWho } from "@agentlife/shared";
import type { RoleKey } from "../palette.ts";
import type { OutfitBook } from "../scene/outfit-book.ts";
import type { OutfitLook } from "../scene/outfit.ts";

/** Who a picker dresses: a figure with a name and a role tint (for the preview). */
export interface LookTarget {
  who: WearWho;
  name: string;
  role: RoleKey;
}

export interface LookPickerDeps {
  /** The parts, the wardrobe and what everybody wears. */
  book: OutfitBook;
  /** Asks the server to put a part on (`null`: take the slot off). The server checks everything again. */
  wear(who: WearWho, slot: OutfitSlot, partId: string | null): void;
  /** A picture of the figure wearing the look, drawn by the room's own renderer; undefined when there is none (tests). */
  preview?(role: RoleKey, look: OutfitLook | undefined): string | undefined;
  /** Why the last change was refused, in words; null when it was not. */
  error?(): string | null;
}

/** The parts the picker offers for a slot: the owned ones in file order, and the worn one even when it is not owned, so the picker never lies. */
export function pickerParts(parts: readonly OutfitPart[], owned: readonly string[], slot: OutfitSlot, worn: string | undefined): OutfitPart[] {
  return parts.filter((p) => p.slot === slot && (owned.includes(p.id) || p.id === worn));
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The Look section of the HR card and of the Profile panel (ghost-skins): the figure with what it wears now, and one
 * picker per slot with "None" and the parts the user owns. A change is sent at once; the picture and the pickers follow
 * the server's `outfits` answer. Without a wardrobe it says so, and with an empty one it says where to get parts.
 */
export function createLookPicker(doc: Document, deps: LookPickerDeps): (target: LookTarget) => HTMLElement {
  return (target) => {
    const section = el(doc, "div", "al-look");
    section.dataset["section"] = "look";
    section.appendChild(el(doc, "h5", undefined, "Look"));
    const wardrobe = deps.book.wardrobe;
    if (!wardrobe) {
      section.appendChild(el(doc, "p", "al-muted", "Outfits are off: they need the real engine."));
      return section;
    }
    const outfit = target.who === "user" ? deps.book.forUser() : deps.book.forMember(target.who.project, target.who.member);
    const error = deps.error?.();
    if (error) {
      const p = el(doc, "p", "al-error", error);
      p.setAttribute("role", "alert");
      section.appendChild(p);
    }
    const row = el(doc, "div", "al-row al-wrap");
    const pic = el(doc, "div", "al-look-preview");
    const src = deps.preview?.(target.role, deps.book.look(outfit));
    if (src) {
      const img = el(doc, "img");
      img.setAttribute("src", src);
      img.setAttribute("alt", `${target.name} with the current look`);
      pic.appendChild(img);
    }
    const pickers = el(doc, "div", "al-field");
    for (const slot of OUTFIT_SLOTS) {
      const worn = outfit[slot];
      const options = pickerParts(wardrobe.parts, wardrobe.owned, slot, worn);
      const label = el(doc, "label", "al-look-slot");
      label.append(el(doc, "span", "al-muted", SLOT_LABELS[slot]));
      const select = el(doc, "select", "al-input");
      select.dataset["slot"] = slot;
      select.setAttribute("aria-label", `${SLOT_LABELS[slot]} for ${target.name}`);
      const none = el(doc, "option", undefined, "None");
      none.value = "";
      select.appendChild(none);
      for (const part of options) {
        const opt = el(doc, "option", undefined, part.name);
        opt.value = part.id;
        select.appendChild(opt);
      }
      select.value = worn !== undefined && options.some((p) => p.id === worn) ? worn : "";
      select.addEventListener("change", () => deps.wear(target.who, slot, select.value === "" ? null : select.value));
      label.appendChild(select);
      pickers.appendChild(label);
    }
    row.append(pic, pickers);
    section.appendChild(row);
    if (wardrobe.owned.length === 0) section.appendChild(el(doc, "p", "al-muted", "You own no outfit parts yet. Buy some at the shop counter in the lobby."));
    return section;
  };
}
