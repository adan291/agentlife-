import { Container } from "pixi.js";
import type { Application, FederatedPointerEvent } from "pixi.js";
import { FURNI_CATALOG, HEIGHT_UNIT, footprintTiles, isGuestId, isPinned, screenToTile, tileToScreen } from "@agentlife/shared";
import type { AgentId, AgentState, AvatarId, ClientMsg, ErrorCode, RoomDef, ServerMsg, StaffId, Tile, TeamViewGuest, WelcomeMsg } from "@agentlife/shared";
import { FloorPeople } from "./floor-people.ts";
import { LevelUpFx } from "./levelup-fx.ts";
import { CatchFx, WispFx } from "./wisp-fx.ts";
import { ROLE_COLOURS } from "../palette.ts";
import type { RoleKey } from "../palette.ts";
import { AvatarView } from "./avatar-view.ts";
import { builderTagName, sessionLabel } from "./crew-label.ts";
import { FurniView } from "./furni-view.ts";
import { AvatarOverlay } from "./overlay.ts";
import { pickFurni } from "./pick.ts";
import { buildSigns } from "./door-signs.ts";
import { RoomView } from "./room-view.ts";
import type { SpriteProvider } from "./textures.ts";
import { chooseZoom, toggleZoom } from "./zoom.ts";
import type { Zoom } from "./zoom.ts";
import { agentTooltip, guestTooltip } from "../ui/tooltip.ts";
import { roleLabel } from "../ui/hr.ts";
import { WorkModel } from "../ui/work.ts";
import { MonitorFx } from "./monitor-fx.ts";
import { DeskCandle, FlameFx, MoteLayer, candleLit, isFlameItem } from "./ambient-fx.ts";
import { FOCUS_MS, easeToward, rootPositionFor } from "./camera.ts";
import type { Point } from "./camera.ts";
import { prefersReducedMotion } from "./glow.ts";
import { MailboxBadge } from "./mailbox-badge.ts";
import type { HoverSink } from "../ui/tooltip.ts";
import type { ArrangeOverlay } from "../ui/arrange.ts";

/** Free space kept around the room when choosing the zoom (per side). */
const FIT_MARGIN_PX = 16;

/** What the scene tells arrange mode about the pointer (the model decides what it means). */
export interface ArrangeInput {
  /** The pointer went down on `itemId` (null: on empty floor or wall) at the floor tile `tile`. */
  down(itemId: string | null, tile: Tile): void;
  move(tile: Tile): void;
  up(): void;
  /** The pointer left the canvas. */
  leave?(): void;
}

/** What the Architect says when a report arrives. */
export const REPORT_DELIVERED_TEXT = "Report delivered";

export interface WorldViewHooks {
  /** Level and stats lines of the member who stands at a spot, for its tooltip. Absent or empty: none (no progress in the hotel). */
  progressLines?(slot: StaffId): string[];
  /** Server `error` messages (no_path, rate_limited, ...). */
  onError?(code: ErrorCode, message: string): void;
  /** Receives hover targets for tooltips. */
  tooltip?: HoverSink;
  /** The automatic zoom changed (stage resized). */
  onZoomChange?(zoom: Zoom): void;
}

interface AvatarEntry {
  view: AvatarView;
  overlay: AvatarOverlay;
}

/** Where the HR ghost stands in the HR office, next to its desk. */
const HR_GHOST_TILE = { x: 7, y: 1 } as const;

/**
 * The visible world: room, furniture, avatars and their overlays, plus mouse input.
 * It consumes ServerMsgs and emits ClientMsgs; it knows nothing about sockets.
 */
