import { defineConfig } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/** Ports are not the dev defaults (5173, 8787), so a running dev session does not collide with the test. */
const WORLD_PORT = 8795;
const WEB_PORT = 5199;
const channel = process.env["E2E_CHANNEL"];
/** The arrange tests save layouts; they go to a scratch file, never to `data/layouts.json`. */
const LAYOUTS_FILE = join(tmpdir(), "agentlife-e2e-layouts.json");
/** The shop tests earn and spend Ecto; the wallet and the inventory are scratch files too, never `data/`. */
const WALLET_FILE = join(tmpdir(), "agentlife-e2e-wallet.json");
const INVENTORY_FILE = join(tmpdir(), "agentlife-e2e-inventory.json");
/** Outfits bought in the shop (ghost-skins) go to a scratch wardrobe as well. */
const WARDROBE_FILE = join(tmpdir(), "agentlife-e2e-wardrobe.json");

/**
 * The team-progress tests run one scripted job and check XP, badges and quests, which would add toasts, level-ups and
 * Ecto to every other test. They get a world-server of their own (and a Vite server pointed at it) with scratch files.
 */
const PROGRESS_WORLD_PORT = 8796;
const PROGRESS_WEB_PORT = 5198;
const PROGRESS_FILE = join(tmpdir(), "agentlife-e2e-progress.json");
const PROGRESS_WALLET_FILE = join(tmpdir(), "agentlife-e2e-progress-wallet.json");
const PROGRESS_INVENTORY_FILE = join(tmpdir(), "agentlife-e2e-progress-inventory.json");
const PROGRESS_WARDROBE_FILE = join(tmpdir(), "agentlife-e2e-progress-wardrobe.json");
const PROGRESS_LAYOUTS_FILE = join(tmpdir(), "agentlife-e2e-progress-layouts.json");
/**
 * The waiting-fun tests need wisps to appear within a second of a job starting (`AGENTLIFE_WISP_MS`), and they catch them,
 * which changes the balance. They get a world-server of their own too, so wisps never show up in the other specs.
 */
const FUN_WORLD_PORT = 8797;
const FUN_WEB_PORT = 5197;
const FUN_WALLET_FILE = join(tmpdir(), "agentlife-e2e-fun-wallet.json");
const FUN_INVENTORY_FILE = join(tmpdir(), "agentlife-e2e-fun-inventory.json");
const FUN_WARDROBE_FILE = join(tmpdir(), "agentlife-e2e-fun-wardrobe.json");
const FUN_LAYOUTS_FILE = join(tmpdir(), "agentlife-e2e-fun-layouts.json");
/**
 * The outfit tests (ghost-skins) put a part on a team member at the HR desk. The scripted engine has no HR office, so they get
 * a world-server of their own whose engine has one (`FAKE_HR=1`: the default team of the one project) and scratch files.
 */
const WEAR_WORLD_PORT = 8798;
const WEAR_WEB_PORT = 5196;
const WEAR_WALLET_FILE = join(tmpdir(), "agentlife-e2e-wear-wallet.json");
const WEAR_INVENTORY_FILE = join(tmpdir(), "agentlife-e2e-wear-inventory.json");
const WEAR_WARDROBE_FILE = join(tmpdir(), "agentlife-e2e-wear-wardrobe.json");
const WEAR_OUTFITS_FILE = join(tmpdir(), "agentlife-e2e-wear-outfits.json");
const WEAR_LAYOUTS_FILE = join(tmpdir(), "agentlife-e2e-wear-layouts.json");
/** The other servers never put anything on anybody, but they must not read or write the real `data/outfits.json` either. */
const OUTFITS_FILE = join(tmpdir(), "agentlife-e2e-outfits.json");
const PROGRESS_OUTFITS_FILE = join(tmpdir(), "agentlife-e2e-progress-outfits.json");
const FUN_OUTFITS_FILE = join(tmpdir(), "agentlife-e2e-fun-outfits.json");
/** A quest pool that one scripted job finishes whichever three the date picks: plan, steps and a pass. */
const QUESTS_FILE = join(tmpdir(), "agentlife-e2e-quests.json");
const QUEST_POOL = [
  { id: "q_plan", title: "Approve a plan", counter: "plan_approved", target: 1, reward: 10 },
  { id: "q_pass", title: "Get a job to pass", counter: "job_passed", target: 1, reward: 20 },
  { id: "q_steps", title: "Finish three steps", counter: "step_done", target: 3, reward: 15 },
  { id: "q_step", title: "Finish a step", counter: "step_done", target: 1, reward: 5 },
  { id: "q_two", title: "Finish two steps", counter: "step_done", target: 2, reward: 8 },
  { id: "q_pass_b", title: "Get a job to pass again", counter: "job_passed", target: 1, reward: 12 },
];

