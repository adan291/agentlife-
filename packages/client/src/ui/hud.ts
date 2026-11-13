import type { ConnectionStatus } from "../transport.ts";
import { FONT_MAX, FONT_MIN, UI_COLOURS } from "./theme.ts";
import { createMenu } from "./menu.ts";
import { isEditKey, isHelpKey, isNarrow, menuItems } from "./menu-model.ts";
import type { EditButtonState, MenuItemId } from "./menu-model.ts";
import { inTextField, isPaletteKey, isViewKey } from "./view-mode.ts";
import { balanceText } from "./wallet.ts";
import type { ViewMode } from "./view-mode.ts";

const CSS = `
.al-hud { font: var(--al-font, 14px)/1.4 monospace; color: ${UI_COLOURS.text}; }
.al-status { display: flex; align-items: center; min-width: 0; background: ${UI_COLOURS.inputBg}; border: 1px solid var(--al-border); border-radius: var(--al-radius); padding: var(--al-s1) var(--al-s3); white-space: nowrap; }
.al-status[hidden] { display: none; }
.al-status > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.al-status[data-status="reconnecting"] { border-color: var(--al-accent); color: ${UI_COLOURS.accentText}; }
.al-notice { background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s1) var(--al-s3); color: ${UI_COLOURS.accentText}; box-shadow: var(--al-shadow); }
.al-notice[hidden] { display: none; }
.al-floor-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${UI_COLOURS.accentText}; font-weight: bold; }
.al-floor-label[hidden] { display: none; }
.al-shell[data-compact="true"] .al-floor-label { display: none; }
.al-top-collapsible { display: flex; align-items: center; gap: var(--al-s2); }
/* The bar is tight: its buttons use a narrower side padding so the job stepper keeps its labels at 1366 px. */
.al-top-right .al-btn { padding: var(--al-s1) var(--al-s2); }
.al-top-right[data-narrow="true"] .al-top-collapsible { display: none; }
.al-chips { display: flex; align-items: center; gap: var(--al-s1); }
.al-balance { padding: var(--al-s1) var(--al-s2); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-border); border-radius: var(--al-radius); font-weight: bold; white-space: nowrap; color: ${UI_COLOURS.accentText}; }
.al-level { padding: var(--al-s1) var(--al-s2); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-border); border-radius: var(--al-radius); font: inherit; font-weight: bold; white-space: nowrap; color: ${UI_COLOURS.accentText}; cursor: pointer; }
.al-level:hover, .al-level:focus-visible { border-color: var(--al-accent); }
.al-balance[hidden], .al-level[hidden] { display: none; }
.al-view-toggle { display: inline-flex; gap: var(--al-s2); }
.al-view-toggle > span { color: ${UI_COLOURS.muted}; }
.al-view-toggle[data-view="hotel"] > [data-for="hotel"], .al-view-toggle[data-view="list"] > [data-for="list"] { color: ${UI_COLOURS.accentText}; font-weight: bold; text-decoration: underline; text-underline-offset: 3px; }
.al-edit[aria-pressed="true"] { background: ${UI_COLOURS.accent}; color: ${UI_COLOURS.inputBg}; border-color: ${UI_COLOURS.accent}; font-weight: bold; }
.al-edit[aria-pressed="true"]:hover:not(:disabled) { background: ${UI_COLOURS.accentText}; color: ${UI_COLOURS.inputBg}; }
.al-toast { position: absolute; z-index: 12; bottom: var(--al-s4); left: 50%; transform: translateX(-50%); max-width: calc(100% - var(--al-s4)); background: ${UI_COLOURS.panelBg}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s2) var(--al-s4); box-shadow: var(--al-shadow); opacity: 0; transition: opacity 0.2s; pointer-events: none; }
.al-toast[data-show="true"] { opacity: 1; }
`;

/** Text size controls (A− / A+), in the Menu. `size` tells when the limits are reached. */
export interface FontControls {
  readonly size: number;
  smaller(): void;
  bigger(): void;
}

/** Where the HUD parts live: the top bar slots and the stage. */
export interface HudMounts {
  /** Connection status and floor name go here, after the title. */
  left: HTMLElement;
  /** Elevator, view toggle, Edit room, chips and Menu. */
  right: HTMLElement;
  /** Persistent notice (below the top bar) and transient toast (bottom). */
  banners: HTMLElement;
  stage: HTMLElement;
}