export class WorldView {
  /** Scaled and centred container holding the whole scene. */
  readonly root = new Container();
  private readonly objects = new Container();
  private readonly overlays = new Container();
  private room: RoomView | null = null;
  /** Id of the room on screen (from `welcome`); a `room_layout` for another room is ignored. */
  private roomId: string | null = null;
  private furni: FurniView[] = [];
  /** Display objects of the furniture, its glow, flames, monitors and candles: what a new layout replaces. */
  private furniObjects: Container[] = [];
  /** Set while the user arranges the floor: the pointer then moves furniture instead of using it. */
  private arrangeInput: ArrangeInput | null = null;
  private dragging = false;
  private readonly avatars = new Map<AvatarId, AvatarEntry>();
  private zoomLevel: Zoom = 1;
  private zoomChosen = false;
  private models: Partial<Record<AgentId, string>> = {};
  private hoveredItem: string | null = null;
  private badge: MailboxBadge | null = null;
  private badgeCount = 0;
  private badgeDot = false;
  /** When the last report arrived; the mailbox calls for attention for a few seconds from then. */
  private mailboxAttentionSince: number | null = null;
  private reducedMotion = prefersReducedMotion();
  /** Scene point the camera is held on after a team bar click; null: room centre. */
  private focus: Point | null = null;
  private focusUntil = 0;
  private rootTarget: Point = { x: 0, y: 0 };
  private readonly agentStatus = new Map<AgentId, { state?: AgentState; text?: string | undefined }>();
  /** What each agent works on, for the tooltip (the team bar keeps its own copy). */
  private readonly work = new WorkModel();
  /** Desk monitors that light up while the agent at the desk works. */
  private readonly monitors = new Map<AgentId, MonitorFx>();
  /** Flickering halos on the lamps. */
  private flames: FlameFx[] = [];
  /** Candles on the agents' desks: lit at night while the agent works. */
  private readonly candles = new Map<AgentId, DeskCandle>();
  private night = false;
  /** Name of the team member at each desk of a project floor (`team_view`); absent: the role name. */
  private readonly seatNames = new Map<AgentId, string>();
  /** Who is on the floor besides the three desk ghosts, and who has left by the elevator (`team_view`, `agent_presence`). */
  private readonly people = new FloorPeople();
  /** The HR agent behind its desk in the HR office; decorative, not part of the simulation. */
  private hrGhost: AvatarEntry | null = null;
  /** Level-up effects that are playing, each over the ghost it was started for. */
  private levelUps: { fx: LevelUpFx; slot: StaffId }[] = [];
  /** Slow wisps drifting through the room. */
  private motes: MoteLayer | null = null;
  /** The catchable wisp (waiting-fun) and the catch effects that are playing. At most one wisp at a time. */
  private wisp: WispFx | null = null;
  private catches: CatchFx[] = [];

  constructor(
    private readonly app: Application,
    private readonly sprites: SpriteProvider,
    private readonly send: (msg: ClientMsg) => void,
    private readonly hooks: WorldViewHooks = {},
  ) {
    this.objects.sortableChildren = true;
    this.overlays.sortableChildren = true;
    this.root.addChild(this.objects, this.overlays);
    app.stage.addChild(this.root);

    app.stage.eventMode = "static";
    app.stage.hitArea = app.screen;
    app.stage.on("pointermove", (e) => this.onPointerMove(e));
    app.stage.on("pointertap", (e) => this.onPointerTap(e));
    app.stage.on("pointerdown", (e) => this.onPointerDown(e));
    app.stage.on("pointerup", () => this.onPointerUp());
    app.stage.on("pointerupoutside", () => this.onPointerUp());
    app.stage.on("pointerleave", () => {
      this.clearHover();
      this.arrangeInput?.leave?.();
    });
    app.renderer.on("resize", () => this.relayout());
  }

  get zoom(): Zoom {
    return this.zoomLevel;
  }

  /** The night window is open (night-shift): the desks of working agents get a lit candle. */
  setNight(open: boolean): void {
    this.night = open;
    this.refreshCandles();
  }

  private refreshCandles(): void {
    for (const [id, candle] of this.candles) candle.setLit(candleLit(this.night, this.agentStatus.get(id)?.state === "working"));
  }

  /** Pending approvals as a number and an unread report as a dot, above the mailbox. */
  setMailboxBadge(count: number, dot: boolean): void {
    this.badgeCount = count;
    this.badgeDot = dot;
    this.badge?.set(count, dot);
  }

  /** A report was delivered: the Architect says so, and the mailbox glows brightly and bounces for a few seconds. */
  notifyReportDelivered(now = Date.now()): void {
    this.mailboxAttentionSince = now;
    this.avatars.get("architect")?.overlay.say(REPORT_DELIVERED_TEXT, now);
  }

