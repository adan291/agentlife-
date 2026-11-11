import { UI_COLOURS } from "./theme.ts";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectState {
  open: boolean;
  /** Option the keyboard is on while the list is open. */
  active: number;
  /** Option that is chosen. */
  selected: number;
}

export interface SelectKeyResult {
  state: SelectState;
  /** The key was used by the control (the caller calls preventDefault). */
  handled: boolean;
  /** An option was chosen with this key (index). */
  choose?: number;
  /** Escape closed the list: the caller must not let the panel behind it close too. */
  swallowEscape?: boolean;
}

/** The keyboard behaviour of the control as a pure function (the select-only combobox pattern). `count` is the number of options. */
export function selectKey(state: SelectState, key: string, count: number): SelectKeyResult {
  if (count <= 0) return { state, handled: false };
  const last = count - 1;
  if (!state.open) {
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
      return { state: { ...state, open: true, active: state.selected }, handled: true };
    }
    return { state, handled: false };
  }
  switch (key) {
    case "ArrowDown":
      return { state: { ...state, active: Math.min(last, state.active + 1) }, handled: true };
    case "ArrowUp":
      return { state: { ...state, active: Math.max(0, state.active - 1) }, handled: true };
    case "Home":
      return { state: { ...state, active: 0 }, handled: true };
    case "End":
      return { state: { ...state, active: last }, handled: true };
    case "Enter":
    case " ":
      return { state: { open: false, active: state.active, selected: state.active }, handled: true, choose: state.active };
    case "Escape":
      return { state: { ...state, open: false, active: state.selected }, handled: true, swallowEscape: true };
    case "Tab":
      // Focus leaves; the choice stays as it was.
      return { state: { ...state, open: false, active: state.selected }, handled: false };
    default:
      return { state, handled: false };
  }
}

const CSS = `
.al-select { position: relative; display: block; margin-top: var(--al-s1); }
.al-select-button { display: flex; justify-content: space-between; align-items: center; gap: var(--al-s2); width: 100%; box-sizing: border-box; padding: var(--al-s1) var(--al-s2); text-align: left; background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-control); border-radius: var(--al-radius); font: inherit; cursor: pointer; }
.al-select-button:hover { border-color: var(--al-accent); }
.al-select-button::after { content: ""; flex: none; width: 6px; height: 6px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: translateY(-2px) rotate(45deg); }
.al-select-button[aria-expanded="true"]::after { transform: translateY(2px) rotate(-135deg); }
.al-select-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-select-list { position: absolute; z-index: 5; left: 0; right: 0; top: 100%; margin: var(--al-s1) 0 0; padding: var(--al-s1) 0; list-style: none; max-height: 220px; overflow-y: auto; background: ${UI_COLOURS.inputBg}; border: 1px solid var(--al-control); border-radius: var(--al-radius); box-shadow: var(--al-shadow); }
.al-select-list[hidden] { display: none; }
.al-select-option { padding: var(--al-s1) var(--al-s2); color: ${UI_COLOURS.text}; cursor: pointer; overflow-wrap: anywhere; }
.al-select-option[data-active="true"] { background: ${UI_COLOURS.border}; }
.al-select-option[aria-selected="true"] { color: ${UI_COLOURS.accentText}; font-weight: bold; }
`;

let styled = false;
function installStyle(doc: Document): void {
  if (styled || !doc.head) return;
  styled = true;
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);
}

export interface SelectOptions {
  options: readonly SelectOption[];
  value: string;
  /** Accessible name of the control. */
  label: string;
  onChange(value: string): void;
}

let counter = 0;

/**
 * A dropdown in the colours of the theme: a button that shows the choice and a list of options. The browser's own popup
 * is white and blue and cannot be styled, so it is not used. Keyboard: arrows, Home, End, Enter, Space, Escape.
 */
export function createSelect(doc: Document, opts: SelectOptions): HTMLElement {
  installStyle(doc);
  const id = `al-select-${++counter}`;
  const root = doc.createElement("div");
  root.className = "al-select";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "al-select-button";
  button.setAttribute("role", "combobox");
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-controls", `${id}-list`);
  button.setAttribute("aria-label", opts.label);
  const text = doc.createElement("span");
  text.className = "al-select-label";
  button.appendChild(text);
  const list = doc.createElement("ul");
  list.className = "al-select-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", opts.label);
  list.hidden = true;
  root.append(button, list);

  let state: SelectState = { open: false, active: 0, selected: Math.max(0, opts.options.findIndex((o) => o.value === opts.value)) };
  const items = opts.options.map((o, i) => {
    const li = doc.createElement("li");
    li.id = `${id}-opt-${i}`;
    li.className = "al-select-option";
    li.setAttribute("role", "option");
    li.textContent = o.label;
    // The button keeps focus; a mouse press on an option must not blur it before the click.
    li.addEventListener("mousedown", (e) => e.preventDefault());
    li.addEventListener("click", () => choose(i));
    list.appendChild(li);
    return li;
  });

  const paint = () => {
    text.textContent = opts.options[state.selected]?.label ?? "";
    text.title = text.textContent;
    button.setAttribute("aria-expanded", String(state.open));
    list.hidden = !state.open;
    if (state.open) button.setAttribute("aria-activedescendant", `${id}-opt-${state.active}`);
    else button.removeAttribute("aria-activedescendant");
    items.forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === state.selected));
      li.dataset["active"] = String(state.open && i === state.active);
    });
    if (state.open) items[state.active]?.scrollIntoView?.({ block: "nearest" });
  };

  function choose(i: number): void {
    state = { open: false, active: i, selected: i };
    paint();
    const o = opts.options[i];
    if (o) opts.onChange(o.value);
    button.focus();
  }

  button.addEventListener("click", () => {
    state = state.open ? { ...state, open: false } : { ...state, open: true, active: state.selected };
    paint();
  });
  button.addEventListener("keydown", (e) => {
    const r = selectKey(state, e.key, opts.options.length);
    state = r.state;
    if (r.handled) e.preventDefault();
    if (r.swallowEscape) e.stopPropagation();
    paint();
    if (r.choose !== undefined) {
      const o = opts.options[r.choose];
      if (o) opts.onChange(o.value);
    }
  });
  button.addEventListener("blur", () => {
    if (state.open) {
      state = { ...state, open: false, active: state.selected };
      paint();
    }
  });

  paint();
  return root;
}