/** What the controls do. Each one is called from a button, from the Menu and (where there is one) from its key. */
export interface HudActions {
  zoom(): void;
  help(): void;
  useHere(): void;
  elevator(): void;
  /** The hotel / list toggle. */
  view(): void;
  /** The command palette. */
  palette(): void;
  /** Edit room or Done. `fromKey` is true for the E key: it may be ignored while something else owns the keyboard. */
  edit(fromKey: boolean): void;
  /** Opens the Profile panel. */
  profile(): void;
}

export interface Hud {
  setStatus(status: ConnectionStatus): void;
  setZoomLabel(zoom: number): void;
  /** The Ecto balance, in the top bar. `null` hides it (no economy: the recorded demo, the scripted engine). */
  setBalance(balance: number | null): void;
  /** The user's level, next to the balance ("Lv 3"); a button that opens the Profile panel. `null` hides it (no progress: the recorded demo, the scripted engine). */
  setLevel(text: string | null, title?: string): void;
  toast(text: string, ms?: number): void;
  /** Persistent line at the top of the stage (null hides it). */
  setNotice(text: string | null): void;
  /** Name of the floor the user is on, in the top bar. */
  setFloor(name: string): void;
  /** Text of the Elevator shortcut (it counts the floors that wait for the user). */
  setElevatorLabel(label: string, title?: string): void;
  /** The view in use; the toggle highlights it. */
  setView(view: ViewMode): void;
  /** The Edit room button: its words, whether it is pressed and whether it can be used. */
  setEdit(state: EditButtonState): void;
}

