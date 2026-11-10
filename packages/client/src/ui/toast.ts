import type { PanelName } from "@agentlife/shared";
import { UI_COLOURS } from "./theme.ts";

export const TAB_TITLE = "AGENT LIFE";
export const YOUR_TURN_TEXT = "The Architect's plan is ready. Review it in the mailbox.";

/**
 * The toast stays while an approval is pending and the mailbox is closed. It goes away when the
 * approval is resolved or the mailbox is opened, and comes back if the mailbox is closed while one is still pending.
 */
export function yourTurnVisible(pending: number, openPanel: PanelName | null): boolean {
  return pending > 0 && openPanel !== "mailbox";
}

/** "(1) AGENT LIFE" while approvals wait, whether or not the mailbox is open. */
export function tabTitle(pending: number): string {
  return pending > 0 ? `(${pending}) ${TAB_TITLE}` : TAB_TITLE;
}

const CSS = `
.al-turn { position: fixed; z-index: 12; top: 62px; left: 50%; transform: translateX(-50%); max-width: min(560px, 90vw); display: flex; gap: 12px; align-items: center; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 2px solid ${UI_COLOURS.accent}; border-radius: 6px; padding: 8px 12px; font: var(--al-font, 14px)/1.4 monospace; box-sizing: border-box; box-shadow: 0 0 12px rgba(255, 138, 31, 0.45); }
.al-turn[hidden] { display: none; }
.al-turn button { flex: none; }
`;

export interface YourTurnToast {
  /** Call after any change of the pending approval count or the open panel. */
  update(pending: number, openPanel: PanelName | null): void;
}

/** "Your turn" call to action at the top, with a button that opens the mailbox. Also sets the tab title. */
export function createYourTurnToast(onOpenMailbox: () => void): YourTurnToast {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "al-turn";
  root.hidden = true;
  root.setAttribute("role", "alert");
  const text = document.createElement("span");
  text.textContent = YOUR_TURN_TEXT;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "al-btn";
  open.textContent = "Open mailbox";
  open.addEventListener("click", onOpenMailbox);
  root.append(text, open);
  document.body.appendChild(root);

  return {
    update(pending, openPanel) {
      root.hidden = !yourTurnVisible(pending, openPanel);
      document.title = tabTitle(pending);
    },
  };
}
