import { defineConfig } from "@playwright/test";

/** Ports are not the dev defaults (5173, 8787), so a running dev session does not collide with the test. */
const WORLD_PORT = 8795;
const WEB_PORT = 5199;
const channel = process.env["E2E_CHANNEL"];

/**
 * Layout smoke test (`pnpm --filter @agentlife/client e2e`). Not part of `pnpm check`: it needs a browser.
 * It starts the world-server (fake engine) and the Vite dev server itself.
 * `E2E_CHANNEL=msedge` (or `chrome`) uses an installed browser; otherwise run `pnpm exec playwright install chromium` once.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    ...(channel ? { channel } : {}),
  },
  webServer: [
    {
      command: "pnpm --filter @agentlife/world-server start",
      cwd: "../..",
      port: WORLD_PORT,
      env: {
        PORT: String(WORLD_PORT),
        ENGINE: "fake",
        // The page is served from WEB_PORT, so the Origin check must allow it.
        WORLD_ALLOWED_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
      },
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      port: WEB_PORT,
      env: { VITE_WORLD_URL: `ws://127.0.0.1:${WORLD_PORT}` },
      reuseExistingServer: !process.env["CI"],
    },
  ],
});
