import type { Command } from "./commands.ts";
import { moveSelection, rankMatches } from "./fuzzy.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-palette-wrap { position: absolute; inset: 0; z-index: 30; display: flex; justify-content: center; align-items: flex-start; padding-top: var(--al-s5); box-sizing: border-box; background: rgba(5, 4, 10, 0.55); }
.al-palette-wrap[hidden] { display: none; }
.al-palette { width: min(560px, calc(100% - var(--al-s4))); max-height: calc(100% - var(--al-s5)); display: flex; flex-direction: column; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; }
.al-palette-input { flex: none; margin: var(--al-s2); padding: var(--al-s2); }
.al-palette-list { list-style: none; margin: 0; padding: 0 var(--al-s2) var(--al-s2); overflow: auto; }
.al-palette-item { display: flex; justify-content: space-between; gap: var(--al-s3); padding: var(--al-s1) var(--al-s2); border-radius: var(--al-radius); cursor: pointer; }
.al-palette-item[aria-selected="true"] { background: ${UI_COLOURS.border}; color: ${UI_COLOURS.text}; outline: 1px solid var(--al-accent); }
.al-palette-key { color: ${UI_COLOURS.muted}; border: 1px solid var(--al-control); border-radius: var(--al-radius); padding: 0 var(--al-s2); }
.al-palette-empty { margin: 0; padding: var(--al-s2) var(--al-s4) var(--al-s3); color: ${UI_COLOURS.muted}; }
`;

export interface CommandPalette {
  readonly isOpen: boolean;
  /** Opens with the commands as they are now; a second call closes it (Ctrl+K again). */
  toggle(commands: () => Command[]): void;
  open(commands: () => Command[]): void;
  close(): void;
}

let counter = 0;

/**
 * The command palette: an overlay on the stage with a search field and the matching commands. Arrows move, Enter runs,
 * Esc closes. Focus goes back to where it was.
 */
export function createCommandPalette(doc: Document, host: HTMLElement): CommandPalette {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const id = `al-palette-${(counter += 1)}`;
  const wrap = doc.createElement("div");
  wrap.className = "al-palette-wrap";
  wrap.hidden = true;
  const box = doc.createElement("div");
  box.className = "al-palette";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Command palette");
  box.setAttribute("aria-modal", "true");
  const input = doc.createElement("input");
  input.type = "text";
  input.className = "al-input al-palette-input";
  input.placeholder = "Type a command";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search commands");
  input.setAttribute("aria-controls", `${id}-list`);
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("autocomplete", "off");
  const list = doc.createElement("ul");
  list.className = "al-palette-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  const empty = doc.createElement("p");
  empty.className = "al-palette-empty";
  empty.textContent = "No command matches.";
  empty.hidden = true;
  box.append(input, list, empty);
  wrap.appendChild(box);
  host.appendChild(wrap);

  let source: () => Command[] = () => [];
  let all: Command[] = [];
  let shown: Command[] = [];
  let selected = 0;
  let isOpen = false;
  let returnFocus: HTMLElement | null = null;

  const paint = (): void => {
    shown = rankMatches(all, input.value, (c) => c.title);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren(
      ...shown.map((command, i) => {
        const li = doc.createElement("li");
        li.className = "al-palette-item";
        li.id = `${id}-opt-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === selected));
        const title = doc.createElement("span");
        title.textContent = command.title;
        li.appendChild(title);
        if (command.shortcut) {
          const key = doc.createElement("kbd");
          key.className = "al-palette-key";
          key.textContent = command.shortcut;
          li.appendChild(key);
        }
        li.addEventListener("click", () => run(command));
        return li;
      }),
    );
    empty.hidden = shown.length > 0;
    if (shown.length > 0) input.setAttribute("aria-activedescendant", `${id}-opt-${selected}`);
    else input.removeAttribute("aria-activedescendant");
    list.children[selected]?.scrollIntoView?.({ block: "nearest" });
  };

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    wrap.hidden = true;
    returnFocus?.focus?.();
    returnFocus = null;
  };

  const run = (command: Command): void => {
    close();
    command.run();
  };

  input.addEventListener("input", () => {
    selected = 0;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    // Nothing typed here reaches the page's shortcuts (L, Z, Esc closing a panel behind).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      selected = moveSelection(selected, e.key === "ArrowDown" ? 1 : -1, shown.length);
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const command = shown[selected];
      if (command) run(command);
    }
  });
  // A click on the dim area outside the box closes it.
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });

  const open = (commands: () => Command[]): void => {
    if (isOpen) return;
    source = commands;
    all = source();
    returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    isOpen = true;
    input.value = "";
    selected = 0;
    wrap.hidden = false;
    paint();
    input.focus();
  };

  return {
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    toggle(commands) {
      if (isOpen) close();
      else open(commands);
    },
  };
}
