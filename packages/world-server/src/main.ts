import { RoomValidationError, WorldSim } from "@agentlife/shared";
import { FakeEngineLink } from "./fake-engine.ts";
import type { EngineLink } from "./engine-link.ts";
import { startGateway } from "./gateway.ts";
import { HttpEngineLink } from "./http-engine.ts";
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

const engineKind = process.env["ENGINE"] ?? "fake";
let engine: EngineLink;
if (engineKind === "fake") {
  engine = new FakeEngineLink();
} else if (engineKind === "http") {
  const baseUrl = process.env["ENGINE_URL"] ?? "http://127.0.0.1:8788";
  engine = new HttpEngineLink({
    baseUrl,
    token: process.env["ENGINE_TOKEN"],
    onLog: (m) => console.warn(m),
  });
  console.log(`using agent-engine at ${baseUrl}`);
} else {
  console.error(`ENGINE=${engineKind} is not valid; use ENGINE=fake or ENGINE=http`);
  process.exit(1);
}
const gateway = await startGateway({ sim, host, port, engine });
console.log(`world-server listening on ws://${host}:${gateway.port}`);
