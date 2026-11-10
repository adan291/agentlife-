import { Container } from "pixi.js";
import type { Application, FederatedPointerEvent } from "pixi.js";
import { FURNI_CATALOG, HEIGHT_UNIT, footprintTiles, screenToTile, tileToScreen } from "@agentlife/shared";
import type { AgentId, AgentState, AvatarId, ClientMsg, ErrorCode, ServerMsg, WelcomeMsg } from "@agentlife/shared";
import { ROLE_COLOURS } from "../palette.ts";
import type { RoleKey } from "../palette.ts";
import { AvatarView } from "./avatar-view.ts";
import { builderTagName, sessionLabel } from "./crew-label.ts";
import { FurniView } from "./furni-view.ts";
import { AvatarOverlay } from "./overlay.ts";
import { pickFurni } from "./pick.ts";
import { RoomView } from "./room-view.ts";
import type { SpriteProvider } from "./textures.ts";
import { chooseZoom, toggleZoom } from "./zoom.ts";
import { freeViewport, getInsets, onInsetsChange } from "./viewport.ts";
import type { FreeViewport } from "./viewport.ts";
import type { Zoom } from "./zoom.ts";
import { agentTooltip } from "../ui/tooltip.ts";
import { FOCUS_MS, easeToward, rootPositionFor } from "./camera.ts";
import type { Point } from "./camera.ts";
import { prefersReducedMotion } from "./glow.ts";
import { MailboxBadge } from "./mailbox-badge.ts";
import type { HoverSink } from "../ui/tooltip.ts";

export interface WorldViewHooks {
  /** Server `error` messages (no_path, rate_limited, ...). */
  onError?(code: ErrorCode, message: string): void;
  /** Receives hover targets for tooltips. */
  tooltip?: HoverSink;
  /** The automatic zoom changed (free viewport resized). */
  onZoomChange?(zoom: Zoom): void;
}

