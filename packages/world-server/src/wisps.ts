import { WISPS_PER_DAY, WISP_GRACE_MS, WISP_LIFE_MS, WISP_MAX_MS, WISP_MIN_MS, WISP_TASK_ID_MAX, nextWispRef, wispsToday } from "@agentlife/shared";
import type { GrantReason, LedgerEntry, Tile } from "@agentlife/shared";

/** What the wisp rules read from the wallet: the grants already counted and the ledger of the latest entries. */
export interface WispWallet {
  hasGranted(reason: GrantReason, ref: string): boolean;
  readonly ledger: readonly LedgerEntry[];
}

export interface WispOptions {
  /** A wisp is tried every `minMs` to `maxMs` (a random time in between). */
  minMs?: number;
  maxMs?: number;
  /** How long a wisp lives, and how late a click that was sent in time may still arrive. */
  lifeMs?: number;
  graceMs?: number;
  /** Random number in [0, 1). */
  random?: () => number;
  now?: () => number;
}

/** The wisp that is on the user's floor. */
export interface Wisp {
  id: string;
  roomId: string;
  taskId: string;
  x: number;
  y: number;
  /** Epoch ms after which a click is no longer a catch (the grace comes on top). */
  expiresAt: number;
}

/** Where the user is, as the gateway sees it. */
export interface WispSpot {
  /** Room of the user, undefined when nobody is connected. */
  roomId: string | undefined;
  /** Job that runs on that floor now, undefined when none. */
  taskId: string | undefined;
}

export type TakeResult = { ok: true; ref: string; wisp: Wisp } | { ok: false };

/**
 * The rules of wisp catching (waiting-fun task 1). It owns the one wisp that can exist and nothing else: no timers, no
 * sockets, no files. The gateway asks it to spawn every 20 to 60 s and hands it every click; the wallet is the memory of
 * the limits (the catches of a job are `<taskId>.1` to `<taskId>.10`, the catches of the day are the ledger's entries).
 */
export class Wisps {
  private wisp: Wisp | undefined;
  private seq = 0;
  private readonly wallet: WispWallet;
  private readonly minMs: number;
  private readonly maxMs: number;
  private readonly lifeMs: number;
  private readonly graceMs: number;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(wallet: WispWallet, options: WispOptions = {}) {
    this.wallet = wallet;
    this.minMs = options.minMs ?? WISP_MIN_MS;
    this.maxMs = Math.max(this.minMs, options.maxMs ?? WISP_MAX_MS);
    this.lifeMs = options.lifeMs ?? WISP_LIFE_MS;
    this.graceMs = options.graceMs ?? WISP_GRACE_MS;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** The wisp that exists now (it may be past its life: `sweep` drops it), or undefined. */
  get current(): Wisp | undefined {
    return this.wisp;
  }

  get life(): number {
    return this.lifeMs;
  }

  /** How long the server keeps a wisp: its life, the grace for a click on its way, and a few ms so the click wins a tie. */
  get holdMs(): number {
    return this.lifeMs + this.graceMs + 25;
  }

  /** Time to the next try: a random time between the two limits. */
  nextDelay(): number {
    return Math.round(this.minMs + this.random() * (this.maxMs - this.minMs));
  }

  /** True when a catch of this job would still pay: the job has not reached its limit and neither has the day. */
  canPay(taskId: string): boolean {
    if (taskId.length > WISP_TASK_ID_MAX) return false;
    if (wispsToday(this.wallet.ledger, this.now()) >= WISPS_PER_DAY) return false;
    return nextWispRef(taskId, (ref) => this.wallet.hasGranted("wisp_caught", ref)) !== undefined;
  }

  /**
   * Makes a wisp on a free tile of the user's floor, when one may exist: the user is on a floor whose job runs, none is
   * there (or the old one is over), and a catch would still pay. Returns it, or undefined when nothing was made.
   */
  spawn(spot: WispSpot, tiles: readonly Tile[]): Wisp | undefined {
    const { roomId, taskId } = spot;
    if (roomId === undefined || taskId === undefined || tiles.length === 0) return undefined;
    this.sweep();
    if (this.wisp) return undefined;
    if (!this.canPay(taskId)) return undefined;
    const tile = tiles[Math.min(tiles.length - 1, Math.floor(this.random() * tiles.length))]!;
    this.wisp = { id: `wisp-${++this.seq}`, roomId, taskId, x: tile.x, y: tile.y, expiresAt: this.now() + this.lifeMs };
    return this.wisp;
  }

  /**
   * A click on the wisp `id`. The wisp is used up whether or not the grant that follows is written, so a second click on it
   * finds nothing. Refused (`ok: false`, nothing paid) when there is no such wisp, it is past its life and grace, the user
   * is on another floor or the job is not the one it appeared for, or a limit is reached.
   */
  take(id: string, spot: WispSpot): TakeResult {
    const wisp = this.wisp;
    if (!wisp || wisp.id !== id) return { ok: false };
    if (this.now() > wisp.expiresAt + this.graceMs) {
      this.wisp = undefined;
      return { ok: false };
    }
    if (spot.roomId !== wisp.roomId || spot.taskId !== wisp.taskId) return { ok: false };
    if (taskIdTooLong(wisp.taskId) || wispsToday(this.wallet.ledger, this.now()) >= WISPS_PER_DAY) return { ok: false };
    const ref = nextWispRef(wisp.taskId, (r) => this.wallet.hasGranted("wisp_caught", r));
    if (ref === undefined) return { ok: false };
    this.wisp = undefined;
    return { ok: true, ref, wisp };
  }

  /** Drops the wisp when it is past its life and grace. Returns it when it was dropped. */
  sweep(): Wisp | undefined {
    const wisp = this.wisp;
    if (!wisp || this.now() <= wisp.expiresAt + this.graceMs) return undefined;
    this.wisp = undefined;
    return wisp;
  }

  /** Drops the wisp whatever its age (the user left the floor, the job ended). Returns it when there was one. */
  clear(): Wisp | undefined {
    const wisp = this.wisp;
    this.wisp = undefined;
    return wisp;
  }
}

function taskIdTooLong(taskId: string): boolean {
  return taskId.length > WISP_TASK_ID_MAX;
}