  /**
   * Pans the camera to an agent and pins its tooltip for 2 s (team bar click). The camera returns to
   * the room centre after `FOCUS_MS`. Returns false when the agent is not in the room.
   */
  focusAgent(id: AgentId, now = Date.now()): boolean {
    const entry = this.avatars.get(id);
    if (!entry) return false;
    this.focus = { x: entry.view.feetX, y: entry.view.feetY - 40 };
    this.focusUntil = now + FOCUS_MS;
    this.layout(false);
    const { width, height } = this.app.screen;
    this.hooks.tooltip?.pin(`agent:${id}`, width / 2 + 24, height / 2 - 30, () => this.agentTip(id), 2000);
    return true;
  }

  private agentTip(agent: StaffId) {
    const extra = this.hooks.progressLines?.(agent) ?? [];
    if (isGuestId(agent)) {
      const g = this.people.guest(agent);
      return guestTooltip(g?.name ?? "Team member", g ? roleLabel(g.role) : "Team member", g?.model, extra);
    }
    const s = this.agentStatus.get(agent);
    const tip = agentTooltip(agent, s?.state, s?.text, this.models[agent], this.work.get(agent), Date.now(), extra);
    const name = this.seatNames.get(agent);
    return name && name !== tip.title ? { ...tip, title: `${name} (${tip.title})` } : tip;
  }

  /** Plays the level-up effect over the ghost at `slot`. Returns false when that ghost is not in the room. */
  levelUp(slot: StaffId, now = Date.now()): boolean {
    if (!this.avatars.has(slot)) return false;
    const fx = new LevelUpFx(now);
    fx.container.zIndex = 1e6;
    this.overlays.addChild(fx.container);
    this.levelUps.push({ fx, slot });
    return true;
  }

  // ---- the wisp (waiting-fun) ----

  /** A wisp appeared over the floor tile (x, y). The one that was there, if any, is replaced. */
  private showWisp(id: string, x: number, y: number, ttlMs: number, now: number): void {
    if (!this.room) return;
    this.dropWisp();
    const p = tileToScreen({ x, y, z: this.room.heightmap.height(x, y) ?? 0 });
    const fx = new WispFx(id, now, ttlMs, p.sx, p.sy);
    fx.container.zIndex = 1e6;
    fx.update(now, this.reducedMotion);
    this.overlays.addChild(fx.container);
    this.wisp = fx;
  }

  /** The wisp is over. When it was caught, the catch effect plays where it was. */
  private endWisp(id: string, caught: boolean, now: number): void {
    const fx = this.wisp;
    if (!fx || fx.id !== id) return;
    if (caught) {
      const effect = new CatchFx(now, fx.x, fx.y);
      effect.container.zIndex = 1e6;
      this.overlays.addChild(effect.container);
      this.catches.push(effect);
    }
    this.dropWisp();
  }

  private dropWisp(): void {
    this.wisp?.destroy();
    this.wisp = null;
  }

  /** The wisp on the screen and where it is, in canvas pixels, for the button that catches it. Null when there is none. */
  wispPoint(): { id: string; x: number; y: number } | null {
    if (!this.wisp) return null;
    const p = this.root.toGlobal({ x: this.wisp.x, y: this.wisp.y });
    return { id: this.wisp.id, x: p.x, y: p.y };
  }

  /** The HR agent thinks while it works out a proposal (the HR desk asked it). */
  setHrThinking(thinking: boolean): void {
    if (thinking) this.hrGhost?.overlay.setState("thinking", "Working out a team");
    else this.hrGhost?.overlay.setState("idle");
  }

  setZoom(z: Zoom): void {
    this.zoomLevel = z;
    this.zoomChosen = true;
    this.focus = null;
    this.layout();
  }

  toggleZoom(): Zoom {
    this.setZoom(toggleZoom(this.zoomLevel));
    return this.zoomLevel;
  }

