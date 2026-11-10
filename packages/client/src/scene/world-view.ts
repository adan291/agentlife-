import { Container } from "pixi.js";
import type { Application, FederatedPointerEvent } from "pixi.js";
import { FURNI_CATALOG, footprintTiles, screenToTile } from "@agentlife/shared";
import type { AvatarId, ClientMsg, ErrorCode, ServerMsg, WelcomeMsg } from "@agentlife/shared";
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
import type { Zoom } from "./zoom.ts";

export interface WorldViewHooks {
  /** Server `error` messages (no_path, rate_limited, ...). */
  onError?(code: ErrorCode, message: string): void;
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
    app.renderer.on("resize", () => this.layout());
  }

  get zoom(): Zoom {
    return this.zoomLevel;
  }

  setZoom(z: Zoom): void {
    this.zoomLevel = z;
    this.zoomChosen = true;
    this.layout();
  }

  toggleZoom(): Zoom {
    this.setZoom(toggleZoom(this.zoomLevel));
    return this.zoomLevel;
  }

  handle(msg: ServerMsg, now = Date.now()): void {
    switch (msg.type) {
      case "welcome":
        this.rebuild(msg);
        break;
      case "walk":
        this.avatars.get(msg.id)?.view.setWalk(msg.path, msg.msPerTile, msg.startedAt, now);
        break;
      case "face":
        this.avatars.get(msg.id)?.view.setDir(msg.dir);
        break;
      case "agent_state":
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
    for (const { view, overlay } of this.avatars.values()) {
      view.update(now);
      overlay.update(now, view.feetX, view.feetY);
      overlay.container.zIndex = view.feetY;
    }
  }

  private rebuild(msg: WelcomeMsg): void {
    this.clearScene();
    const room = new RoomView(msg.room);
    this.room = room;
    this.root.addChildAt(room.container, 0);

    for (const placed of msg.room.furni) {
      const z = room.heightmap.height(placed.x, placed.y) ?? 0;
      const fv = new FurniView(placed, this.sprites, z);
      this.furni.push(fv);
      this.objects.addChild(fv.sprite);
    }

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

    if (!this.zoomChosen) {
      const b = room.bounds;
      this.zoomLevel = chooseZoom(b.maxX - b.minX, b.maxY - b.minY, this.app.screen.width, this.app.screen.height);
    }
    this.layout();
    this.tick(Date.now());
  }

  private clearScene(): void {
    for (const { overlay } of this.avatars.values()) overlay.destroy();
    this.avatars.clear();
    for (const c of this.objects.removeChildren()) c.destroy();
    this.furni = [];
    this.room?.destroy();
    this.room = null;
  }

  /** Centre the room in the window at the current zoom. */
  private layout(): void {
    this.root.scale.set(this.zoomLevel);
    if (!this.room) return;
    const b = this.room.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    this.root.position.set(
      Math.round(this.app.screen.width / 2 - cx * this.zoomLevel),
      Math.round(this.app.screen.height / 2 - cy * this.zoomLevel),
    );
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
    if (h.item) {
      const def = FURNI_CATALOG[h.item.defId];
      if (def) {
        h.room.setHover(footprintTiles(h.item, def), def.interaction ? "use" : "floor");
        this.app.canvas.style.cursor = def.interaction ? "pointer" : "default";
        return;
      }
    }
    this.app.canvas.style.cursor = "default";
    h.room.setHover(h.room.isFloor(h.tile) ? [h.tile] : null, "floor");
  }

  private clearHover(): void {
    this.room?.setHover(null);
    this.app.canvas.style.cursor = "default";
  }

  private onPointerTap(e: FederatedPointerEvent): void {
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
