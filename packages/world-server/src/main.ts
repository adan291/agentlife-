import { RoomValidationError, WorldSim } from "@agentlife/shared";
import { startGateway } from "./gateway.ts";
import { DEFAULT_ROOM_PATH, loadRoomFile } from "./load-room.ts";

/** Load and validate the room; exit with the invalid field path(s) when it is bad. */
function loadRoom() {
  try {
    return loadRoomFile();
  } catch (e) {
    if (e instanceof RoomValidationError) {
      console.error(`${DEFAULT_ROOM_PATH}\n${e.message}`);
    } else {
      console.error(`Cannot load ${DEFAULT_ROOM_PATH}: ${e instanceof Error ? e.message : String(e)}`);
    }
    process.exit(1);
  }
}

const room = loadRoom();
const sim = new WorldSim(room, Date.now);
const port = Number(process.env["PORT"] ?? 8787);
const host = process.env["HOST"] ?? "127.0.0.1";
const gateway = await startGateway({ sim, host, port });
console.log(`world-server listening on ws://${host}:${gateway.port}`);
