import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoom } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOMS_DIR = join(here, "..", "rooms");
/** The single office of the first versions; the gateway serves it until the world-server hosts the hotel (hotel-floors task 3). */
export const DEFAULT_ROOM_PATH = join(ROOMS_DIR, "office.json");

/** Read and validate a room file. Throws RoomValidationError (with field paths) or a read/parse error. */
export function loadRoomFile(path: string = DEFAULT_ROOM_PATH): RoomDef {
  return validateRoom(JSON.parse(readFileSync(path, "utf8")));
}

export interface HotelRooms {
  lobby: RoomDef;
  hr: RoomDef;
  /** Template of the project floors. */
  template: RoomDef;
}

/** The three room files of the hotel. The first invalid one throws. */
export function loadHotelRooms(dir: string = ROOMS_DIR): HotelRooms {
  return {
    lobby: loadRoomFile(join(dir, "lobby.json")),
    hr: loadRoomFile(join(dir, "hr.json")),
    template: loadRoomFile(join(dir, "project-template.json")),
  };
}
