import type { ClientMsg, PanelName, ServerMsg } from "@agentlife/shared";
import { renderBoard } from "./board.ts";
import { createComputerPanel } from "./computer.ts";
import { renderMailbox } from "./mailbox.ts";
import { PanelState } from "./panel-state.ts";

const CSS = `
.al-panel { position: fixed; z-index: 20; top: 50px; right: 10px; width: min(420px, calc(100vw - 20px)); max-height: calc(100vh - 80px); overflow: auto; background: #14101f; color: #e8e0ff; border: 1px solid #ff8a1f; border-radius: 6px; padding: 10px 14px; font: 13px/1.4 monospace; box-sizing: border-box; }
.al-panel[hidden] { display: none; }
.al-panel header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.al-panel h3, .al-panel h4, .al-panel h5, .al-panel h6 { margin: 8px 0 4px; color: #ffb347; }
.al-panel h3 { margin: 0; }
.al-panel label { display: block; margin: 8px 0; }
.al-input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px; background: #0b0a12; color: #e8e0ff; border: 1px solid #4d3b80; border-radius: 4px; padding: 4px; font: inherit; }
.al-btn:disabled { opacity: 0.5; cursor: default; }
.al-row { display: flex; gap: 8px; margin-top: 6px; }
.al-card { border: 1px solid #4d3b80; border-radius: 4px; padding: 6px 8px; margin: 6px 0; }
.al-card pre { overflow: auto; background: #0b0a12; padding: 4px; }
.al-muted { color: #9d93c0; }
.al-error { color: #ff7a7a; }
.al-timeline { padding-left: 20px; white-space: pre-wrap; }
`;

const TITLES: Record<PanelName, string> = { computer: "Computer", mailbox: "Mailbox", board: "Job board" };

export interface Panels {
  /** Feed every server message; opens panels and refreshes the open one. */
  handle(msg: ServerMsg): void;
  close(): void;
  readonly state: PanelState;
}

/** DOM panels for computer, mailbox and board. Hidden panels take no space and never block the canvas. */
export function createPanels(send: (msg: ClientMsg) => void): Panels {
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
    handle(msg) {
      if (state.apply(msg)) render();
    },
  };
}
