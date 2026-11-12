import { UI_COLOURS } from "./theme.ts";

/** Whether the night window is open and when it is, from the world-server's `night_clock` message. */
export interface NightClock {
  open: boolean;
  /** "HH:MM", local time of the machine that runs the engine. */
  start: string;
  end: string;
}

/** "03:12", 24 hours, from the browser's clock. */
export function clockText(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** The text of the moon clock in the top bar: the time and when the shift ends. */
export function moonClockLabel(clock: NightClock, now: Date): string {
  return `☾ ${clockText(now)} · night shift until ${clock.end}`;
}

const CSS = `
.al-night-veil { position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: 0; background: radial-gradient(ellipse at 50% 55%, rgba(18, 14, 52, 0.2) 0%, rgba(6, 4, 24, 0.5) 100%); transition: opacity 1.5s ease; }
.al-night-veil[data-night="true"] { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .al-night-veil { transition: none; } }
.al-moon { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${UI_COLOURS.accentText}; font: var(--al-font, 14px)/1.4 monospace; }
.al-moon[hidden] { display: none; }
.al-shell[data-compact="true"] .al-moon { display: none; }
`;

export interface NightLook {
  /** The window opened or closed (or the clock was refreshed). */
  set(clock: NightClock): void;
  /** True while the night look is on. */
  readonly on: boolean;
}

/** How often the moon clock re-reads the time while the night look is on. */
export const MOON_TICK_MS = 20_000;

/**
 * The night look of the page (night-shift, requirement 5.1): a dark veil over the stage that fades in and out, and a moon
 * clock in the top bar. The candles on working desks belong to the scene (`DeskCandle`). The veil sits under every
 * panel and label and never takes a click. With reduced motion it switches without a fade.
 */
export function createNightLook(stage: HTMLElement, topBar: HTMLElement, now: () => Date = () => new Date()): NightLook {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const veil = document.createElement("div");
  veil.className = "al-night-veil";
  veil.setAttribute("aria-hidden", "true");
  veil.dataset["night"] = "false";
  stage.appendChild(veil);

  const moon = document.createElement("span");
  moon.className = "al-moon";
  moon.setAttribute("role", "status");
  moon.hidden = true;
  topBar.appendChild(moon);

  let clock: NightClock | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const refresh = (): void => {
    if (!clock?.open) return;
    const label = moonClockLabel(clock, now());
    moon.textContent = label;
    moon.title = `The night shift is working until ${clock.end}`;
    moon.setAttribute("aria-label", label);
  };

  return {
    get on() {
      return clock?.open === true;
    },
    set(next) {
      clock = next;
      veil.dataset["night"] = String(next.open);
      moon.hidden = !next.open;
      clearInterval(timer);
      timer = undefined;
      if (next.open) {
        refresh();
        timer = setInterval(refresh, MOON_TICK_MS);
      } else {
        moon.textContent = "";
      }
    },
  };
}
