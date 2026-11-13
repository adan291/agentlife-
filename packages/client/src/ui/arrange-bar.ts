import type { ArrangeView } from "./arrange.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-arrange { position: absolute; z-index: 12; left: var(--al-s2); bottom: var(--al-s2); width: min(440px, calc(100% - var(--al-s4))); display: flex; flex-direction: column; gap: var(--al-s2); padding: var(--al-s2) var(--al-s3); box-sizing: border-box; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); font: var(--al-font, 14px)/1.4 monospace; }
.al-arrange[hidden] { display: none; }
.al-arrange-piece { margin: 0; font-weight: bold; color: ${UI_COLOURS.accentText}; overflow-wrap: anywhere; }
.al-arrange-status { margin: 0; overflow-wrap: anywhere; }
.al-arrange-status[data-tone="ok"] { color: ${UI_COLOURS.add}; }
.al-arrange-status[data-tone="bad"] { color: ${UI_COLOURS.error}; font-weight: bold; }
.al-arrange-buttons, .al-arrange-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: var(--al-s2); }
.al-arrange-confirm[hidden] { display: none; }
.al-arrange-confirm p { margin: 0; flex: 1 1 100%; }
`;

export interface ArrangeBarActions {
  rotate(): void;
  undo(): void;
  /** Called after the user confirmed. */
  reset(): void;
  done(): void;
}

export interface ArrangeBar {
  readonly element: HTMLElement;
  update(view: ArrangeView): void;
}

/**
 * The tool bar of arrange mode, at the bottom of the stage: what is selected and where, the latest answer (green, or red
 * with the reason), and the Rotate, Undo, Reset layout and Done buttons. Reset layout asks first.
 */
export function createArrangeBar(doc: Document, host: HTMLElement, actions: ArrangeBarActions): ArrangeBar {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const button = (text: string, label: string): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "al-btn";
    b.textContent = text;
    // The visible words are the accessible name; the title only adds the hint (and the shortcut).
    b.title = label;
    return b;
  };

  const root = doc.createElement("section");
  root.className = "al-arrange";
  root.setAttribute("aria-label", "Arrange the room");
  root.hidden = true;
  const piece = doc.createElement("p");
  piece.className = "al-arrange-piece";
  const status = doc.createElement("p");
  status.className = "al-arrange-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const rotate = button("Rotate (R)", "Turn the selected piece a quarter turn (R)");
  rotate.addEventListener("click", () => actions.rotate());
  const undo = button("Undo", "Undo the last move (Ctrl+Z)");
  undo.addEventListener("click", () => actions.undo());
  const reset = button("Reset layout", "Put every piece back where the template has it");
  const done = button("Done", "Leave arrange mode (Esc)");
  done.addEventListener("click", () => actions.done());
  const buttons = doc.createElement("div");
  buttons.className = "al-arrange-buttons";
  buttons.append(rotate, undo, reset, done);

  const confirm = doc.createElement("div");
  confirm.className = "al-arrange-confirm";
  confirm.hidden = true;
  confirm.setAttribute("role", "alertdialog");
  confirm.setAttribute("aria-label", "Reset the layout");
  const question = doc.createElement("p");
  question.textContent = "Put every piece back where the template has it? Your arrangement of this floor is lost.";
  const yes = button("Yes, reset", "Reset the layout");
  const no = button("Keep my layout", "Cancel");
  confirm.append(question, yes, no);

  const ask = (asking: boolean): void => {
    confirm.hidden = !asking;
    buttons.hidden = asking;
    if (asking) no.focus();
    else reset.focus();
  };
  reset.addEventListener("click", () => ask(true));
  no.addEventListener("click", () => ask(false));
  yes.addEventListener("click", () => {
    ask(false);
    actions.reset();
  });

  root.append(piece, status, buttons, confirm);
  host.appendChild(root);

  return {
    element: root,
    update(view) {
      root.hidden = !view.active;
      if (!view.active) {
        confirm.hidden = true;
        buttons.hidden = false;
        return;
      }
      piece.textContent = view.piece && view.where ? `${view.piece}: ${view.where}` : "Nothing selected";
      status.textContent = view.status;
      status.dataset["tone"] = view.tone;
      rotate.disabled = !view.canRotate;
      undo.disabled = !view.canUndo;
      reset.disabled = view.busy;
      done.disabled = false;
      root.dataset["busy"] = String(view.busy);
    },
  };
}
