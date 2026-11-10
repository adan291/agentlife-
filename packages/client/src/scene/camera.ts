export interface Point {
  x: number;
  y: number;
}

/** How long the camera stays on an agent after a team bar click before it returns to the room centre. */
export const FOCUS_MS = 3000;

/** Position of the scaled scene root that puts `point` (scene coordinates) at the centre of the screen. */
export function rootPositionFor(point: Point, scale: number, screenW: number, screenH: number): Point {
  return { x: Math.round(screenW / 2 - point.x * scale), y: Math.round(screenH / 2 - point.y * scale) };
}

/** One animation step from `current` towards `target`; lands exactly on it once within half a pixel. */
export function easeToward(current: Point, target: Point, factor = 0.2): Point {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return { x: target.x, y: target.y };
  return { x: current.x + dx * factor, y: current.y + dy * factor };
}
