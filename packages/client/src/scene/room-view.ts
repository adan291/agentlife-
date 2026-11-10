import { Container, Graphics } from "pixi.js";
import { parseHeightmap } from "@agentlife/shared";
import type { Heightmap, RoomDef, Tile } from "@agentlife/shared";
import { PALETTE, shade } from "../palette.ts";
import { P, WALL_UNITS, fillPoly, strokePoly } from "./iso-draw.ts";
import type { Pt } from "./iso-draw.ts";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Screen bounds of the room (floor and back walls) at zoom 1, in the room's own coordinates. */
export function roomBounds(w: number, l: number): Bounds {
  return {
    minX: P(-0.5, l - 0.5)[0],
    maxX: P(w - 0.5, -0.5)[0],
    minY: P(-0.5, -0.5, WALL_UNITS)[1],
    maxY: P(w - 0.5, l - 0.5)[1],
  };
}

function diamond(x: number, y: number, z: number): Pt[] {
  return [P(x - 0.5, y - 0.5, z), P(x + 0.5, y - 0.5, z), P(x + 0.5, y + 0.5, z), P(x - 0.5, y + 0.5, z)];
}

export type HoverKind = "floor" | "use";

/** Floor, back walls and the hover highlight. Furniture and avatars live in separate layers above. */
export class RoomView {
  readonly container = new Container();
  readonly heightmap: Heightmap;
  readonly bounds: Bounds;
  private readonly hover = new Graphics();
  private hoverKey = "";

  constructor(readonly room: RoomDef) {
    this.heightmap = parseHeightmap(room.heightmap);
    this.bounds = roomBounds(this.heightmap.w, this.heightmap.l);
    const floor = new Graphics();
    const walls = new Graphics();
    this.drawWalls(walls);
    this.drawFloor(floor);
    this.container.addChild(walls, floor, this.hover);
  }

  isFloor(t: Tile): boolean {
    return this.heightmap.height(t.x, t.y) !== null;
  }

  /** Highlight tiles (empty or undefined clears). */
  setHover(tiles: readonly Tile[] | null, kind: HoverKind = "floor"): void {
    const key = tiles ? `${kind}:${tiles.map((t) => `${t.x},${t.y}`).join(";")}` : "";
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hover.clear();
    if (!tiles) return;
    const colour = kind === "use" ? PALETTE.hoverUse : PALETTE.hoverFloor;
    for (const t of tiles) {
      const z = this.heightmap.height(t.x, t.y);
      if (z === null) continue;
      const d = diamond(t.x, t.y, z);
      fillPoly(this.hover, d, colour, 0.28);
      strokePoly(this.hover, d, colour, 2, 0.95);
    }
  }

  private drawFloor(g: Graphics): void {
    const { w, l } = this.heightmap;
    for (let s = 0; s <= w + l - 2; s++) {
      for (let x = 0; x < w; x++) {
        const y = s - x;
        if (y < 0 || y >= l) continue;
        const h = this.heightmap.height(x, y);
        if (h === null) continue;
        const base = (x + y) % 2 === 0 ? PALETTE.floorA : PALETTE.floorB;
        // Side faces where this tile stands above its south / east neighbour.
        const hs = this.heightmap.height(x, y + 1) ?? 0;
        const he = this.heightmap.height(x + 1, y) ?? 0;
        if (h > hs) {
          fillPoly(g, [P(x - 0.5, y + 0.5, hs), P(x + 0.5, y + 0.5, hs), P(x + 0.5, y + 0.5, h), P(x - 0.5, y + 0.5, h)], PALETTE.floorSide);
        }
        if (h > he) {
          fillPoly(g, [P(x + 0.5, y + 0.5, he), P(x + 0.5, y - 0.5, he), P(x + 0.5, y - 0.5, h), P(x + 0.5, y + 0.5, h)], shade(PALETTE.floorSide, 0.8));
        }
        const d = diamond(x, y, h);
        fillPoly(g, d, base);
        strokePoly(g, d, PALETTE.floorEdge, 1, 0.6);
      }
    }
  }

