import { UI_COLOURS } from "./theme.ts";

/** Doors: `open` (nothing shown), `closing`, `closed` (waiting for the new floor), `opening`. */
export type DoorPhase = "open" | "closing" | "closed" | "opening";

export const DOOR_CLOSE_MS = 350;
export const DOOR_HOLD_MS = 250;
export const DOOR_OPEN_MS = 400;
/** The doors open again after this long even if the new floor never arrives (error, lost connection). */
export const DOOR_GIVE_UP_MS = 4000;

export interface DoorTimers {
  now(): number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export interface DoorOptions {
  timers: DoorTimers;
  /** True: no animation at all, the floor changes at once. */
  reducedMotion(): boolean;
  onPhase(phase: DoorPhase): void;
}

/**
 * The sequence of a floor change: doors close, the floor indicator shows, doors open. Pure logic over injected timers,
 * so it is tested without a DOM. `begin` starts closing when the user picks a floor; `arrive` runs when the new
 * floor's `welcome` comes (also for a door in the lobby, where `begin` was never called); `abort` opens again when
 * the server refused.
 */
export class DoorSequence {
  private phase: DoorPhase = "open";
  private closedAt = 0;
  private cancel: (() => void) | undefined;
  private giveUp: (() => void) | undefined;
  private readonly opts: DoorOptions;

  constructor(opts: DoorOptions) {
    this.opts = opts;
  }

  get current(): DoorPhase {
    return this.phase;
  }

  /** The user chose a floor: close the doors and wait for the answer. */
  begin(): void {
    if (this.opts.reducedMotion() || this.phase === "closing" || this.phase === "closed") return;
    this.clearTimers();
    this.closedAt = this.opts.timers.now() + DOOR_CLOSE_MS;
    this.set("closing");
    this.cancel = this.opts.timers.after(DOOR_CLOSE_MS, () => this.set("closed"));
    this.giveUp = this.opts.timers.after(DOOR_GIVE_UP_MS, () => this.open());
  }

  /** The new floor is there: show its indicator, then open. */
  arrive(): void {
    if (this.opts.reducedMotion()) return;
    this.clearTimers();
    // Doors that were not closing yet (a door in the lobby) snap shut first.
    const wait = this.phase === "closing" ? Math.max(0, this.closedAt - this.opts.timers.now()) : 0;
    const hold = () => {
      this.set("closed");
      this.cancel = this.opts.timers.after(DOOR_HOLD_MS, () => this.open());
    };
    if (wait > 0) this.cancel = this.opts.timers.after(wait, hold);
    else hold();
  }

  /** The server refused or nothing came: open the doors again on the same floor. */
  abort(): void {
    if (this.phase === "open" || this.phase === "opening") return;
    this.open();
  }

  private open(): void {
    this.clearTimers();
    this.set("opening");
    this.cancel = this.opts.timers.after(DOOR_OPEN_MS, () => this.set("open"));
  }

  private set(phase: DoorPhase): void {
    this.phase = phase;
    this.opts.onPhase(phase);
  }

  private clearTimers(): void {
    this.cancel?.();
    this.giveUp?.();
    this.cancel = undefined;
    this.giveUp = undefined;
  }
}

const CSS = `
.al-doors { position: absolute; inset: 0; z-index: 40; display: none; overflow: hidden; }
.al-doors[data-phase="closing"], .al-doors[data-phase="closed"], .al-doors[data-phase="opening"] { display: block; }
.al-doors[data-phase="closing"], .al-doors[data-phase="closed"] { pointer-events: auto; }
.al-doors[data-phase="opening"] { pointer-events: none; }
.al-door { position: absolute; top: 0; bottom: 0; width: 50%; background: ${UI_COLOURS.panelBg}; border: 0 solid var(--al-accent); box-sizing: border-box; transition: transform ${DOOR_CLOSE_MS}ms ease-in; }
.al-door-l { left: 0; border-right-width: 2px; transform: translateX(-100%); }
.al-door-r { right: 0; border-left-width: 2px; transform: translateX(100%); }
.al-doors[data-phase="closing"] .al-door, .al-doors[data-phase="closed"] .al-door { transform: translateX(0); }
.al-doors[data-phase="opening"] .al-door { transition-duration: ${DOOR_OPEN_MS}ms; transition-timing-function: ease-out; }
.al-doors[data-phase="opening"] .al-door-l { transform: translateX(-100%); }
.al-doors[data-phase="opening"] .al-door-r { transform: translateX(100%); }
.al-doors-sign { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: ${UI_COLOURS.accentText}; font: bold calc(var(--al-font, 14px) * 2)/1.3 monospace; opacity: 0; transition: opacity ${DOOR_CLOSE_MS}ms; }
.al-doors-sign small { display: block; font-size: var(--al-font, 14px); font-weight: normal; color: ${UI_COLOURS.text}; }
.al-doors[data-phase="closed"] .al-doors-sign { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .al-door, .al-doors-sign { transition: none; } }
`;

export interface Transition {
  /** The user chose a floor: the doors close on its indicator. */
  begin(floorTag: string, floorName: string): void;
  /** The floor's `welcome` arrived (also a door in the lobby): show its indicator, then open. */
  arrive(floorTag: string, floorName: string): void;
  /** The server refused: open again. */
  abort(): void;
  readonly phase: DoorPhase;
}

/** The doors overlay on the stage. It blocks clicks while it covers the room. Under reduced motion it never shows. */
export function createTransition(host: HTMLElement, reducedMotion: () => boolean): Transition {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "al-doors";
  root.dataset["phase"] = "open";
  root.setAttribute("aria-hidden", "true");
  const left = document.createElement("div");
  left.className = "al-door al-door-l";
  const right = document.createElement("div");
  right.className = "al-door al-door-r";
  const sign = document.createElement("div");
  sign.className = "al-doors-sign";
  const tag = document.createElement("span");
  const name = document.createElement("small");
  sign.append(tag, name);
  root.append(left, right, sign);
  host.appendChild(root);

  const seq = new DoorSequence({
    reducedMotion,
    timers: {
      now: () => Date.now(),
      after: (ms, fn) => {
        const h = window.setTimeout(fn, ms);
        return () => window.clearTimeout(h);
      },
    },
    onPhase: (phase) => {
      root.dataset["phase"] = phase;
    },
  });
  const show = (floorTag: string, floorName: string) => {
    tag.textContent = floorTag;
    name.textContent = floorName;
  };

  return {
    begin: (floorTag, floorName) => {
      show(floorTag, floorName);
      seq.begin();
    },
    arrive: (floorTag, floorName) => {
      show(floorTag, floorName);
      seq.arrive();
    },
    abort: () => seq.abort(),
    get phase() {
      return seq.current;
    },
  };
}
