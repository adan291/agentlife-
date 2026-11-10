import type { ClientMsg, PanelName, ServerMsg } from "@agentlife/shared";
import { renderBoard } from "./board.ts";
import { createComputerPanel } from "./computer.ts";
import type { PanelContent } from "./computer.ts";
import { renderMailbox } from "./mailbox.ts";
import { PanelState } from "./panel-state.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-panel { position: absolute; z-index: 20; top: var(--al-s2); left: 50%; transform: translateX(-50%); width: min(720px, calc(100% - var(--al-s4))); max-height: calc(100% - var(--al-s4)); display: flex; flex-direction: column; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; }
.al-panel[hidden] { display: none; }
.al-shell[data-compact="true"] .al-panel { top: 0; left: 0; transform: none; width: 100%; max-height: 100%; border-radius: 0; border-width: 1px 0; }
.al-panel-head { flex: none; display: flex; justify-content: space-between; align-items: center; gap: var(--al-s3); padding: var(--al-s2) var(--al-s4); border-bottom: 1px solid var(--al-border); }
.al-panel-body { flex: 1; min-height: 0; overflow: auto; padding: var(--al-s2) var(--al-s4) var(--al-s3); }
.al-panel-foot { flex: none; display: flex; justify-content: flex-end; gap: var(--al-s2); padding: var(--al-s2) var(--al-s4); border-top: 1px solid var(--al-border); }
.al-panel-foot[hidden] { display: none; }
.al-panel h3, .al-panel h4, .al-panel h5, .al-panel h6 { margin: var(--al-s2) 0 var(--al-s1); color: ${UI_COLOURS.accentText}; }
.al-panel h3 { margin: 0; }
.al-panel label { display: block; margin: var(--al-s2) 0; }
.al-input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--al-s1); padding: var(--al-s1); }
.al-row { display: flex; gap: var(--al-s2); margin-top: var(--al-s2); }
.al-card { border: 1px solid var(--al-border); border-radius: var(--al-radius); padding: var(--al-s2); margin: var(--al-s2) 0; }
.al-card pre { overflow-x: auto; background: ${UI_COLOURS.inputBg}; padding: var(--al-s1); margin: var(--al-s2) 0; }
.al-card code { font: inherit; }
.al-diff-line { display: block; white-space: pre; }
.al-diff-add { color: ${UI_COLOURS.add}; background: ${UI_COLOURS.addBg}; }
.al-diff-del { color: ${UI_COLOURS.del}; background: ${UI_COLOURS.delBg}; }
.al-diff-hunk { color: ${UI_COLOURS.hunk}; }
.al-diff-meta { color: ${UI_COLOURS.muted}; }
.al-muted { color: ${UI_COLOURS.muted}; }
.al-error { color: ${UI_COLOURS.error}; }
.al-timeline { padding-left: var(--al-s5); white-space: pre-wrap; }
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

/**
 * DOM panels for computer, mailbox and board, mounted in `host` (the stage). A panel has a header (title, close button),
 * a scrollable body and an optional footer for actions. Hidden panels take no space and never block the canvas.
 * `onChange` runs after every re-render (open, close, refresh).
 */
export function createPanels(send: (msg: ClientMsg) => void, onChange: () => void = () => {}, host: HTMLElement = document.body): Panels {
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
  header.className = "al-panel-head";
  header.append(title, closeBtn);
  const body = document.createElement("div");
  body.className = "al-panel-body";
  const footer = document.createElement("footer");
  footer.className = "al-panel-foot";
  footer.hidden = true;
  root.append(header, body, footer);
  host.appendChild(root);

  const render = () => {
    if (!state.open) {
      root.hidden = true;
      onChange();
      return;
    }
    const wasHidden = root.hidden;
    root.hidden = false;
    title.textContent = TITLES[state.open];
    root.setAttribute("aria-label", TITLES[state.open]);
    const content: PanelContent =
      state.open === "computer"
        ? computer(state.data, state.engineError)
        : state.open === "mailbox"
          ? { body: renderMailbox(document, state.data, { decide: (approvalId, decision) => send({ type: "approve", approvalId, decision }) }) }
          : { body: renderBoard(document, state.data) };
    body.replaceChildren(content.body);
    footer.replaceChildren(...(content.footer ? [content.footer] : []));
    footer.hidden = !content.footer;
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
