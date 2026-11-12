import type { FlagStorage } from "./guide.ts";

/** The two ways to look at the hotel: the isometric rooms, or a compact list of every project (list-mode). */
export type ViewMode = "hotel" | "list";

/** Where the choice is remembered between page loads. */
export const VIEW_KEY = "agentlife-view";

export function loadView(storage: FlagStorage | undefined): ViewMode {
  try {
    return storage?.getItem(VIEW_KEY) === "list" ? "list" : "hotel";
  } catch {
    return "hotel";
  }
}

export function saveView(storage: FlagStorage | undefined, view: ViewMode): void {
  try {
    storage?.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered; the hotel view starts next time.
  }
}

export function otherView(view: ViewMode): ViewMode {
  return view === "list" ? "hotel" : "list";
}

/** Whether a key press is the list toggle: `L` on its own, not inside a text field and not with Ctrl, Alt or Meta. */
export function isViewKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; target?: unknown }): boolean {
  if (e.key !== "l" && e.key !== "L") return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !inTextField(e.target);
}

/** Whether a key press is the palette shortcut: Ctrl+K (Cmd+K on a Mac). Works from text fields too, as in other apps. */
export function isPaletteKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return (e.key === "k" || e.key === "K") && Boolean(e.ctrlKey || e.metaKey) && !e.altKey;
}

/** True when the event target is somewhere the user types. */
export function inTextField(target: unknown): boolean {
  const t = target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  if (!t || typeof t.tagName !== "string") return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable === true;
}