/**
 * The fake engine's jobs earn nothing, so the tests that buy furniture start from a scratch wallet with Ecto in it and an
 * empty inventory. Written when the runner loads this file, before the web servers start (a worker that loads it again
 * must not rewrite files under a running world-server).
 */
if (process.env["TEST_WORKER_INDEX"] === undefined) {
  const seed = (file: string, value: unknown): void => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
  };
  seed(WALLET_FILE, { version: 1, since: 0, balance: 500, ledger: [], granted: [] });
  seed(INVENTORY_FILE, { version: 1, stock: {}, placed: {}, seq: 0 });
  seed(WARDROBE_FILE, { version: 1, owned: [] });
  // The progress server starts from nothing: the fake engine reuses task ids, and a file from an earlier run would have counted them.
  seed(PROGRESS_WALLET_FILE, { version: 1, since: 0, balance: 0, ledger: [], granted: [] });
  seed(PROGRESS_INVENTORY_FILE, { version: 1, stock: {}, placed: {}, seq: 0 });
  seed(PROGRESS_WARDROBE_FILE, { version: 1, owned: [] });
  seed(FUN_WALLET_FILE, { version: 1, since: 0, balance: 0, ledger: [], granted: [] });
  seed(FUN_INVENTORY_FILE, { version: 1, stock: {}, placed: {}, seq: 0 });
  seed(FUN_WARDROBE_FILE, { version: 1, owned: [] });
  // The outfits tests start from a hotel where nobody wears anything and the user can pay for a part.
  seed(WEAR_WALLET_FILE, { version: 1, since: 0, balance: 500, ledger: [], granted: [] });
  seed(WEAR_INVENTORY_FILE, { version: 1, stock: {}, placed: {}, seq: 0 });
  seed(WEAR_WARDROBE_FILE, { version: 1, owned: [] });
  for (const file of [WEAR_OUTFITS_FILE, OUTFITS_FILE, PROGRESS_OUTFITS_FILE, FUN_OUTFITS_FILE, WEAR_LAYOUTS_FILE]) rmSync(file, { force: true });
  seed(QUESTS_FILE, { version: 1, quests: QUEST_POOL });
  rmSync(PROGRESS_FILE, { force: true });
}

/**
 * Layout smoke test (`pnpm --filter @agentlife/client e2e`). Not part of `pnpm check`: it needs a browser.
 * It starts the world-server (fake engine) and the Vite dev server itself.
 * `E2E_CHANNEL=msedge` (or `chrome`) uses an installed browser; otherwise run `pnpm exec playwright install chromium` once.
 */
