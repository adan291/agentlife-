import { dirFromDelta } from "@agentlife/shared";
import type { Dir, Tile } from "@agentlife/shared";

export interface WalkState {
  /** Tile the avatar stood on when the walk began. */
  origin: Tile;
  /** Steps after the origin, one tile each. */
  path: readonly Tile[];
  /** Epoch ms when the first step begins. */
  startedAt: number;
  msPerTile: number;
}

export interface Pose {
  /** Fractional tile coordinates. */
  x: number;
  y: number;
  /** Direction of the current step, or null when there is no step (empty path). */
  dir: Dir | null;
  /** True while between tiles. */
  moving: boolean;
  /** Last tile fully reached; the origin of any walk that replaces this one. */
  tile: Tile;
  finished: boolean;
}

/** Position along a walk at time `now`. Mirrors the clock-derived positions of the WorldSim. */
export function poseAt(w: WalkState, now: number): Pose {
  const steps = w.path.length;
  if (steps === 0) return { x: w.origin.x, y: w.origin.y, dir: null, moving: false, tile: w.origin, finished: true };
  const stepDir = (i: number): Dir => {
    const a = i === 0 ? w.origin : w.path[i - 1]!;
    const b = w.path[i]!;
    return dirFromDelta(b.x - a.x, b.y - a.y);
  };
  const t = (now - w.startedAt) / w.msPerTile;
  if (t <= 0) return { x: w.origin.x, y: w.origin.y, dir: stepDir(0), moving: false, tile: w.origin, finished: false };
  if (t >= steps) {
    const end = w.path[steps - 1]!;
    return { x: end.x, y: end.y, dir: stepDir(steps - 1), moving: false, tile: end, finished: true };
  }
  const i = Math.floor(t);
  const f = t - i;
  const a = i === 0 ? w.origin : w.path[i - 1]!;
  const b = w.path[i]!;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    dir: stepDir(i),
    moving: true,
    tile: a,
    finished: false,
  };
}

/** Walk-cycle phase (0 or 1) that flips every `periodMs` while moving. */
export function walkFrame(now: number, periodMs = 180): 0 | 1 {
  return Math.floor(now / periodMs) % 2 === 0 ? 0 : 1;
}
