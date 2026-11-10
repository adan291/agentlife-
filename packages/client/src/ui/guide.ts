import { UI_COLOURS } from "./theme.ts";

export const GUIDE_FLAG = "agentlife-guide-seen";

export const GUIDE_STEPS = [
  "Click the computer and give the agents a job.",
  "Approve the Architect's plan in the mailbox.",
  "Watch them build and test it, then read the report in the mailbox.",
] as const;

export const GUIDE_NOTE = "Agents are real Kiro agents; tests run in an isolated Docker container.";

/** The part of localStorage the guide uses. */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True on the first visit. Storage that throws (private mode) counts as a first visit that cannot be remembered. */
export function isFirstVisit(storage: FlagStorage | undefined): boolean {
  try {
    return storage?.getItem(GUIDE_FLAG) !== "1";
  } catch {
    return true;
  }
}

export function markGuideSeen(storage: FlagStorage | undefined): void {
  try {
    storage?.setItem(GUIDE_FLAG, "1");
  } catch {
    // Not remembered; the card shows again next time.
  }
}

const CSS = `
.al-guide { position: fixed; z-index: 25; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(520px, 90vw); background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid ${UI_COLOURS.accent}; border-radius: 6px; padding: 12px 16px; font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; }
.al-guide[hidden] { display: none; }
.al-guide h3 { margin: 0 0 8px; color: ${UI_COLOURS.accentText}; }
.al-guide ol { margin: 0 0 8px; padding-left: 22px; }
.al-guide li { margin: 4px 0; }
.al-guide p { margin: 0 0 10px; color: ${UI_COLOURS.muted}; }
`;

export interface Guide {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** Dismissible "how it works" card. Opens on the first visit; `open()` reopens it. Esc and the button close it. */
export function createGuide(storage: FlagStorage | undefined = typeof localStorage === "undefined" ? undefined : localStorage): Guide {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "al-guide";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "How it works");

  const title = document.createElement("h3");
  title.textContent = "How it works";
  const list = document.createElement("ol");
  for (const step of GUIDE_STEPS) {
    const li = document.createElement("li");
    li.textContent = step;
    list.appendChild(li);
  }
  const note = document.createElement("p");
  note.textContent = GUIDE_NOTE;
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "al-btn";
  ok.textContent = "Got it";
  root.append(title, list, note, ok);
  document.body.appendChild(root);

  const close = () => {
    if (root.hidden) return;
    root.hidden = true;
    markGuideSeen(storage);
  };
  const open = () => {
    root.hidden = false;
    ok.focus();
  };
  ok.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  if (isFirstVisit(storage)) open();

  return {
    open,
    close,
    get isOpen() {
      return !root.hidden;
    },
  };
}
