import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoom } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOMS_DIR = join(here, "..", "rooms");

/** Read and validate a room file. Throws RoomValidationError (with field paths) or a read/parse error. */
export function loadRoomFile(path: string): RoomDef {
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
