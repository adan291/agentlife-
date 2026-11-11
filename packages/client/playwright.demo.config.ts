import { defineConfig } from "@playwright/test";

const PORT = 5198;
/** Same sub-path as GitHub Pages, so the test also covers base-path-safe asset URLs. */
const BASE = "/agentlife/";
const channel = process.env["E2E_CHANNEL"];

/**
 * Smoke test of the public demo (`pnpm --filter @agentlife/client e2e:demo`). It builds the client with
 * `VITE_MODE=demo` and serves the build with `vite preview`; no world-server is started.
 * `E2E_CHANNEL=msedge` (or `chrome`) uses an installed browser; otherwise run `pnpm exec playwright install chromium` once.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "demo.spec.ts",
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE}`,
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: `pnpm exec vite build --base=${BASE} --outDir dist-demo --emptyOutDir && pnpm exec vite preview --base=${BASE} --outDir dist-demo --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}${BASE}`,
    env: { VITE_MODE: "demo" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
