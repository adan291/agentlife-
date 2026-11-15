import { BUG_NOTE_MAX } from "@agentlife/shared";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-bugform { position: absolute; z-index: 25; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100% - var(--al-s4))); max-height: calc(100% - var(--al-s4)); overflow: auto; box-sizing: border-box; padding: var(--al-s3) var(--al-s4); background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); font: var(--al-font, 14px)/1.5 monospace; }
.al-bugform[hidden] { display: none; }
.al-bugform h3 { margin: 0 0 var(--al-s2); color: ${UI_COLOURS.accentText}; }
.al-bugform label { display: block; margin: var(--al-s2) 0; }
.al-bugform textarea { display: block; width: 100%; box-sizing: border-box; margin-top: var(--al-s1); padding: var(--al-s1); font: inherit; resize: vertical; }
.al-bugform .al-bugform-check { display: flex; align-items: center; gap: var(--al-s2); }
.al-bugform input[type="checkbox"] { cursor: pointer; }
.al-bugform input[type="checkbox"]:disabled { cursor: default; }
.al-bugform .al-bugform-row { display: flex; justify-content: flex-end; gap: var(--al-s2); margin-top: var(--al-s3); }
.al-bugform .al-bugform-count { color: ${UI_COLOURS.muted}; }
`;

export interface BugFormActions {
  /**
   * Takes the picture of the room. Called when the form opens, so the picture shows what the user was looking at. Resolves to
   * a handle for `submit` (the base64 of a PNG), or undefined when no picture can be taken.
   */
  capture(): Promise<string | undefined>;
  /** The user saved: the note (trimmed, may be empty) and the picture, when they kept it attached. */
  submit(note: string, screenshot: string | undefined): void;
}

export interface BugForm {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/** The first line of a note as the message of a manual report, or a fixed text when the note is empty. */
export function manualMessage(note: string): string {
  const first = note.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  return first === "" ? "Bug reported by hand" : first.slice(0, 200);
}

/**
 * The Report a bug form (spec bug-sack): a note of up to 500 characters and a checkbox "Attach a screenshot of the room",
 * on by default. The picture is taken when the form opens. Esc and Cancel close it; Save hands the note and the picture to
 * `submit`. It is a small dialog over the stage, not one of the server's panels.
 */
export function createBugForm(doc: Document, host: HTMLElement, actions: BugFormActions): BugForm {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const root = doc.createElement("form");
  root.className = "al-bugform";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Report a bug");
  const title = doc.createElement("h3");
  title.textContent = "Report a bug";

  const noteLabel = doc.createElement("label");
  noteLabel.textContent = "What went wrong?";
  const note = doc.createElement("textarea");
  note.className = "al-input";
  note.rows = 5;
  note.maxLength = BUG_NOTE_MAX;
  note.placeholder = "A short note. It stays on this computer.";
  note.setAttribute("aria-label", "What went wrong?");
  noteLabel.appendChild(note);
  const count = doc.createElement("div");
  count.className = "al-bugform-count";
  count.setAttribute("aria-hidden", "true");

  const check = doc.createElement("label");
  check.className = "al-bugform-check";
  const box = doc.createElement("input");
  box.type = "checkbox";
  box.checked = true;
  const checkText = doc.createElement("span");
  checkText.textContent = "Attach a screenshot of the room";
  check.append(box, checkText);

  const row = doc.createElement("div");
  row.className = "al-bugform-row";
  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = "al-btn";
  cancel.textContent = "Cancel";
  const save = doc.createElement("button");
  save.type = "submit";
  save.className = "al-btn";
  save.textContent = "Save bug";
  row.append(cancel, save);
  root.append(title, noteLabel, count, check, row);
  host.appendChild(root);

  let opened = false;
  let shot: string | undefined;
  /** Bumped by every open: a picture that arrives for an older form is dropped. */
  let generation = 0;

  const refreshCount = (): void => {
    count.textContent = `${note.value.length} / ${BUG_NOTE_MAX}`;
  };
  note.addEventListener("input", refreshCount);

  const close = (): void => {
    if (!opened) return;
    opened = false;
    root.hidden = true;
    shot = undefined;
    generation += 1;
  };

  const open = (): void => {
    if (opened) return;
    opened = true;
    generation += 1;
    const mine = generation;
    shot = undefined;
    note.value = "";
    refreshCount();
    box.checked = true;
    box.disabled = true;
    checkText.textContent = "Taking a picture of the room…";
    root.hidden = false;
    note.focus();
    actions
      .capture()
      .catch(() => undefined)
      .then((png) => {
        if (mine !== generation) return;
        shot = png;
        box.disabled = png === undefined;
        box.checked = png !== undefined;
        checkText.textContent = png === undefined ? "No screenshot could be taken" : "Attach a screenshot of the room";
      });
  };

  root.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!opened) return;
    const text = note.value.trim().slice(0, BUG_NOTE_MAX);
    const picture = box.checked ? shot : undefined;
    close();
    actions.submit(text, picture);
  });
  cancel.addEventListener("click", close);
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    // Nothing else (a panel, arrange mode) may react to this Esc.
    e.stopPropagation();
    close();
  });

  return {
    element: root,
    open,
    close,
    get isOpen() {
      return opened;
    },
  };
}
