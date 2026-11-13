import { FURNI_CATALOG, checkMove, footprintTiles, isBoughtId, isPinned } from "@agentlife/shared";
import type { Anchor, ClientMsg, PlacedFurni, Placement, RoomDef, ShopState, Tile } from "@agentlife/shared";
import { inTextField } from "./view-mode.ts";

/**
 * Arrange mode (furni-move, task 3): the user moves and turns the furniture of a project floor.
 * This file is the whole behaviour and knows neither the DOM nor Pixi: pointer and key events come in, `furni_move`
 * and `furni_reset` messages go out, and `overlay()` / `view()` say what to draw. The rules are the shared `checkMove`,
 * so the colours on the floor agree with the server, which repeats the check (and also knows who is standing where).
 *
 * furni-shop, task 3: the same mode places bought furniture. The user takes an item out of the inventory tray
 * (`carry`), moves it over the floor (a green or red preview, checked like a move) and drops it (`furni_place`). A bought
 * piece on the floor can be moved like any other and picked up (`furni_pickup`); the pieces of the template cannot.
 */

export type Tone = "info" | "ok" | "bad";

/** An item of the inventory tray: bought and not placed. */
export interface TrayItem {
  itemId: string;
  name: string;
  defId: string;
  count: number;
}

/** What the scene draws while arranging. */
export interface ArrangeOverlay {
  /** The team's standing spots: no solid piece may cover them. Drawn so a refusal makes sense. */
  spots: Tile[];
  /** The tiles of the selected piece, where it stands now. */
  selected: Tile[];
  /** Where the piece would go; `ok` picks green or red. */
  preview: { tiles: Tile[]; ok: boolean } | null;
}

/** What the tool bar shows. */
export interface ArrangeView {
  active: boolean;
  /** Name of the selected piece, or null. */
  piece: string | null;
  /** "tile 8, 8, facing south". */
  where: string | null;
  status: string;
  tone: Tone;
  canUndo: boolean;
  canRotate: boolean;
  /** A move is on its way to the server. */
  busy: boolean;
  /** The selected piece is a bought one: it can be picked up. */
  canPickUp: boolean;
  /** Catalogue id of the item being carried from the tray, or null. */
  carrying: string | null;
  /** What the inventory tray lists (bought, not placed). */
  tray: TrayItem[];
  /** The room takes bought furniture (a project floor): the Inventory button and the tray are for it only. */
  inventory: boolean;
}

/** A key press while arranging. Arrows move one tile along the floor axes, R turns, Esc leaves, Ctrl+Z undoes. */
export type ArrangeKey = { kind: "step"; dx: number; dy: number } | { kind: "rotate" } | { kind: "leave" } | { kind: "undo" };

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
}

/** Arrow keys follow the floor's own axes (x runs down to the right on screen, y down to the left). */
export function arrangeKey(e: KeyLike): ArrangeKey | null {
  if (inTextField(e.target) || e.altKey) return null;
  const command = Boolean(e.ctrlKey || e.metaKey);
  if (command) return e.key === "z" || e.key === "Z" ? { kind: "undo" } : null;
  switch (e.key) {
    case "ArrowLeft":
      return { kind: "step", dx: -1, dy: 0 };
    case "ArrowRight":
      return { kind: "step", dx: 1, dy: 0 };
    case "ArrowUp":
      return { kind: "step", dx: 0, dy: -1 };
    case "ArrowDown":
      return { kind: "step", dx: 0, dy: 1 };
    case "r":
    case "R":
      return { kind: "rotate" };
    case "Escape":
      return { kind: "leave" };
    default:
      return null;
  }
}

/** Intents wait here while a move is on its way; a long key repeat never grows the queue past this. */
export const QUEUE_MAX = 8;
/** A move the server never answers stops blocking the tool bar after this long. */
export const ANSWER_TIMEOUT_MS = 4_000;

const FACING: Record<number, string> = { 0: "north", 2: "east", 4: "south", 6: "west" };

const HINT_NONE = "Click a piece to select it. Then drag it, or use the arrow keys. R turns it.";
const HINT_PIECE = "Drag it, or use the arrow keys. R turns it.";
const HINT_CARRY = "Move over the floor and click to place it. R turns it. Esc puts it back.";
const HINT_BOUGHT = "Drag it, or use the arrow keys. R turns it. Pick up returns it to your inventory.";
/** Room item id of the piece that is being carried, only used to run `checkMove` on a room that has it. */
const CARRY_ID = "carry_preview";

type Intent = { kind: "step"; dx: number; dy: number } | { kind: "rotate" };

