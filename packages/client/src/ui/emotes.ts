import type { UserEmote } from "@agentlife/shared";
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

/** The keys of the emote bar, in the order of its buttons. */
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

const CSS = `
.al-emotes { position: absolute; z-index: 11; right: var(--al-s2); bottom: var(--al-s2); display: flex; gap: var(--al-s1); padding: var(--al-s1); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-border); border-radius: var(--al-radius); box-shadow: var(--al-shadow); }
.al-emotes[hidden] { display: none; }
.al-emote-key { opacity: 0.8; margin-right: 4px; }
`;

export interface EmoteBarActions {
  emote(emote: UserEmote): void;
  sit(): void;
}

export interface EmoteBar {
  readonly element: HTMLElement;
  /** Shows or hides the bar (hidden while arranging and in the list view). */
  setVisible(visible: boolean): void;
  /** The user sat down or got up: the Sit button says "Stand" and is pressed while the user sits. */
  setSitting(sitting: boolean): void;
}

/** The row of four buttons at the bottom right of the stage: Wave, Dance, Cheer and Sit, each with its key. */
export function createEmoteBar(doc: Document, host: HTMLElement, actions: EmoteBarActions): EmoteBar {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const bar = doc.createElement("div");
  bar.className = "al-emotes";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Emotes");
  let sitText: HTMLElement | undefined;
  let sitButton: HTMLElement | undefined;
  for (const k of EMOTE_KEYS) {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "al-btn al-emote";
    b.dataset["emote"] = k.action.kind === "emote" ? k.action.emote : "sit";
    b.title = `${k.title} (${k.key})`;
    b.setAttribute("aria-label", `${k.title}, key ${k.key}`);
    const key = doc.createElement("span");
    key.className = "al-emote-key";
    key.textContent = k.key;
    const text = doc.createElement("span");
    text.textContent = k.label;
    b.append(key, text);
    if (k.action.kind === "sit") {
      b.setAttribute("aria-pressed", "false");
      sitText = text;
      sitButton = b;
    }
    b.addEventListener("click", () => {
      if (k.action.kind === "emote") actions.emote(k.action.emote);
      else actions.sit();
    });
    bar.appendChild(b);
  }
  host.appendChild(bar);
  return {
    element: bar,
    setVisible(visible) {
      bar.hidden = !visible;
    },
    setSitting(sitting) {
      if (sitText) sitText.textContent = sitting ? "Stand" : "Sit";
      sitButton?.setAttribute("aria-pressed", String(sitting));
    },
  };
}