interface AvatarEntry {
  view: AvatarView;
  overlay: AvatarOverlay;
}

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
  private furni: FurniView[] = [];
  private readonly avatars = new Map<AvatarId, AvatarEntry>();
  private zoomLevel: Zoom = 1;
  private zoomChosen = false;
  private models: Partial<Record<AgentId, string>> = {};
  private hoveredItem: string | null = null;
  private badge: MailboxBadge | null = null;
  private badgeCount = 0;
  private badgeDot = false;
  private reducedMotion = prefersReducedMotion();
  /** Scene point the camera is held on after a team bar click; null: room centre. */
  private focus: Point | null = null;
  private focusUntil = 0;
  private rootTarget: Point = { x: 0, y: 0 };
  private readonly agentStatus = new Map<AgentId, { state?: AgentState; text?: string | undefined }>();

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
    app.stage.on("pointerleave", () => this.clearHover());
    app.renderer.on("resize", () => this.relayout());
    onInsetsChange(() => this.relayout());
  }

  get zoom(): Zoom {
    return this.zoomLevel;
  }

  /** Pending approvals as a number and an unread report as a dot, above the mailbox. */
  setMailboxBadge(count: number, dot: boolean): void {
    this.badgeCount = count;
    this.badgeDot = dot;
    this.badge?.set(count, dot);
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
    const v = this.freeArea();
    this.hooks.tooltip?.pin(`agent:${id}`, v.x + v.w / 2 + 24, v.y + v.h / 2 - 30, () => this.agentTip(id), 2000);
    return true;
  }

  private agentTip(agent: AgentId) {
    const s = this.agentStatus.get(agent);
    return agentTooltip(agent, s?.state, s?.text, this.models[agent]);
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
      case "error":
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
    for (const f of this.furni) f.update(now, f.placed.itemId === this.hoveredItem, this.reducedMotion);
    this.badge?.update(now, this.reducedMotion);
    for (const { view, overlay } of this.avatars.values()) {
      view.update(now);
      overlay.update(now, view.feetX, view.feetY);
      overlay.container.zIndex = view.feetY;
    }
  }

  private rebuild(msg: WelcomeMsg): void {
    this.clearScene();
    this.focus = null;
    const room = new RoomView(msg.room);
    this.room = room;
    this.root.addChildAt(room.container, 0);

    for (const placed of msg.room.furni) {
      const z = room.heightmap.height(placed.x, placed.y) ?? 0;
      const fv = new FurniView(placed, this.sprites, z);
      this.furni.push(fv);
      this.objects.addChild(fv.sprite);
      if (fv.glow) this.objects.addChild(fv.glow);
      if (fv.def.interaction === "mailbox") {
        const p = tileToScreen({ x: placed.x, y: placed.y, z });
        this.badge = new MailboxBadge(p.sx, p.sy - fv.def.height * HEIGHT_UNIT - 16);
        this.overlays.addChild(this.badge.container);
        this.badge.set(this.badgeCount, this.badgeDot);
      }
    }

    this.models = msg.models ?? {};
    this.agentStatus.clear();
    for (const a of msg.agents) this.agentStatus.set(a.agentId, { state: a.state, text: a.text });
    const status = new Map(msg.agents.map((a) => [a.agentId, a]));
    for (const a of msg.avatars) {
      const role: RoleKey = typeof a.id === "string" ? a.id : "user";
      const view = new AvatarView(a.id, role, this.sprites, { x: a.x, y: a.y }, a.dir);
      const overlay = new AvatarOverlay(a.name, ROLE_COLOURS[role], this.sprites, typeof a.id === "string");
      const s = typeof a.id === "string" ? status.get(a.id) : undefined;
      if (s) overlay.setState(s.state, s.text);
      this.objects.addChild(view.sprite);
      this.overlays.addChild(overlay.container);
      this.avatars.set(a.id, { view, overlay });
    }

    if (!this.zoomChosen) this.chooseAutoZoom();
    this.layout();
    this.tick(Date.now());
  }

  private freeArea(): FreeViewport {
    return freeViewport(this.app.screen.width, this.app.screen.height, getInsets());
  }

  /** Picks 1x or 2x from the free viewport (only used while the user has not chosen a zoom). */
  private chooseAutoZoom(): void {
    if (!this.room) return;
    const b = this.room.bounds;
    const v = this.freeArea();
    this.zoomLevel = chooseZoom(b.maxX - b.minX, b.maxY - b.minY, v.w, v.h, 0);
  }

  /** The free viewport changed (team bar, terminal or window): recompute zoom if automatic, then centre. */
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
    for (const { overlay } of this.avatars.values()) overlay.destroy();
    this.avatars.clear();
    for (const c of this.objects.removeChildren()) c.destroy();
    this.furni = [];
    this.room?.destroy();
    this.room = null;
  }

  /** Centre the room (or the focused agent) in the window at the current zoom. `instant` skips the pan animation. */
  private layout(instant = true): void {
    this.root.scale.set(this.zoomLevel);
    if (!this.room) return;
    const b = this.room.bounds;
    const v = this.freeArea();
    const centre = this.focus ?? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    this.rootTarget = rootPositionFor(centre, this.zoomLevel, v.w, v.h, v.x, v.y);
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
    this.hoveredItem = null;
    const agent = this.agentAt(e.global.x, e.global.y);
    if (agent) {
      this.app.canvas.style.cursor = "default";
      h.room.setHover(null);
      this.hooks.tooltip?.hover(`agent:${agent}`, e.clientX, e.clientY, () => this.agentTip(agent));
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
          this.hooks.tooltip?.hover(`item:${h.item.itemId}`, e.clientX, e.clientY, () => ({ title: def.name, lines: [hint] }));
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
  private agentAt(gx: number, gy: number): AgentId | undefined {
    let best: AgentId | undefined;
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

  private onPointerTap(e: FederatedPointerEvent): void {
    this.hooks.tooltip?.hide();
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
