import { needsAttention } from "@agentlife/shared";
import type { FloorStatus } from "@agentlife/shared";
import { ROLE_INFO } from "@agentlife/shared";
import type { FlagStorage } from "./guide.ts";

/** Where the floor is remembered between page loads. */
export const FLOOR_KEY = "agentlife-floor";

/** Text of a floor's status in the elevator panel and on the directory board. */
export function statusText(floor: FloorStatus): string {
  switch (floor.status) {
    case "idle":
      return "Idle";
    case "working":
      return floor.who ? `Working: ${ROLE_INFO[floor.who].name}` : "Working";
    case "waiting_approval":
      return "Waiting for your approval";
    case "report_ready":
      return "Report ready";
    case "failed":
      return "Failed";
    case "queued":
      return floor.queuePosition ? `Queued (place ${floor.queuePosition})` : "Queued";
  }
}

/**
 * Short name of a floor for the door transition: the lobby is `L`, the HR office `HR`, project floors are numbered
 * from 1 in the order of the list.
 */
export function floorTag(floors: readonly FloorStatus[], roomId: string): string {
  const floor = floors.find((f) => f.roomId === roomId);
  if (!floor) return "";
  if (floor.kind === "lobby") return "L";
  if (floor.kind === "hr") return "HR";
  return String(floors.filter((f) => f.kind === "project").findIndex((f) => f.roomId === roomId) + 1);
}

/** Floors other than the current one that wait for the user (approval, unread report, failure). */
export function attentionCount(floors: readonly FloorStatus[], currentRoom: string | undefined): number {
  return floors.filter((f) => f.roomId !== currentRoom && needsAttention(f.status)).length;
}

/** Label of the Elevator shortcut in the HUD: shows how many other floors wait for the user. */
export function elevatorLabel(floors: readonly FloorStatus[], currentRoom: string | undefined): string {
  const n = attentionCount(floors, currentRoom);
  return n > 0 ? `Elevator (${n})` : "Elevator";
}

export function loadFloor(storage: FlagStorage | undefined): string | null {
  try {
    const v = storage?.getItem(FLOOR_KEY);
    return typeof v === "string" && v.length > 0 && v.length <= 100 ? v : null;
  } catch {
    return null;
  }
}

export function saveFloor(storage: FlagStorage | undefined, roomId: string): void {
  try {
    storage?.setItem(FLOOR_KEY, roomId);
  } catch {
    // Not remembered; the user starts in the lobby next time.
  }
}

/**
 * The floor to return to after a reload: the remembered one if it still exists and differs from where the user is.
 * `null`: stay.
 */
export function restoreTarget(remembered: string | null, currentRoom: string | undefined, floors: readonly FloorStatus[]): string | null {
  if (!remembered || remembered === currentRoom) return null;
  return floors.some((f) => f.roomId === remembered) ? remembered : null;
}
