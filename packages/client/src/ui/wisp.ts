const CSS = `
.al-wisp { position: absolute; z-index: 11; width: 44px; height: 44px; margin: -22px 0 0 -22px; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
.al-wisp[hidden] { display: none; }
.al-wisp:focus-visible { outline: 2px solid var(--al-accent); outline-offset: 2px; }
`;

/** Where the wisp is on the screen (from `WorldView.wispPoint`). */
export interface WispPoint {
  id: string;
  x: number;
  y: number;
}

export interface WispButton {
  readonly element: HTMLButtonElement;
  /** Follows the wisp; null hides the button. Call every frame. */
  sync(point: WispPoint | null): void;
}

/**
 * The button over the wisp. The scene is a canvas, so this is what a keyboard, a screen reader and a test can reach: it
 * sits on the wisp and follows it, and a click (or Enter) sends the catch. It has no picture of its own. One click per wisp:
 * the server answers with `wisp_gone`, which makes the scene drop the wisp and this button hide.
 */
export function createWispButton(doc: Document, host: HTMLElement, onCatch: (wispId: string) => void): WispButton {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "al-wisp";
  button.setAttribute("aria-label", "Catch the wisp");
  button.title = "Catch the wisp";
  button.hidden = true;
  host.appendChild(button);

  let id: string | null = null;
  /** The wisp this button already sent a catch for. */
  let sent: string | null = null;
  let placed = "";
  button.addEventListener("click", () => {
    if (id === null || sent === id) return;
    sent = id;
    onCatch(id);
  });

  return {
    element: button,
    sync(point) {
      if (!point) {
        id = null;
        button.hidden = true;
        return;
      }
      id = point.id;
      button.hidden = false;
      button.dataset["wisp"] = point.id;
      const at = `${Math.round(point.x)},${Math.round(point.y)}`;
      if (at === placed) return;
      placed = at;
      button.style.setProperty("left", `${Math.round(point.x)}px`);
      button.style.setProperty("top", `${Math.round(point.y)}px`);
    },
  };
}