type Pending =
  | { mode: "move"; itemId: string; from: Placement; to: Placement }
  | { mode: "undo"; itemId: string; entry: UndoEntry; to: Placement }
  | { mode: "place"; itemId: string; to: Placement }
  | { mode: "pickup"; itemId: string }
  | { mode: "reset" };

/** An item taken from the tray: where the pointer is (null before it has been over the floor) and which way it faces. */
interface Carrying {
  itemId: string;
  defId: string;
  name: string;
  dir: Placement["dir"];
  tile: Tile | null;
}

interface UndoEntry {
  itemId: string;
  /** Where the piece was before the move that this entry undoes. */
  back: Placement;
}

const sameSpot = (a: Placement, b: Placement): boolean => a.x === b.x && a.y === b.y && a.dir === b.dir;

export class ArrangeModel {
  private room: RoomDef | null = null;
  private active = false;
  private selected: string | null = null;
  private undoStack: UndoEntry[] = [];
  private queue: Intent[] = [];
  private pending: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private drag: { itemId: string; grabX: number; grabY: number; to: Placement } | null = null;
  private preview: { tiles: Tile[]; ok: boolean } | null = null;
  private carrying: Carrying | null = null;
  private shop: ShopState | null = null;
  private status = HINT_NONE;
  private tone: Tone = "info";
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly send: (msg: ClientMsg) => void) {}

  get isActive(): boolean {
    return this.active;
  }

  /** Project floors only; the lobby and the HR office cannot be arranged. */
  get available(): boolean {
    return this.room?.kind === "project";
  }

  get selectedId(): string | null {
    return this.selected;
  }

  /** Runs after anything the view or the overlay shows has changed. */
  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** The user is in another room (a `welcome`): everything about the old one is forgotten and arranging stops. */
  setRoom(room: RoomDef): void {
    this.room = room;
    this.reset();
    this.active = false;
    this.changed();
  }

  enter(): boolean {
    if (!this.available) return false;
    if (this.active) return true;
    this.reset();
    this.active = true;
    this.changed();
    return true;
  }

  leave(): void {
    if (!this.active) return;
    this.reset();
    this.active = false;
    this.changed();
  }

  private reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.selected = null;
    this.undoStack = [];
    this.queue = [];
    this.pending = null;
    this.drag = null;
    this.carrying = null;
    this.preview = null;
    this.say(HINT_NONE, "info");
  }

  private say(text: string, tone: Tone): void {
    this.status = text;
    this.tone = tone;
  }

  // ---- the room ----

  private piece(itemId: string): PlacedFurni | undefined {
    return this.room?.furni.find((p) => p.itemId === itemId);
  }

  private placementOf(itemId: string): Placement | undefined {
    const p = this.piece(itemId);
    return p ? { x: p.x, y: p.y, dir: p.dir } : undefined;
  }

  private tilesAt(itemId: string, to: Placement): Tile[] {
    const p = this.piece(itemId);
    const def = p ? FURNI_CATALOG[p.defId] : undefined;
    return p && def ? footprintTiles({ ...p, ...to }, def) : [];
  }

  /** The room after the server's answer (`room_layout`). */
  onLayout(furni: PlacedFurni[], anchors: Anchor[]): void {
    if (!this.room) return;
    const had = new Set(this.room.furni.map((p) => p.itemId));
    this.room = { ...this.room, furni, anchors };
    const pending = this.pending;
    this.settle();
    if (pending?.mode === "move") {
      this.undoStack.push({ itemId: pending.itemId, back: pending.from });
      this.say("Saved.", "ok");
    } else if (pending?.mode === "undo") {
      this.say("Undone.", "ok");
    } else if (pending?.mode === "place") {
      // The new piece is the one the floor did not have: select it, so the user can adjust it at once.
      this.carrying = null;
      this.selected = furni.find((p) => !had.has(p.itemId))?.itemId ?? null;
      this.say("Placed.", "ok");
    } else if (pending?.mode === "pickup") {
      this.undoStack = this.undoStack.filter((u) => u.itemId !== pending.itemId);
      this.selected = null;
      this.say("Back in your inventory.", "ok");
    } else if (pending?.mode === "reset") {
      this.undoStack = [];
      this.selected = null;
      this.say("Layout reset.", "ok");
    }
    if (this.selected !== null && !this.piece(this.selected)) this.selected = null;
    this.preview = null;
    this.changed();
    this.pump();
  }

  /** The server refused the move (`layout_error`): the room did not change. */
  onRefused(reason: string): void {
    const pending = this.pending;
    this.settle();
    this.queue = [];
    if (pending?.mode === "undo") this.undoStack.push(pending.entry);
    if (pending?.mode === "place") this.preview = this.carryPreview(pending.to, false);
    else if (pending && pending.mode !== "reset" && pending.mode !== "pickup") this.preview = { tiles: this.tilesAt(pending.itemId, pending.to), ok: false };
    else this.preview = null;
    this.say(reason, "bad");
    this.changed();
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
  }

  private awaitAnswer(pending: Pending): void {
    this.pending = pending;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.pending) return;
      const pending = this.pending;
      this.pending = null;
      this.queue = [];
      if (pending.mode === "undo") this.undoStack.push(pending.entry);
      this.preview = null;
      this.say("The hotel did not answer. Try again.", "bad");
      this.changed();
    }, ANSWER_TIMEOUT_MS);
  }

  // ---- selecting ----

  select(itemId: string | null): boolean {
    if (!this.active) return false;
    if (itemId === null) {
      this.selected = null;
      this.preview = null;
      this.say(HINT_NONE, "info");
      this.changed();
      return true;
    }
    const p = this.piece(itemId);
    const def = p ? FURNI_CATALOG[p.defId] : undefined;
    if (!p || !def) return false;
    if (isPinned(def)) {
      this.selected = null;
      this.preview = null;
      this.say("The elevator stays where it is.", "bad");
      this.changed();
      return false;
    }
    this.selected = itemId;
    this.preview = null;
    this.say(isBoughtId(itemId) ? HINT_BOUGHT : HINT_PIECE, "info");
    this.changed();
    return true;
  }

  // ---- dragging ----

  /** The pointer went down at `tile`; `itemId` is the piece under it, if any. */
  pointerDown(itemId: string | null, tile: Tile): void {
    if (!this.active || this.pending) return;
    this.drag = null;
    if (this.carrying) {
      this.carryTo(tile);
      return;
    }
    if (!this.select(itemId)) return;
    const at = itemId === null ? undefined : this.placementOf(itemId);
    if (itemId !== null && at) this.drag = { itemId, grabX: tile.x - at.x, grabY: tile.y - at.y, to: at };
  }

  pointerMove(tile: Tile): void {
    if (this.carrying && this.active) {
      if (!this.pending) this.carryTo(tile);
      return;
    }
    const d = this.drag;
    if (!d || !this.active) return;
    const at = this.placementOf(d.itemId);
    if (!at) return;
    const to: Placement = { x: tile.x - d.grabX, y: tile.y - d.grabY, dir: at.dir };
    if (sameSpot(to, d.to)) return;
    d.to = to;
    if (sameSpot(to, at)) {
      this.preview = null;
      this.say(HINT_PIECE, "info");
    } else {
      const result = this.check(d.itemId, to);
      this.preview = { tiles: this.tilesAt(d.itemId, to), ok: result.ok };
      if (result.ok) this.say("Release to put it here.", "ok");
      else this.say(result.reason, "bad");
    }
    this.changed();
  }

  pointerUp(): void {
    if (this.carrying && this.active) {
      if (!this.pending) this.drop();
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d || !this.active) return;
    const at = this.placementOf(d.itemId);
    if (at && !sameSpot(d.to, at)) this.attempt(d.itemId, d.to);
    else this.changed();
  }

  /** The pointer left the canvas: a carried item has no place to land until it is over the floor again. */
  pointerLeave(): void {
    if (!this.carrying?.tile) return;
    this.carrying.tile = null;
    this.preview = null;
    this.say(HINT_CARRY, "info");
    this.changed();
  }

  // ---- placing bought furniture (furni-shop) ----

  /** The shop as the server last sent it: the stock of the tray comes from it. */
  onShop(shop: ShopState): void {
    this.shop = shop;
    if (this.carrying && this.stockOf(this.carrying.itemId) < 1) {
      this.carrying = null;
      this.preview = null;
      this.say(HINT_NONE, "info");
    }
    this.changed();
  }

  private stockOf(itemId: string): number {
    return this.shop?.stock.find((s) => s.itemId === itemId)?.count ?? 0;
  }

  /** The items the user owns and has not placed, in catalogue order. */
  tray(): TrayItem[] {
    const shop = this.shop;
    if (!shop) return [];
    return shop.stock.flatMap((s) => {
      const item = shop.items.find((i) => i.id === s.itemId);
      return item && FURNI_CATALOG[item.defId] ? [{ itemId: item.id, name: item.name, defId: item.defId, count: s.count }] : [];
    });
  }

  /** Takes an item out of the tray. Pressing the same item again puts it back. */
  carry(itemId: string): boolean {
    if (!this.active || this.pending) return false;
    if (this.carrying?.itemId === itemId) {
      this.cancelCarry();
      return false;
    }
    const item = this.shop?.items.find((i) => i.id === itemId);
    if (!item || !FURNI_CATALOG[item.defId] || this.stockOf(itemId) < 1) return false;
    this.drag = null;
    this.selected = null;
    this.queue = [];
    this.preview = null;
    this.carrying = { itemId, defId: item.defId, name: item.name, dir: 4, tile: null };
    this.say(HINT_CARRY, "info");
    this.changed();
    return true;
  }

  /** The carried item goes back to the tray. */
  cancelCarry(): void {
    if (!this.carrying) return;
    this.carrying = null;
    this.preview = null;
    this.say(HINT_NONE, "info");
    this.changed();
  }

  /** Esc: first put down what is carried, then leave arrange mode. */
  escape(): void {
    if (this.carrying) this.cancelCarry();
    else this.leave();
  }

  private carryPlacement(): Placement | null {
    const c = this.carrying;
    return c?.tile ? { x: c.tile.x, y: c.tile.y, dir: c.dir } : null;
  }

  /** The room with the carried piece on it, and whether it may stand at `to` (the server repeats the check). */
  private carryCheck(to: Placement): { ok: true } | { ok: false; reason: string } {
    const c = this.carrying;
    if (!c || !this.room) return { ok: false, reason: "That piece is not in this room." };
    const piece: PlacedFurni = { itemId: CARRY_ID, defId: c.defId, ...to };
    const r = checkMove({ ...this.room, furni: [...this.room.furni, piece] }, CARRY_ID, to);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }

  private carryPreview(to: Placement, ok: boolean): { tiles: Tile[]; ok: boolean } | null {
    const def = this.carrying ? FURNI_CATALOG[this.carrying.defId] : undefined;
    if (!this.carrying || !def) return null;
    return { tiles: footprintTiles({ itemId: CARRY_ID, defId: this.carrying.defId, ...to }, def), ok };
  }

  /** The pointer is over `tile` while carrying: show where the piece would stand. */
  private carryTo(tile: Tile): void {
    if (!this.carrying) return;
    this.carrying.tile = { x: tile.x, y: tile.y };
    const to = this.carryPlacement()!;
    const result = this.carryCheck(to);
    this.preview = this.carryPreview(to, result.ok);
    if (result.ok) this.say("Click to place it here.", "ok");
    else this.say(result.reason, "bad");
    this.changed();
  }

  /** Asks the server to place the carried item where the preview is, when the check here passes. */
  private drop(): void {
    const c = this.carrying;
    const to = this.carryPlacement();
    if (!c || !to) return;
    const result = this.carryCheck(to);
    if (!result.ok) {
      this.preview = this.carryPreview(to, false);
      this.say(result.reason, "bad");
      this.changed();
      return;
    }
    this.preview = this.carryPreview(to, true);
    this.say("Placing…", "info");
    this.awaitAnswer({ mode: "place", itemId: c.itemId, to });
    this.send({ type: "furni_place", itemId: c.itemId, ...to });
    this.changed();
  }

  /** The selected piece must be a bought one. The pieces of the template stay on the floor. */
  get canPickUp(): boolean {
    return this.active && this.selected !== null && isBoughtId(this.selected) && !this.pending && !this.carrying;
  }

  /** Takes the selected bought piece back into the inventory. */
  pickUp(): void {
    if (!this.canPickUp || this.selected === null) return;
    const itemId = this.selected;
    this.queue = [];
    this.preview = null;
    this.say("Picking up…", "info");
    this.awaitAnswer({ mode: "pickup", itemId });
    this.send({ type: "furni_pickup", itemId });
    this.changed();
  }

  // ---- moving ----

  private check(itemId: string, to: Placement): { ok: true } | { ok: false; reason: string } {
    if (!this.room) return { ok: false, reason: "That piece is not in this room." };
    const r = checkMove(this.room, itemId, to);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }

  /** Checks the move here (the colours and the reason come at once) and asks the server when it passes. */
  private attempt(itemId: string, to: Placement): boolean {
    const from = this.placementOf(itemId);
    if (!from) return false;
    const result = this.check(itemId, to);
    if (!result.ok) {
      this.queue = [];
      this.preview = { tiles: this.tilesAt(itemId, to), ok: false };
      this.say(result.reason, "bad");
      this.changed();
      return false;
    }
    this.preview = { tiles: this.tilesAt(itemId, to), ok: true };
    this.say("Saving…", "info");
    this.awaitAnswer({ mode: "move", itemId, from, to });
    this.send({ type: "furni_move", itemId, ...to });
    this.changed();
    return true;
  }

  /** One tile along the floor axes. Several presses in a row wait for each other. */
  step(dx: number, dy: number): void {
    this.enqueue({ kind: "step", dx, dy });
  }

  /** Turn the selected piece a quarter turn (the next turn that fits, when one does not). A carried item turns before it is placed. */
  rotate(): void {
    if (this.carrying) {
      this.carrying.dir = ((this.carrying.dir + 2) % 8) as Placement["dir"];
      if (this.carrying.tile) this.carryTo(this.carrying.tile);
      else this.changed();
      return;
    }
    this.enqueue({ kind: "rotate" });
  }

  private enqueue(intent: Intent): void {
    if (!this.active || this.selected === null) return;
    if (this.queue.length < QUEUE_MAX) this.queue.push(intent);
    this.pump();
  }

  private pump(): void {
    if (!this.active || this.pending || this.selected === null) return;
    const intent = this.queue.shift();
    if (!intent) return;
    const at = this.placementOf(this.selected);
    if (!at) return;
    if (intent.kind === "step") {
      this.attempt(this.selected, { x: at.x + intent.dx, y: at.y + intent.dy, dir: at.dir });
      return;
    }
    this.attemptTurn(this.selected, at);
  }

  private attemptTurn(itemId: string, at: Placement): void {
    let firstRefusal: { to: Placement; reason: string } | undefined;
    for (const quarter of [2, 4, 6]) {
      const to: Placement = { ...at, dir: ((at.dir + quarter) % 8) as Placement["dir"] };
      const result = this.check(itemId, to);
      if (result.ok) {
        this.attempt(itemId, to);
        return;
      }
      firstRefusal ??= { to, reason: result.reason };
    }
    if (!firstRefusal) return;
    this.queue = [];
    this.preview = { tiles: this.tilesAt(itemId, firstRefusal.to), ok: false };
    this.say(firstRefusal.reason, "bad");
    this.changed();
  }

  // ---- undo and reset ----

  get canUndo(): boolean {
    return this.active && this.undoStack.length > 0 && !this.pending;
  }

  undo(): void {
    if (!this.canUndo) return;
    const entry = this.undoStack.pop()!;
    this.carrying = null;
    this.selected = entry.itemId;
    this.queue = [];
    this.preview = null;
    this.say("Undoing…", "info");
    this.awaitAnswer({ mode: "undo", itemId: entry.itemId, entry, to: entry.back });
    this.send({ type: "furni_move", itemId: entry.itemId, ...entry.back });
    this.changed();
  }

  /** Every piece back where the template has it. The tool bar asks for confirmation before it calls this. */
  resetLayout(): void {
    if (!this.active || this.pending) return;
    this.queue = [];
    this.carrying = null;
    this.preview = null;
    this.say("Resetting…", "info");
    this.awaitAnswer({ mode: "reset" });
    this.send({ type: "furni_reset" });
    this.changed();
  }

  // ---- what to show ----

  view(): ArrangeView {
    const c = this.carrying;
    const p = this.selected === null ? undefined : this.piece(this.selected);
    const def = p ? FURNI_CATALOG[p.defId] : undefined;
    return {
      active: this.active,
      piece: c ? c.name : def ? def.name : null,
      where: c ? (c.tile ? `tile ${c.tile.x}, ${c.tile.y}, facing ${FACING[c.dir] ?? "south"}` : `facing ${FACING[c.dir] ?? "south"}`) : p ? `tile ${p.x}, ${p.y}, facing ${FACING[p.dir] ?? "south"}` : null,
      status: this.status,
      tone: this.tone,
      canUndo: this.canUndo,
      canRotate: this.active && (c !== null || p !== undefined) && !this.pending,
      busy: this.pending !== null,
      canPickUp: this.canPickUp,
      carrying: c ? c.itemId : null,
      tray: this.tray(),
      inventory: this.room?.kind === "project",
    };
  }

  overlay(): ArrangeOverlay | null {
    if (!this.active || !this.room) return null;
    const spots = this.room.anchors.filter((a) => a.follows === undefined && a.name.startsWith("home_")).map((a) => ({ x: a.x, y: a.y }));
    const at = this.selected === null ? undefined : this.placementOf(this.selected);
    return { spots, selected: this.selected !== null && at ? this.tilesAt(this.selected, at) : [], preview: this.preview };
  }
}
