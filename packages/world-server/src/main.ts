import { Hotel, RoomValidationError } from "@agentlife/shared";
import { FakeEngineLink } from "./fake-engine.ts";
import type { EngineLink } from "./engine-link.ts";
import { Economy, defaultWalletFile, loadEconomyConfig } from "./economy-store.ts";
import { startGateway } from "./gateway.ts";
import { HttpEngineLink } from "./http-engine.ts";
import { LayoutStore, defaultLayoutsFile } from "./layout-store.ts";
import { ROOMS_DIR, loadHotelRooms } from "./load-room.ts";
import { ProgressStore, defaultProgressFile, loadBadges, loadProgressConfig, loadQuests } from "./progress-store.ts";
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

// Ecto is earned by real work: the scripted engine's jobs are not, so they do not pay into the user's real wallet.
// A wallet file named in the environment (tests, Playwright) turns the economy on for any engine.
let economy: Economy | undefined;
if (engineKind === "http" || process.env["AGENTLIFE_WALLET_FILE"]) {
  try {
    economy = new Economy({ walletFile: defaultWalletFile(), config: loadEconomyConfig(), onLog: (m) => console.warn(m) });
  } catch (e) {
    console.error(`Cannot start the economy: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// XP and levels follow the same rule: only real work counts. A progress file named in the environment (tests, Playwright)
// turns it on for any engine.
let progress: ProgressStore | undefined;
if (engineKind === "http" || process.env["AGENTLIFE_PROGRESS_FILE"]) {
  try {
    progress = new ProgressStore({ file: defaultProgressFile(), config: loadProgressConfig(), badges: loadBadges(), quests: loadQuests(), onLog: (m) => console.warn(m) });
  } catch (e) {
    console.error(`Cannot start the progress store: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// The floors are built from the template, the saved layout and the bought pieces the user placed.
const hotel = new Hotel({
  ...hotelRooms,
  clock: Date.now,
  layoutOf: (projectId) => layouts.get(projectId),
  extrasOf: (projectId) => economy?.placedFurni(projectId) ?? [],
});

const gateway = await startGateway({ hotel, host, port, engine, allowedOrigins, layouts, ...(economy ? { economy } : {}), ...(progress ? { progress } : {}) });
console.log(`world-server listening on ws://${host}:${gateway.port} (allowed origins: ${allowedOrigins.join(", ")})`);
