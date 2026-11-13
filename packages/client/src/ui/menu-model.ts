import type { ViewMode } from "./view-mode.ts";

/** Width below which the controls of the top bar's collapsible group move into the Menu. The side bar collapses at the same width. */
export const BREAK_MENU_PX = 900;

export type MenuItemId = "view" | "edit" | "profile" | "commands" | "zoom" | "text-smaller" | "text-larger" | "help";

/** An entry of a dropdown. The Menu of the top bar uses `MenuItemId`; the Actions menu has its own ids. */
export interface MenuItem<Id extends string = MenuItemId> {
  id: Id;
  label: string;
  /** Key shown on the right, as the user would press it. */
  shortcut?: string;
  /** What a choice does, when the label alone does not say it (the zoom item shows the current zoom). */
  note?: string;
  disabled?: boolean;
  /** A separator is drawn after this item. */
  separatorAfter?: boolean;
}

/** What the menu needs to know to list its items. */
export interface MenuState {
  /** The window is narrower than `BREAK_MENU_PX`: the collapsible group of the top bar is inside the Menu. */
  narrow: boolean;
  zoom: number;
  view: ViewMode;
  editing: boolean;
  /** Edit room can be started (false in the recorded demo, and where arranging is not possible). */
  editable: boolean;
  /** Ecto balance, or null when the hotel has no economy. */
  balance: number | null;
  /** "Lv 3", or null when there is no progress. */
  level: string | null;
  fontMin: boolean;
  fontMax: boolean;
}

export function isNarrow(width: number): boolean {
  return width < BREAK_MENU_PX;
}

/** The text of the profile item: the level and the Ecto, whichever the hotel has. */
export function profileLabel(balance: number | null, level: string | null): string {
  const parts = [level, balance === null ? null : `${balance} Ecto`].filter((p): p is string => p !== null);
  return parts.length === 0 ? "Profile" : `Profile: ${parts.join(", ")}`;
}

/** The items of the Menu, in order. The first group (view, edit, profile) is listed only when the top bar has collapsed. */
export function menuItems(s: MenuState): MenuItem[] {
  const items: MenuItem[] = [];
  if (s.narrow) {
    items.push({ id: "view", label: s.view === "hotel" ? "Show the list" : "Show the hotel", shortcut: "L" });
    items.push({
      id: "edit",
      label: s.editing ? "Done editing" : "Edit room",
      shortcut: "E",
      ...(s.editable || s.editing ? {} : { disabled: true }),
    });
    if (s.balance !== null || s.level !== null) items.push({ id: "profile", label: profileLabel(s.balance, s.level) });
    const last = items[items.length - 1]!;
    last.separatorAfter = true;
  }
  items.push({ id: "commands", label: "Commands", shortcut: "Ctrl+K" });
  const other = s.zoom === 1 ? 2 : 1;
  items.push({ id: "zoom", label: `Zoom ${s.zoom}×`, shortcut: "Z", note: `Switch to ${other}×` });
  items.push({ id: "text-smaller", label: "Text smaller", ...(s.fontMin ? { disabled: true } : {}) });
  items.push({ id: "text-larger", label: "Text larger", ...(s.fontMax ? { disabled: true } : {}) });
  items.push({ id: "help", label: "Help and guide", shortcut: "?" });
  return items;
}

/** The state of the Edit room button: its words, whether it is pressed and whether it can be used. */
export interface EditButtonState {
  text: string;
  pressed: boolean;
  disabled: boolean;
  title: string;
}

/**
 * `live`: a world-server is there to save the arrangement (false in the recorded demo). `available`: the room the
 * user is in can be arranged. While editing the button always works, so the user can leave.
 */
export function editButtonState(live: boolean, available: boolean, active: boolean): EditButtonState {
  if (active) return { text: "Done", pressed: true, disabled: false, title: "Leave edit mode (Esc)" };
  if (!live) return { text: "Edit room", pressed: false, disabled: true, title: "The recorded demo cannot be edited. Run AGENT LIFE on your computer to arrange your rooms." };
  if (!available) return { text: "Edit room", pressed: false, disabled: true, title: "This room cannot be arranged." };
  return { text: "Edit room", pressed: false, disabled: false, title: "Move and turn the furniture of this room (E)" };
}

/** Whether a key press is the edit shortcut: `E` on its own, not inside a text field and not with Ctrl, Alt or Meta. */
export function isEditKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown; repeat?: boolean }, inField: (t: unknown) => boolean): boolean {
  if (e.key !== "e" && e.key !== "E") return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
  return !inField(e.target);
}

/** Whether a key press is the help shortcut: `?` (Shift and the slash key), outside text fields. */
export function isHelpKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown }, inField: (t: unknown) => boolean): boolean {
  if (e.key !== "?") return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !inField(e.target);
}

/** Index of the next enabled item when moving by `step` (1 or -1) from `from` (-1: none yet), wrapping. -1 when every item is disabled. */
export function nextEnabled<T extends { id: string; disabled?: boolean }>(items: readonly T[], from: number, step: 1 | -1): number {
  const n = items.length;
  if (n === 0) return -1;
  // Nothing is active yet: going down starts at the first item, going up at the last.
  const start = from < 0 && step === -1 ? n : from;
  for (let i = 1; i <= n; i++) {
    const at = (((start + step * i) % n) + n) % n;
    if (!items[at]!.disabled) return at;
  }
  return -1;
}