  handle(msg: ServerMsg, now = Date.now()): void {
    this.work.apply(msg);
    this.people.apply(msg);
    switch (msg.type) {
      case "welcome":
        this.hooks.tooltip?.hide();
        this.rebuild(msg);
        break;
      case "open_panel":
        this.hooks.tooltip?.hide();
        break;
      case "walk":
        this.avatars.get(msg.id)?.view.setWalk(msg.path, msg.msPerTile, msg.startedAt, now);
        break;
      case "face":
        this.avatars.get(msg.id)?.view.setDir(msg.dir);
        break;
      case "agent_state":
        this.agentStatus.set(msg.agentId, { state: msg.state, text: msg.text });
        this.monitors.get(msg.agentId)?.setActive(msg.state === "working");
        this.candles.get(msg.agentId)?.setLit(candleLit(this.night, msg.state === "working"));
        this.avatars.get(msg.agentId)?.overlay.setState(msg.state, msg.text);
        if (msg.agentId === "builder" && msg.state === "idle") this.avatars.get("builder")?.overlay.setName(builderTagName("Builder", null));
        break;
      case "say": {
        const entry = this.avatars.get(msg.id);
        entry?.overlay.say(msg.text, now);
        const label = msg.id === "builder" ? sessionLabel(msg.text) : null;
        if (label) entry?.overlay.setName(builderTagName("Builder", label));
        break;
      }
      case "team_view":
        this.applyTeamView(msg.members, msg.guests ?? []);
        break;
      case "agent_presence":
        // Whether the ghost is drawn follows `people` in `tick`: a ghost that left stays until it reaches the elevator.
        break;
      case "hr_suggestion":
        this.setHrThinking(false);
        break;
      case "room_layout":
        this.applyRoomLayout(msg);
        break;
      case "wisp":
        this.showWisp(msg.wispId, msg.x, msg.y, msg.ttlMs, now);
        break;
      case "wisp_gone":
        this.endWisp(msg.wispId, msg.caught, now);
        break;
      case "error":
        if (msg.code === "hr_error" || msg.code === "engine_unavailable") this.setHrThinking(false);
        this.hooks.onError?.(msg.code, msg.message);
        break;
      default:
        // Panel messages are handled by the UI layer.
        break;
    }
  }

  /** Advance animations; call once per frame. */
  tick(now: number): void {
    if (this.focus && now >= this.focusUntil) {
      this.focus = null;
      this.layout(false);
    }
    if (this.root.x !== this.rootTarget.x || this.root.y !== this.rootTarget.y) {
      const p = easeToward({ x: this.root.x, y: this.root.y }, this.rootTarget);
      this.root.position.set(p.x, p.y);
    }
    for (const f of this.furni) {
      f.update(now, f.placed.itemId === this.hoveredItem, this.reducedMotion, f.def.interaction === "mailbox" ? this.mailboxAttentionSince : null);
    }
    this.badge?.update(now, this.reducedMotion, this.mailboxAttentionSince);
    for (const m of this.monitors.values()) m.update(now, this.reducedMotion);
    for (const c of this.candles.values()) c.update(now, this.reducedMotion);
    for (const f of this.flames) f.update(now, this.reducedMotion);
    this.motes?.update(now, this.reducedMotion);
    this.levelUps = this.levelUps.filter(({ fx, slot }) => {
      const view = this.avatars.get(slot)?.view;
      const alive = view ? fx.update(now, view.feetX, view.feetY, this.reducedMotion) : false;
      if (!alive) fx.destroy();
      return alive;
    });
    // The client's own clock ends a wisp that the server's `wisp_gone` has not reached yet.
    if (this.wisp && !this.wisp.update(now, this.reducedMotion)) this.dropWisp();
    this.catches = this.catches.filter((c) => {
      const alive = c.update(now, this.reducedMotion);
      if (!alive) c.destroy();
      return alive;
    });
    for (const [id, entry] of this.avatars) {
      const { view, overlay } = entry;
      view.update(now);
      // A ghost that was let go disappears once it has reached the elevator; a spot nobody stands at shows nobody.
      if (typeof id === "string") this.setAvatarVisible(entry, this.people.isShown(id, view.walking));
      overlay.update(now, view.feetX, view.feetY);
      overlay.container.zIndex = view.feetY;
    }
    if (this.hrGhost) {
      this.hrGhost.view.update(now);
      this.hrGhost.overlay.update(now, this.hrGhost.view.feetX, this.hrGhost.view.feetY);
      this.hrGhost.overlay.container.zIndex = this.hrGhost.view.feetY;
    }
  }