export default defineConfig({
  testDir: "e2e",
  // demo.spec.ts belongs to playwright.demo.config.ts (it needs a demo build). CI sets E2E_SKIP_VISUALS=1: the baselines are
  // made on the developer's machine (Edge on Windows) and a runner draws text a little differently, so the visual
  // comparisons run in the conductor, not in CI (design.md of regression-suite).
  testIgnore: process.env["E2E_SKIP_VISUALS"] === "1" ? ["demo.spec.ts", "visuals.spec.ts"] : "demo.spec.ts",
  timeout: 30_000,
  // The world-server serves one user at a time: a second page would replace the first.
  workers: 1,
  // The HTML report keeps the expected, actual and diff images of a failed visual comparison (`pnpm exec playwright show-report`).
  // The conductor asks for a JSON report too (PLAYWRIGHT_JSON_OUTPUT_NAME) to tell a failed test from a flaky one.
  reporter: [["list"], ["html", { open: "never" }], ...(process.env["PLAYWRIGHT_JSON_OUTPUT_NAME"] ? [["json"] as ["json"]] : [])],
  // Visual baselines (visuals.spec.ts) are kept per platform: Windows and Linux draw text differently. A platform with no
  // folder under `e2e/__visuals__/` skips the visual step and says so; `pnpm --filter @agentlife/client e2e:update-visuals` writes it.
  snapshotPathTemplate: "{testDir}/__visuals__/{platform}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // The page's own CSS transitions end at once and the text caret is hidden; the rest is frozen by `freezeForScreenshots`.
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
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
        AGENTLIFE_LAYOUTS_FILE: LAYOUTS_FILE,
        AGENTLIFE_WALLET_FILE: WALLET_FILE,
        AGENTLIFE_INVENTORY_FILE: INVENTORY_FILE,
        AGENTLIFE_WARDROBE_FILE: WARDROBE_FILE,
        AGENTLIFE_OUTFITS_FILE: OUTFITS_FILE,
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
    {
      command: "pnpm --filter @agentlife/world-server start",
      cwd: "../..",
      port: PROGRESS_WORLD_PORT,
      env: {
        PORT: String(PROGRESS_WORLD_PORT),
        ENGINE: "fake",
        AGENTLIFE_LAYOUTS_FILE: PROGRESS_LAYOUTS_FILE,
        AGENTLIFE_WALLET_FILE: PROGRESS_WALLET_FILE,
        AGENTLIFE_INVENTORY_FILE: PROGRESS_INVENTORY_FILE,
        AGENTLIFE_WARDROBE_FILE: PROGRESS_WARDROBE_FILE,
        AGENTLIFE_OUTFITS_FILE: PROGRESS_OUTFITS_FILE,
        AGENTLIFE_PROGRESS_FILE: PROGRESS_FILE,
        AGENTLIFE_QUESTS_FILE: QUESTS_FILE,
        WORLD_ALLOWED_ORIGINS: `http://127.0.0.1:${PROGRESS_WEB_PORT},http://localhost:${PROGRESS_WEB_PORT}`,
      },
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${PROGRESS_WEB_PORT} --strictPort`,
      port: PROGRESS_WEB_PORT,
      env: { VITE_WORLD_URL: `ws://127.0.0.1:${PROGRESS_WORLD_PORT}` },
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: "pnpm --filter @agentlife/world-server start",
      cwd: "../..",
      port: FUN_WORLD_PORT,
      env: {
        PORT: String(FUN_WORLD_PORT),
        ENGINE: "fake",
        AGENTLIFE_LAYOUTS_FILE: FUN_LAYOUTS_FILE,
        AGENTLIFE_WALLET_FILE: FUN_WALLET_FILE,
        AGENTLIFE_INVENTORY_FILE: FUN_INVENTORY_FILE,
        AGENTLIFE_WARDROBE_FILE: FUN_WARDROBE_FILE,
        AGENTLIFE_OUTFITS_FILE: FUN_OUTFITS_FILE,
        AGENTLIFE_WISP_MS: "300,500",
        WORLD_ALLOWED_ORIGINS: `http://127.0.0.1:${FUN_WEB_PORT},http://localhost:${FUN_WEB_PORT}`,
      },
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${FUN_WEB_PORT} --strictPort`,
      port: FUN_WEB_PORT,
      env: { VITE_WORLD_URL: `ws://127.0.0.1:${FUN_WORLD_PORT}` },
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: "pnpm --filter @agentlife/world-server start",
      cwd: "../..",
      port: WEAR_WORLD_PORT,
      env: {
        PORT: String(WEAR_WORLD_PORT),
        ENGINE: "fake",
        FAKE_HR: "1",
        AGENTLIFE_LAYOUTS_FILE: WEAR_LAYOUTS_FILE,
        AGENTLIFE_WALLET_FILE: WEAR_WALLET_FILE,
        AGENTLIFE_INVENTORY_FILE: WEAR_INVENTORY_FILE,
        AGENTLIFE_WARDROBE_FILE: WEAR_WARDROBE_FILE,
        AGENTLIFE_OUTFITS_FILE: WEAR_OUTFITS_FILE,
        WORLD_ALLOWED_ORIGINS: `http://127.0.0.1:${WEAR_WEB_PORT},http://localhost:${WEAR_WEB_PORT}`,
      },
      reuseExistingServer: !process.env["CI"],
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${WEAR_WEB_PORT} --strictPort`,
      port: WEAR_WEB_PORT,
      env: { VITE_WORLD_URL: `ws://127.0.0.1:${WEAR_WORLD_PORT}` },
      reuseExistingServer: !process.env["CI"],
    },
  ],
});
