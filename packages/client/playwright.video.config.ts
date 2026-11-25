import { defineConfig } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * The video recorder (`pnpm --filter @agentlife/client video`). Not a test: it plays docs/video-script.md through the
 * hotel and records the tab to data/video/. It starts its own servers on ports nobody else uses:
 * - the demo build (the recorded real run), for the job scenes;
 * - a scripted hotel with scratch files (a wallet with Ecto, an HR office, fast wisps), for the game layer.
 * Nothing in data/ of the hotel is read or written, except the output folder data/video/.
 */
const DEMO_PORT = 5192;
const LIVE_WEB_PORT = 5193;
const LIVE_WORLD_PORT = 8799;
const DIRECTOR_PORT = 5194;
const BASE = "/agentlife/";
const scratch = (name: string): string => join(tmpdir(), `agentlife-video-${name}.json`);

if (process.env["TEST_WORKER_INDEX"] === undefined) {
  const seed = (file: string, value: unknown): void => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
  };
  seed(scratch("wallet"), { version: 1, since: 0, balance: 500, ledger: [], granted: [] });
  seed(scratch("inventory"), { version: 1, stock: {}, placed: {}, seq: 0 });
  seed(scratch("wardrobe"), { version: 1, owned: [] });
  for (const f of ["outfits", "layouts"]) rmSync(scratch(f), { force: true });
}

export default defineConfig({
  testDir: "video",
  testMatch: "record.spec.ts",
  timeout: 15 * 60_000,
  workers: 1,
  reporter: "list",
  use: {
    // Edge: the recorder needs a real browser build for tab capture with sound.
    channel: process.env["E2E_CHANNEL"] ?? "msedge",
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ["--auto-accept-this-tab-capture", "--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: [
    {
      command: `pnpm exec vite build --base=${BASE} --outDir dist-video --emptyOutDir && pnpm exec vite preview --base=${BASE} --outDir dist-video --host 127.0.0.1 --port ${DEMO_PORT} --strictPort`,
      url: `http://127.0.0.1:${DEMO_PORT}${BASE}`,
      env: { VITE_MODE: "demo" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @agentlife/world-server start",
      cwd: "../..",
      port: LIVE_WORLD_PORT,
      env: {
        PORT: String(LIVE_WORLD_PORT),
        ENGINE: "fake",
        FAKE_HR: "1",
        FAKE_PANELS: "1",
        FAKE_DELIVER: "1",
        FAKE_DELAY_MS: "500",
        AGENTLIFE_WISP_MS: "600,900",
        AGENTLIFE_WALLET_FILE: scratch("wallet"),
        AGENTLIFE_INVENTORY_FILE: scratch("inventory"),
        AGENTLIFE_WARDROBE_FILE: scratch("wardrobe"),
        AGENTLIFE_OUTFITS_FILE: scratch("outfits"),
        AGENTLIFE_LAYOUTS_FILE: scratch("layouts"),
        WORLD_ALLOWED_ORIGINS: `http://127.0.0.1:${LIVE_WEB_PORT}`,
      },
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${LIVE_WEB_PORT} --strictPort`,
      port: LIVE_WEB_PORT,
      env: { VITE_WORLD_URL: `ws://127.0.0.1:${LIVE_WORLD_PORT}` },
      reuseExistingServer: false,
    },
    {
      command: "node --experimental-strip-types --no-warnings video/serve-director.ts",
      url: `http://127.0.0.1:${DIRECTOR_PORT}/`,
      env: { PORT: String(DIRECTOR_PORT) },
      reuseExistingServer: false,
    },
  ],
});

export const VIDEO_URLS = {
  demo: `http://127.0.0.1:${DEMO_PORT}${BASE}`,
  live: `http://127.0.0.1:${LIVE_WEB_PORT}/`,
  director: `http://127.0.0.1:${DIRECTOR_PORT}/`,
};