  private rebuild(msg: WelcomeMsg): void {
    this.clearScene();
    this.focus = null;
    const room = new RoomView(msg.room);
    this.room = room;
    this.root.addChildAt(room.container, 0);
    this.motes = new MoteLayer(room.bounds);
    this.root.addChildAt(this.motes.container, 2);
    this.roomId = msg.roomId ?? msg.room.id;
    this.buildFurni(msg.room, room);

    this.models = msg.models ?? {};
    this.seatNames.clear();
    // A project floor writes its name over the elevator and the board.
    this.objects.addChild(buildSigns(msg.room, (x, y) => room.heightmap.height(x, y) ?? 0));
    this.agentStatus.clear();
    for (const a of msg.agents) this.agentStatus.set(a.agentId, { state: a.state, text: a.text });
    for (const a of msg.agents) this.monitors.get(a.agentId)?.setActive(a.state === "working");
    this.refreshCandles();
    const status = new Map(msg.agents.map((a) => [a.agentId, a]));
    for (const a of msg.avatars) {
      // A guest spot has no role until `team_view` says who stands there.
      const role: RoleKey = typeof a.id !== "string" ? "user" : isGuestId(a.id) ? "researcher" : a.id;
      const view = new AvatarView(a.id, role, this.sprites, { x: a.x, y: a.y }, a.dir);
      const overlay = new AvatarOverlay(a.name, ROLE_COLOURS[role], this.sprites, typeof a.id === "string" && !isGuestId(a.id));
      const s = typeof a.id === "string" && !isGuestId(a.id) ? status.get(a.id) : undefined;
      if (s) overlay.setState(s.state, s.text);
      this.objects.addChild(view.sprite);
      this.overlays.addChild(overlay.container);
      this.avatars.set(a.id, { view, overlay });
    }
    if (msg.room.kind === "hr") this.addHrGhost();

    if (!this.zoomChosen) this.chooseAutoZoom();
    this.layout();
    this.tick(Date.now());
  }

  private setAvatarVisible(entry: AvatarEntry, visible: boolean): void {
    entry.view.sprite.visible = visible;
    entry.overlay.container.visible = visible;
  }

  /** Every piece of furniture of `def`, with its glow, flames, desk monitor and candle, and the mailbox badge. */
  private buildFurni(def: RoomDef, room: RoomView): void {
    const add = (o: Container): void => {
      this.objects.addChild(o);
      this.furniObjects.push(o);
    };
    for (const placed of def.furni) {
      const z = room.heightmap.height(placed.x, placed.y) ?? 0;
      const fv = new FurniView(placed, this.sprites, z);
      this.furni.push(fv);
      add(fv.sprite);
      if (fv.glow) add(fv.glow);
      if (isFlameItem(placed.defId)) {
        const flame = new FlameFx(placed, { x: fv.sprite.x, y: fv.sprite.y }, fv.sprite.zIndex + 0.25);
        add(flame.container);
        this.flames.push(flame);
      }
      const desk = /^desk_(architect|developer|qa|builder)$/.exec(placed.itemId);
      if (desk) {
        // The monitor of an agent's desk lights up while the agent works; it sits just above the desk sprite.
        const mfx = new MonitorFx(placed, fv.def, { x: fv.sprite.x, y: fv.sprite.y }, fv.sprite.zIndex + 0.25);
        add(mfx.container);
        this.monitors.set(desk[1] as AgentId, mfx);
        const candle = new DeskCandle(placed, fv.def, { x: fv.sprite.x, y: fv.sprite.y }, fv.sprite.zIndex + 0.3);
        add(candle.container);
        this.candles.set(desk[1] as AgentId, candle);
      }
      if (fv.def.interaction === "mailbox") {
        const p = tileToScreen({ x: placed.x, y: placed.y, z });
        this.badge = new MailboxBadge(p.sx, p.sy - fv.def.height * HEIGHT_UNIT - 16);
        this.overlays.addChild(this.badge.container);
        this.badge.set(this.badgeCount, this.badgeDot);
      }
    }
  }

  /** Takes the furniture (and what hangs on it) out of the scene; the room, the signs and the avatars stay. */
  private clearFurni(): void {
    this.badge?.destroy();
    this.badge = null;
    this.hoveredItem = null;
    for (const o of this.furniObjects) o.destroy({ children: true });
    this.furniObjects = [];
    this.furni = [];
    this.monitors.clear();
    this.candles.clear();
    this.flames = [];
  }

  /** The user moved furniture (`room_layout`): the pieces and the anchors are new, the avatars and the panels stay as they are. */
  private applyRoomLayout(msg: Extract<ServerMsg, { type: "room_layout" }>): void {
    if (!this.room || msg.roomId !== this.roomId) return;
    const next: RoomDef = { ...this.room.room, furni: msg.furni, anchors: msg.anchors };
    this.room.setRoom(next);
    this.hooks.tooltip?.hide();
    this.clearFurni();
    this.buildFurni(next, this.room);
    for (const [id, monitor] of this.monitors) monitor.setActive(this.agentStatus.get(id)?.state === "working");
    this.refreshCandles();
  }

