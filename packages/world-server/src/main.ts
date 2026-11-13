import { Hotel, RoomValidationError } from "@agentlife/shared";
import { FakeEngineLink } from "./fake-engine.ts";
import type { EngineLink } from "./engine-link.ts";
import { startGateway } from "./gateway.ts";
import { HttpEngineLink } from "./http-engine.ts";
import { LayoutStore, defaultLayoutsFile } from "./layout-store.ts";
import { ROOMS_DIR, loadHotelRooms } from "./load-room.ts";
import { parseAllowedOrigins } from "./origin.ts";

/** Load and validate the room files; exit with the invalid field path(s) when one is bad. */
function loadRooms() {
  try {
    return loadHotelRooms();
  } catch (e) {
    if (e instanceof RoomValidationError) {
      console.error(`${ROOMS_DIR}\n${e.message}`);
    } else {
      console.error(`Cannot load the rooms in ${ROOMS_DIR}: ${e instanceof Error ? e.message : String(e)}`);
    }
    process.exit(1);
  }
}

const hotelRooms = loadRooms();
const layouts = new LayoutStore({ file: defaultLayoutsFile(), onLog: (m) => console.warn(m) });
const hotel = new Hotel({ ...hotelRooms, clock: Date.now, layoutOf: (projectId) => layouts.get(projectId) });
const port = Number(process.env["PORT"] ?? 8787);
const host = process.env["HOST"] ?? "127.0.0.1";
const allowedOrigins = parseAllowedOrigins(process.env["WORLD_ALLOWED_ORIGINS"]);

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
const gateway = await startGateway({ hotel, host, port, engine, allowedOrigins, layouts });
console.log(`world-server listening on ws://${host}:${gateway.port} (allowed origins: ${allowedOrigins.join(", ")})`);
