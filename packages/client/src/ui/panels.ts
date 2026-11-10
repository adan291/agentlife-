import type { ClientMsg, PanelName, ServerMsg } from "@agentlife/shared";
import { renderBoard } from "./board.ts";
import { createComputerPanel } from "./computer.ts";
import { renderMailbox } from "./mailbox.ts";
import { PanelState } from "./panel-state.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-panel { position: fixed; z-index: 20; top: 64px; left: 50%; transform: translateX(-50%); width: min(720px, 90vw); max-height: calc(100vh - 64px - var(--al-terminal-h, 0px) - 16px); overflow: auto; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid ${UI_COLOURS.accent}; border-radius: 6px; padding: 10px 14px; font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; }
.al-panel[hidden] { display: none; }
.al-panel header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.al-panel h3, .al-panel h4, .al-panel h5, .al-panel h6 { margin: 8px 0 4px; color: ${UI_COLOURS.accentText}; }
.al-panel h3 { margin: 0; }
.al-panel label { display: block; margin: 8px 0; }
.al-input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.text}; border: 1px solid ${UI_COLOURS.border}; border-radius: 4px; padding: 4px; font: inherit; }
.al-btn:disabled { opacity: 0.5; cursor: default; }
.al-row { display: flex; gap: 8px; margin-top: 6px; }
.al-card { border: 1px solid ${UI_COLOURS.border}; border-radius: 4px; padding: 6px 8px; margin: 6px 0; }
.al-card pre { overflow-x: auto; background: ${UI_COLOURS.inputBg}; padding: 4px; margin: 6px 0; }
.al-card code { font: inherit; }
.al-diff-line { display: block; white-space: pre; }
.al-diff-add { color: ${UI_COLOURS.add}; background: ${UI_COLOURS.addBg}; }
.al-diff-del { color: ${UI_COLOURS.del}; background: ${UI_COLOURS.delBg}; }
.al-diff-hunk { color: ${UI_COLOURS.hunk}; }
.al-diff-meta { color: ${UI_COLOURS.muted}; }
.al-muted { color: ${UI_COLOURS.muted}; }
.al-error { color: ${UI_COLOURS.error}; }
.al-timeline { padding-left: 20px; white-space: pre-wrap; }
`;

const TITLES: Record<PanelName, string> = { computer: "Computer", mailbox: "Mailbox", board: "Job board" };

export interface Panels {
  /** Feed every server message; opens panels and refreshes the open one. */
  handle(msg: ServerMsg): void;
  close(): void;
  /** Opens a panel with the data already on the client, without walking to the furniture. */
  open(panel: PanelName): void;
  readonly state: PanelState;
}

/** DOM panels for computer, mailbox and board. Hidden panels take no space and never block the canvas. `onChange` runs after every re-render (open, close, refresh). */
export function createPanels(send: (msg: ClientMsg) => void, onChange: () => void = () => {}): Panels {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const state = new PanelState();
  const computer = createComputerPanel(document, { startJob: (repoId, goal) => send({ type: "start_job", repoId, goal }) });

  const root = document.createElement("div");
  root.className = "al-panel";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Panel");
  const title = document.createElement("h3");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "al-btn";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close panel");
  const header = document.createElement("header");
  header.append(title, closeBtn);
  const body = document.createElement("div");
  root.append(header, body);
  document.body.appendChild(root);

  const render = () => {
    if (!state.open) {
      root.hidden = true;
      onChange();
      return;
    }
    const wasHidden = root.hidden;
    root.hidden = false;
    title.textContent = TITLES[state.open];
    const content =
      state.open === "computer"
        ? computer(state.data, state.engineError)
        : state.open === "mailbox"
          ? renderMailbox(document, state.data, { decide: (approvalId, decision) => send({ type: "approve", approvalId, decision }) })
          : renderBoard(document, state.data);
    body.replaceChildren(content);
    if (wasHidden) closeBtn.focus();
    onChange();
  };

  const close = () => {
    state.close();
    render();
  };
  closeBtn.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.open) close();
  });

  return {
    state,
    close,
    open(panel) {
      if (state.apply({ type: "open_panel", panel })) render();
    },
    handle(msg) {
      if (state.apply(msg)) render();
    },
  };
}