  // ---- arrange mode (furni-move) ----

  /** Pointer input goes to `input` instead of the room's normal clicks while arranging; null returns to normal. */
  setArrangeInput(input: ArrangeInput | null): void {
    this.arrangeInput = input;
    this.dragging = false;
    this.clearHover();
    if (!input) this.room?.setArrange(null);
  }

  /** Draw (or clear) the arrange overlay. */
  showArrange(overlay: ArrangeOverlay | null): void {
    this.room?.setArrange(overlay);
  }

  /** Names and models of the team members at the desks and at the standing spots (`team_view`). */
  private applyTeamView(
    members: readonly { agentId: AgentId; name: string; model?: string | undefined }[],
    guests: readonly TeamViewGuest[],
  ): void {
    for (const m of members) {
      this.seatNames.set(m.agentId, m.name);
      if (m.model) this.models[m.agentId] = m.model;
      this.avatars.get(m.agentId)?.overlay.setName(m.name);
    }
    for (const g of guests) {
      const entry = this.avatars.get(g.guestId);
      if (!entry) continue;
      entry.view.role = g.role;
      entry.overlay.setName(g.name);
      entry.overlay.setColour(ROLE_COLOURS[g.role]);
    }
  }

  /** The HR office has an HR agent behind its desk. It is scenery: the simulation does not know it. */
  private addHrGhost(): void {
    const view = new AvatarView("hr", "hr", this.sprites, { ...HR_GHOST_TILE }, 4);
    const overlay = new AvatarOverlay("HR", ROLE_COLOURS.hr, this.sprites, true);
    overlay.setState("idle");
    this.objects.addChild(view.sprite);
    this.overlays.addChild(overlay.container);
    this.hrGhost = { view, overlay };
  }

  /** Picks 1x or 2x from the stage size (only used while the user has not chosen a zoom). */
  private chooseAutoZoom(): void {
    if (!this.room) return;
    const b = this.room.bounds;
    const { width, height } = this.app.screen;
    this.zoomLevel = chooseZoom(b.maxX - b.minX, b.maxY - b.minY, width, height, FIT_MARGIN_PX);
  }

  /** The stage changed size (window, side bar or dock): recompute zoom if automatic, then centre. */
  private relayout(): void {
    const before = this.zoomLevel;
    if (!this.zoomChosen) this.chooseAutoZoom();
    this.layout();
    if (this.zoomLevel !== before) this.hooks.onZoomChange?.(this.zoomLevel);
  }

  private clearScene(): void {
    this.badge?.destroy();
    this.badge = null;
    this.hoveredItem = null;
    for (const l of this.levelUps) l.fx.destroy();
    this.levelUps = [];
    this.dropWisp();
    for (const c of this.catches) c.destroy();
    this.catches = [];
    for (const { overlay } of this.avatars.values()) overlay.destroy();
    this.avatars.clear();
    this.hrGhost?.overlay.destroy();
    this.hrGhost = null;
    for (const c of this.objects.removeChildren()) c.destroy();
    this.furni = [];
    this.furniObjects = [];
    this.monitors.clear();
    this.candles.clear();
    this.flames = []; // their containers were destroyed with the objects layer
    this.motes?.destroy();
    this.motes = null;
    this.room?.destroy();
    this.room = null;
  }

  /** Centre the room (or the focused agent) in the stage at the current zoom. `instant` skips the pan animation. */
  private layout(instant = true): void {
    this.root.scale.set(this.zoomLevel);
    if (!this.room) return;
    const b = this.room.bounds;
    const { width, height } = this.app.screen;
    const centre = this.focus ?? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    this.rootTarget = rootPositionFor(centre, this.zoomLevel, width, height);
    if (instant || this.reducedMotion) this.root.position.set(this.rootTarget.x, this.rootTarget.y);
  }

  // ---- input ----

