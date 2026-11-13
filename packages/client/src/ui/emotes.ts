import type { UserEmote } from "@agentlife/shared";
import { createMenu } from "./menu.ts";
import type { MenuItem } from "./menu-model.ts";
import { inTextField } from "./view-mode.ts";
import { UI_COLOURS } from "./theme.ts";

/** What a key press asks for. */
export type EmoteKeyAction = { kind: "emote"; emote: UserEmote } | { kind: "sit" };

interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  target?: unknown;
}

/** The keys of the avatar's actions, in the order of the Actions menu. */
export const EMOTE_KEYS: readonly { key: string; action: EmoteKeyAction; label: string; title: string }[] = [
  { key: "1", action: { kind: "emote", emote: "wave" }, label: "Wave", title: "Wave" },
  { key: "2", action: { kind: "emote", emote: "dance" }, label: "Dance", title: "Dance" },
  { key: "3", action: { kind: "emote", emote: "cheer" }, label: "Cheer", title: "Cheer" },
  { key: "4", action: { kind: "sit" }, label: "Sit", title: "Sit down on the nearest seat, or stand up" },
];

/**
 * The emote a key press asks for: 1 wave, 2 dance, 3 cheer, 4 sit or stand. Nothing when the user is typing in a field,
 * holds Ctrl, Alt or Meta (browser and palette shortcuts), holds the key down, or when `blocked` (a panel is open, the user
 * is arranging the furniture): the number keys are free for everything else then.
 */
export function emoteKey(e: KeyLike, blocked = false): EmoteKeyAction | null {
  if (blocked || e.repeat || inTextField(e.target) || e.ctrlKey || e.metaKey || e.altKey) return null;
  return EMOTE_KEYS.find((k) => k.key === e.key)?.action ?? null;
}

export type ActionId = "wave" | "dance" | "cheer" | "sit";

/** What the Actions menu needs to know to list its items. */
export interface ActionState {
  /** The user's avatar sits on a seat now. */
  sitting: boolean;
  /** The room has a seat piece. */
  hasSeat: boolean;
}

/** The items of the Actions menu, in the order of the keys: Wave (1), Dance (2), Cheer (3) and Sit or Stand (4). */
export function actionItems(s: ActionState): MenuItem<ActionId>[] {
  return EMOTE_KEYS.map((k): MenuItem<ActionId> => {
    if (k.action.kind === "sit") {
      return {
        id: "sit",
        label: s.sitting ? "Stand up" : "Sit down",
        shortcut: k.key,
        note: k.title,
        ...(!s.sitting && !s.hasSeat ? { disabled: true, note: "There is no seat in this room." } : {}),
      };
    }
    const id: ActionId = k.action.emote;
    // A seated avatar does not dance (the same rule as the server's).
    const noDance = id === "dance" && s.sitting;
    return { id, label: k.label, shortcut: k.key, note: noDance ? "Stand up to dance." : k.title, ...(noDance ? { disabled: true } : {}) };
  });
}

const CSS = `
.al-actions { position: absolute; z-index: 11; left: var(--al-s2); bottom: var(--al-s2); }
.al-actions[hidden] { display: none; }
.al-actions .al-menu-button { background: ${UI_COLOURS.panelBg}; box-shadow: var(--al-shadow); }
.al-actions .al-menu-list { min-width: 200px; max-width: calc(100% - var(--al-s4)); }
`;

export interface ActionsActions {
  emote(emote: UserEmote): void;
  sit(): void;
}

export interface ActionsMenu {
  readonly element: HTMLElement;
  /** Shows or hides the button (hidden while arranging and in the list view). */
  setVisible(visible: boolean): void;
  /** The user sat down or got up. */
  setSitting(sitting: boolean): void;
  /** Whether the room the user is in has a seat. */
  setSeat(hasSeat: boolean): void;
  readonly isOpen: boolean;
  close(): void;
}

/**
 * The Actions button at the bottom left of the stage (ui-tidy): a closed menu with Wave, Dance, Cheer and Sit, each with
 * its key, which keep working without it. It lists the items again each time it opens, so a label is never stale.
 */
export function createActionsMenu(doc: Document, host: HTMLElement, actions: ActionsActions): ActionsMenu {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const state: ActionState = { sitting: false, hasSeat: true };
  const menu = createMenu<ActionId>(doc, {
    className: "al-actions",
    label: "Actions ▴",
    title: "Wave, dance, cheer or sit down (keys 1 to 4)",
    ariaLabel: "Actions",
    placement: "above",
    items: () => actionItems(state),
    choose: (id) => {
      if (id === "sit") actions.sit();
      else actions.emote(id);
    },
  });
  host.appendChild(menu.element);
  return {
    element: menu.element,
    setVisible(visible) {
      menu.element.hidden = !visible;
      if (!visible) menu.close();
    },
    setSitting(sitting) {
      state.sitting = sitting;
    },
    setSeat(hasSeat) {
      state.hasSeat = hasSeat;
    },
    get isOpen() {
      return menu.isOpen;
    },
    close: () => menu.close(),
  };
}