  private drawWalls(g: Graphics): void {
    const { w, l } = this.heightmap;
    const H = WALL_UNITS;
    // Left wall: plane x = -0.5, runs along y. Right wall: plane y = -0.5, runs along x.
    const left = [P(-0.5, -0.5, 0), P(-0.5, l - 0.5, 0), P(-0.5, l - 0.5, H), P(-0.5, -0.5, H)];
    const right = [P(-0.5, -0.5, 0), P(w - 0.5, -0.5, 0), P(w - 0.5, -0.5, H), P(-0.5, -0.5, H)];
    fillPoly(g, left, PALETTE.wallLeft);
    fillPoly(g, right, PALETTE.wallRight);

    // Panel lines.
    for (let i = 1; i < l; i++) {
      const a = P(-0.5, i - 0.5, 0);
      const b = P(-0.5, i - 0.5, H);
      g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ color: PALETTE.wallStripe, width: 1, alpha: 0.5 });
    }
    for (let i = 1; i < w; i++) {
      const a = P(i - 0.5, -0.5, 0);
      const b = P(i - 0.5, -0.5, H);
      g.moveTo(a[0], a[1]).lineTo(b[0], b[1]).stroke({ color: PALETTE.wallStripe, width: 1, alpha: 0.5 });
    }

    // Baseboards and top trim.
    fillPoly(g, [P(-0.5, -0.5, 0), P(-0.5, l - 0.5, 0), P(-0.5, l - 0.5, 0.5), P(-0.5, -0.5, 0.5)], PALETTE.baseboard);
    fillPoly(g, [P(-0.5, -0.5, 0), P(w - 0.5, -0.5, 0), P(w - 0.5, -0.5, 0.5), P(-0.5, -0.5, 0.5)], shade(PALETTE.baseboard, 1.2));
    strokePoly(g, left, PALETTE.wallTrim, 1, 0.9);
    strokePoly(g, right, PALETTE.wallTrim, 1, 0.9);

    this.drawWindow(g);
    this.drawDoor(g);
  }

  /** A night window on the back-right wall with a moon. */
  private drawWindow(g: Graphics): void {
    const x0 = 0.8;
    const x1 = 2.2;
    const frame = [P(x0 - 0.08, -0.5, 1.9), P(x1 + 0.08, -0.5, 1.9), P(x1 + 0.08, -0.5, 5.1), P(x0 - 0.08, -0.5, 5.1)];
    const pane = [P(x0, -0.5, 2.0), P(x1, -0.5, 2.0), P(x1, -0.5, 5.0), P(x0, -0.5, 5.0)];
    fillPoly(g, frame, PALETTE.windowFrame);
    fillPoly(g, pane, PALETTE.windowSky);
    fillPoly(g, [P(x0, -0.5, 2.0), P(x1, -0.5, 2.0), P(x1, -0.5, 3.0), P(x0, -0.5, 3.0)], PALETTE.windowGlow, 0.5);
    const moon = P(1.7, -0.5, 4.2);
    g.circle(moon[0], moon[1], 7).fill(PALETTE.moon);
    g.circle(moon[0] + 3, moon[1] - 2, 6).fill(PALETTE.windowSky);
    const m1 = P((x0 + x1) / 2, -0.5, 2.0);
    const m2 = P((x0 + x1) / 2, -0.5, 5.0);
    g.moveTo(m1[0], m1[1]).lineTo(m2[0], m2[1]).stroke({ color: PALETTE.windowFrame, width: 2 });
  }

  /** The door gap on whichever back wall the door anchor touches. */
  private drawDoor(g: Graphics): void {
    const d = this.room.door;
    let pts: Pt[] | null = null;
    let glow: Pt[] | null = null;
    if (d.x === 0) {
      pts = [P(-0.5, d.y - 0.4, 0), P(-0.5, d.y + 0.4, 0), P(-0.5, d.y + 0.4, 4), P(-0.5, d.y - 0.4, 4)];
      glow = [P(-0.5, d.y - 0.4, 0), P(-0.5, d.y + 0.4, 0), P(-0.5, d.y + 0.4, 0.3), P(-0.5, d.y - 0.4, 0.3)];
    } else if (d.y === 0) {
      pts = [P(d.x - 0.4, -0.5, 0), P(d.x + 0.4, -0.5, 0), P(d.x + 0.4, -0.5, 4), P(d.x - 0.4, -0.5, 4)];
      glow = [P(d.x - 0.4, -0.5, 0), P(d.x + 0.4, -0.5, 0), P(d.x + 0.4, -0.5, 0.3), P(d.x - 0.4, -0.5, 0.3)];
    }
    if (!pts || !glow) return;
    fillPoly(g, pts, PALETTE.doorDark);
    strokePoly(g, pts, PALETTE.wallTrim, 2);
    fillPoly(g, glow, PALETTE.doorGlow, 0.6);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