  private hit(e: FederatedPointerEvent) {
    if (!this.room) return null;
    const p = this.root.toLocal(e.global);
    const item = pickFurni(this.room.room, p.x, p.y);
    return { room: this.room, item, tile: screenToTile(p.x, p.y) };
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    const h = this.hit(e);
    if (!h) return;
    if (this.arrangeInput) {
      this.arrangeInput.move(h.tile);
      if (!this.dragging) {
        const piece = pickFurni(h.room.room, ...this.localPoint(e), { includeWalkable: true });
        const def = piece ? FURNI_CATALOG[piece.defId] : undefined;
        this.app.canvas.style.cursor = piece && !isPinned(def) ? "grab" : "default";
      }
      return;
    }
    this.hoveredItem = null;
    if (this.hrGhost?.view.sprite.getBounds().containsPoint(e.global.x, e.global.y)) {
      this.app.canvas.style.cursor = "default";
      h.room.setHover(null);
      this.hooks.tooltip?.hover("agent:hr", e.global.x, e.global.y, () => ({
        title: "HR",
        lines: ["Suggests a team for a project when you ask at the HR desk. It only proposes; you decide."],
      }));
      return;
    }
    const agent = this.agentAt(e.global.x, e.global.y);
    if (agent) {
      this.app.canvas.style.cursor = "default";
      h.room.setHover(null);
      this.hooks.tooltip?.hover(`agent:${agent}`, e.global.x, e.global.y, () => this.agentTip(agent));
      return;
    }
    if (h.item) {
      const def = FURNI_CATALOG[h.item.defId];
      if (def) {
        h.room.setHover(footprintTiles(h.item, def), def.interaction ? "use" : "floor");
        this.app.canvas.style.cursor = def.interaction ? "pointer" : "default";
        if (def.interaction) this.hoveredItem = h.item.itemId;
        if (def.interaction && def.hint) {
          const hint = def.hint;
          this.hooks.tooltip?.hover(`item:${h.item.itemId}`, e.global.x, e.global.y, () => ({ title: def.name, lines: [hint] }));
        } else {
          this.hooks.tooltip?.hide();
        }
        return;
      }
    }
    this.hooks.tooltip?.hide();
    this.app.canvas.style.cursor = "default";
    h.room.setHover(h.room.isFloor(h.tile) ? [h.tile] : null, "floor");
  }

  /** Front-most agent (not the user) whose sprite is under the point, in canvas coordinates. */
  private agentAt(gx: number, gy: number): StaffId | undefined {
    let best: StaffId | undefined;
    let bestY = -Infinity;
    for (const [id, { view }] of this.avatars) {
      if (typeof id !== "string" || !view.sprite.visible) continue;
      if (!view.sprite.getBounds().containsPoint(gx, gy)) continue;
      if (view.feetY > bestY) {
        best = id;
        bestY = view.feetY;
      }
    }
    return best;
  }

  private clearHover(): void {
    this.hoveredItem = null;
    this.room?.setHover(null);
    this.hooks.tooltip?.hide();
    this.app.canvas.style.cursor = "default";
  }

  private localPoint(e: FederatedPointerEvent): [number, number] {
    const p = this.root.toLocal(e.global);
    return [p.x, p.y];
  }

  private onPointerDown(e: FederatedPointerEvent): void {
    if (!this.arrangeInput || !this.room) return;
    const [x, y] = this.localPoint(e);
    const piece = pickFurni(this.room.room, x, y, { includeWalkable: true });
    this.dragging = piece !== undefined && !isPinned(FURNI_CATALOG[piece.defId]);
    if (this.dragging) this.app.canvas.style.cursor = "grabbing";
    this.arrangeInput.down(piece?.itemId ?? null, screenToTile(x, y));
  }

  private onPointerUp(): void {
    if (!this.arrangeInput) return;
    this.dragging = false;
    this.app.canvas.style.cursor = "default";
    this.arrangeInput.up();
  }

  private onPointerTap(e: FederatedPointerEvent): void {
    this.hooks.tooltip?.hide();
    // Arranging: a click selects (on pointer down) and never uses the furniture or walks the avatar.
    if (this.arrangeInput) return;
    const h = this.hit(e);
    if (!h) return;
    if (h.item) {
      // Interactive items open their panel on arrival; other solid furniture just walks the user next to it.
      this.send({ type: "use", itemId: h.item.itemId });
      return;
    }
    if (h.room.isFloor(h.tile)) this.send({ type: "move", x: h.tile.x, y: h.tile.y });
  }
}