/** Top bar controls and stage messages: elevator, view toggle, Edit room, chips and Menu, connection status, notice and toast. */
export function createHud(mounts: HudMounts, actions: HudActions, font?: FontControls): Hud {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const button = (text: string, label?: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "al-btn";
    b.type = "button";
    b.textContent = text;
    if (label) {
      b.title = label;
      b.setAttribute("aria-label", label);
    }
    return b;
  };

  // What the Menu needs to list its items; kept in step by the setters below.
  let zoomValue = 1;
  let viewValue: ViewMode = "hotel";
  let edit: EditButtonState = { text: "Edit room", pressed: false, disabled: true, title: "" };
  let balanceValue: number | null = null;
  let levelValue: string | null = null;
  let narrow = isNarrow(window.innerWidth);

  const elevator = button("Elevator", "Take the elevator to another floor");
  elevator.addEventListener("click", actions.elevator);
  mounts.right.appendChild(elevator);

  const collapsible = document.createElement("div");
  collapsible.className = "al-top-collapsible";
  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.className = "al-btn al-view-toggle";
  for (const v of ["hotel", "list"] as const) {
    const word = document.createElement("span");
    word.dataset["for"] = v;
    word.textContent = v === "hotel" ? "Hotel" : "List";
    viewButton.appendChild(word);
  }
  viewButton.addEventListener("click", actions.view);
  const editButton = button("Edit room");
  editButton.classList.add("al-edit");
  editButton.setAttribute("aria-pressed", "false");
  editButton.addEventListener("click", () => actions.edit(false));

  const balance = document.createElement("span");
  balance.className = "al-hud al-balance";
  balance.hidden = true;
  balance.setAttribute("role", "status");
  const balanceNum = document.createElement("span");
  const balanceWord = document.createElement("span");
  balanceWord.textContent = " Ecto";
  balance.append(balanceNum, balanceWord);
  const level = document.createElement("button");
  level.type = "button";
  level.className = "al-hud al-level";
  level.hidden = true;
  level.addEventListener("click", actions.profile);
  const chips = document.createElement("div");
  chips.className = "al-chips";
  chips.append(balance, level);
  collapsible.append(viewButton, editButton, chips);
  mounts.right.appendChild(collapsible);

  const items = () =>
    menuItems({
      narrow,
      zoom: zoomValue,
      view: viewValue,
      editing: edit.pressed,
      editable: !edit.disabled,
      balance: balanceValue,
      level: levelValue,
      fontMin: font ? font.size <= FONT_MIN : true,
      fontMax: font ? font.size >= FONT_MAX : true,
    });
  const choose = (id: MenuItemId): void => {
    switch (id) {
      case "view":
        return actions.view();
      case "edit":
        return actions.edit(false);
      case "profile":
        return actions.profile();
      case "commands":
        return actions.palette();
      case "zoom":
        return actions.zoom();
      case "text-smaller":
        return font?.smaller();
      case "text-larger":
        return font?.bigger();
      case "help":
        return actions.help();
    }
  };
  const menu = createMenu(document, { items, choose });
  mounts.right.appendChild(menu.element);

  const applyNarrow = (): void => {
    narrow = isNarrow(window.innerWidth);
    mounts.right.dataset["narrow"] = String(narrow);
    // A menu that is open lists the items of the old width.
    if (menu.isOpen) menu.close();
  };
  applyNarrow();
  window.addEventListener("resize", () => {
    if (isNarrow(window.innerWidth) !== narrow) applyNarrow();
  });

  const status = document.createElement("div");
  status.className = "al-hud al-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const statusText = document.createElement("span");
  const useHere = button("Use here");
  useHere.hidden = true;
  useHere.style.marginLeft = "var(--al-s3)";
  useHere.addEventListener("click", actions.useHere);
  status.append(statusText, useHere);
  mounts.left.appendChild(status);

  const floor = document.createElement("span");
  floor.className = "al-hud al-floor-label";
  floor.setAttribute("aria-label", "Current floor");
  floor.hidden = true;
  mounts.left.appendChild(floor);

  const notice = document.createElement("div");
  notice.className = "al-hud al-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  mounts.banners.appendChild(notice);

  const toast = document.createElement("div");
  toast.className = "al-hud al-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  mounts.stage.appendChild(toast);

  window.addEventListener("keydown", (e) => {
    if (isPaletteKey(e)) {
      // Browsers bind Ctrl+K to the address bar search.
      e.preventDefault();
      actions.palette();
      return;
    }
    if (inTextField(e.target) || menu.isOpen) return;
    if (isViewKey(e)) actions.view();
    else if (e.key === "z" || e.key === "Z") actions.zoom();
    else if (isEditKey(e, inTextField)) actions.edit(true);
    else if (isHelpKey(e, inTextField)) actions.help();
  });

  let timer: number | undefined;
  return {
    setStatus(s) {
      status.dataset["status"] = s;
      statusText.textContent =
        s === "reconnecting" ? "Reconnecting…" : s === "connecting" ? "Connecting…" : s === "replaced" ? "AGENT LIFE is open in another tab" : "";
      status.hidden = s === "open";
      useHere.hidden = s !== "replaced";
    },
    setZoomLabel(z) {
      zoomValue = z;
      // The value is not printed in the bar any more (it is in the Menu); tests and scripts read it here.
      mounts.right.dataset["zoom"] = String(z);
    },
    setNotice(text) {
      notice.hidden = text === null;
      notice.textContent = text ?? "";
    },
    setFloor(name) {
      floor.textContent = name;
      floor.title = `You are on: ${name}`;
      floor.hidden = name === "";
    },
    setElevatorLabel(label, title) {
      elevator.textContent = label;
      const t = title ?? "Take the elevator to another floor";
      elevator.title = t;
      elevator.setAttribute("aria-label", label === "Elevator" ? t : `${label}. ${t}`);
    },
    setView(view) {
      viewValue = view;
      viewButton.dataset["view"] = view;
      const text = view === "hotel" ? "Show the list of projects (L)" : "Show the hotel (L)";
      viewButton.title = text;
      viewButton.setAttribute("aria-label", text);
    },
    setEdit(state) {
      edit = state;
      editButton.textContent = state.text;
      editButton.disabled = state.disabled;
      editButton.title = state.title;
      editButton.setAttribute("aria-pressed", String(state.pressed));
      editButton.dataset["active"] = String(state.pressed);
    },
    setBalance(value) {
      balanceValue = value;
      balance.hidden = value === null;
      if (value === null) return;
      const text = balanceText(value);
      balanceNum.textContent = String(value);
      balance.title = text;
      balance.setAttribute("aria-label", text);
    },
    setLevel(text, title) {
      levelValue = text;
      level.hidden = text === null;
      if (text === null) return;
      level.textContent = text;
      level.title = title ?? text;
      level.setAttribute("aria-label", `Open your profile. ${title ?? text}`);
    },
    toast(text, ms = 2500) {
      toast.textContent = text;
      toast.dataset["show"] = "true";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        toast.dataset["show"] = "false";
      }, ms);
    },
  };
}
