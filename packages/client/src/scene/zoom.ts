export type Zoom = 1 | 2;

/** 2x when the whole room fits comfortably in the window at 2x, otherwise 1x. */
export function chooseZoom(roomW: number, roomH: number, screenW: number, screenH: number, margin = 40): Zoom {
  return roomW * 2 + margin * 2 <= screenW && roomH * 2 + margin * 2 <= screenH ? 2 : 1;
}

export function toggleZoom(z: Zoom): Zoom {
  return z === 1 ? 2 : 1;
}
