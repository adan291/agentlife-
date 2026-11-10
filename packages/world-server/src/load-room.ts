import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoom } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOM_PATH = join(here, "..", "rooms", "office.json");

/** Read and validate a room file. Throws RoomValidationError (with field paths) or a read/parse error. */
export function loadRoomFile(path: string = DEFAULT_ROOM_PATH): RoomDef {
  return validateRoom(JSON.parse(readFileSync(path, "utf8")));
}
