import { Sprite } from "pixi.js";
import { LAYER, depthKey, tileToScreen } from "@agentlife/shared";
import type { Dir, Tile } from "@agentlife/shared";
import type { RoleKey } from "../palette.ts";
import { viewFor } from "./figure.ts";
import type { SpriteProvider } from "./textures.ts";
import { ghostFrame, poseAt, walkFrame } from "./walk-anim.ts";
import type { WalkState } from "./walk-anim.ts";

/** One avatar: a sprite whose tile position, facing and walk cycle follow the server's walk messages. */
export class AvatarView {
  readonly sprite = new Sprite();
  /** Screen position of the feet, updated every frame (used to place overlays). */
  feetX = 0;
  feetY = 0;
  private tile: Tile;
  private dir: Dir;
  private walk: WalkState | null = null;
  /** Keeps ghosts from bobbing in unison. */
  private readonly bobOffset: number;

  constructor(
    readonly id: number | string,
    /** A guest spot starts with a placeholder and takes the role of whoever stands there. */
    public role: RoleKey,
    private readonly sprites: SpriteProvider,
    tile: Tile,
    dir: number,
  ) {
    this.tile = tile;
    this.bobOffset = typeof id === "string" ? [...id].reduce((n, c) => n + c.charCodeAt(0), 0) * 37 : 0;
    this.dir = (((dir % 8) + 8) % 8) as Dir;
    this.update(Date.now());
  }

  /** True while a walk is under way (a walk that has just ended is folded in by the next `update`). */
  get walking(): boolean {
    return this.walk !== null;
  }

  /** Start a walk; it begins from the last tile fully reached, like the server's simulation. */
  setWalk(path: readonly Tile[], msPerTile: number, startedAt: number, now: number): void {
    this.settle(now);
    this.walk = { origin: this.tile, path, startedAt, msPerTile };
  }

  setDir(dir: number): void {
    this.dir = (((dir % 8) + 8) % 8) as Dir;
  }

  /** Fold progress of the current walk into `tile` (without ending the walk). */
  private settle(now: number): void {
    if (!this.walk) return;
    const pose = poseAt(this.walk, now);
    this.tile = pose.tile;
    if (pose.dir !== null) this.dir = pose.dir;
    if (pose.finished) this.walk = null;
  }

  update(now: number): void {
    let x = this.tile.x;
    let y = this.tile.y;
    let moving = false;
    if (this.walk) {
      const pose = poseAt(this.walk, now);
      x = pose.x;
      y = pose.y;
      moving = pose.moving;
      if (pose.dir !== null) this.dir = pose.dir;
      if (pose.finished) {
        this.tile = pose.tile;
        this.walk = null;
      }
    }
    const { view, mirror } = viewFor(this.dir);
    const frame = this.sprites.avatar(this.role, view, this.role === "user" ? (moving ? walkFrame(now) : 0) : ghostFrame(now, this.bobOffset));
    this.sprite.texture = frame.texture;
    this.sprite.anchor.set(frame.anchor.x, frame.anchor.y);
    this.sprite.scale.x = mirror ? -1 : 1;

    const p = tileToScreen({ x, y });
    this.feetX = p.sx;
    this.feetY = p.sy;
    this.sprite.position.set(p.sx, p.sy);
    // Depth uses the tile the avatar is entering (interpolated position rounded up).
    this.sprite.zIndex = depthKey({ x: Math.ceil(x - 1e-9), y: Math.ceil(y - 1e-9), layer: LAYER.avatar });
  }
}
