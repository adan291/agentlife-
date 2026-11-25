// Records the submission video: docs/video-script.md played through the hotel, with the Windows voice and captions.
// `pnpm --filter @agentlife/client video` (Windows, Edge). Output: data/video/agentlife.webm, agentlife.srt.
// The job scenes use the demo build (a recorded real run); the game-layer scenes use a scripted hotel with scratch files.
import { expect, test } from "@playwright/test";
import type { Frame, Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VIDEO_URLS } from "../playwright.video.config.ts";
import { director, esc } from "./director.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "data", "video");
const VOICE = join(OUT, "voice");

/** The narration, scene by scene (docs/video-script.md, adapted to what the hotel shows). */
const LINES = {
  hook: "AI agents write code fast. But who checked the plan? Who ran the tests? Who reviewed the diff?",
  idea: "AGENT LIFE is an isometric virtual hotel. The residents are real AI agents, and the furniture is the interface.",
  reception: "Register a git project at the Reception. The hotel gives it its own floor and its own team.",
  start: "On the project's floor, open the computer and describe the change. This is a replay of a real run.",
  architect: "The Architect reads the repository and writes a plan. It is read-only: it cannot change a file.",
  gate: "Nothing is built until you approve the plan. This is the one step the hotel never skips.",
  build: "The Developer edits an isolated copy, with no shell and no network. The engine checks the diff, then runs the tests in Docker, offline, with limits.",
  report: "QA reviews the diff and the test log. The report arrives in the mailbox. In your own project, Deliver turns it into a branch. Your working copy is never touched.",
  models: "In this run all three agents used a small local model through Ollama. Kiro is the default, and any compatible AI can take a desk.",
  shop: "While the agents work, you earn Ecto, but only from verified results. Spend it in the shop on furniture and outfits.",
  hr: "Dress your team at the HR desk, where you also hire, rename and change their models.",
  wisp: "And while a job runs, catch the wisps.",
  builder: "Kiro built this hotel from specs. Every session follows the steering rules, commits one task at a time, and verifies before it merges. The construction board shows the plan, live.",
  product: "The hotel's own agents run as headless kiro-cli processes. No trust flags. Every permission is in a file you can read.",
  close: "Try the demo. The code and the notes on how Kiro was used are in the repository.",
} as const;
type LineId = keyof typeof LINES;

/** One WAV per line with the Windows voice; none elsewhere (the captions then set the pace). */
function makeVoice(): Map<LineId, Buffer> {
  const out = new Map<LineId, Buffer>();
  if (process.platform !== "win32") return out;
  rmSync(VOICE, { recursive: true, force: true });
  mkdirSync(VOICE, { recursive: true });
  const input = join(tmpdir(), "agentlife-video-lines.json");
  writeFileSync(input, JSON.stringify(Object.entries(LINES).map(([id, text]) => ({ id, text }))), "utf8");
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "narrate.ps1"), "-InputJson", input, "-OutDir", VOICE], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`narration failed: ${r.stderr}`);
  for (const id of Object.keys(LINES) as LineId[]) {
    const f = join(VOICE, `${id}.wav`);
    if (existsSync(f)) out.set(id, readFileSync(f));
  }
  return out;
}

const card = (inner: string): string => inner;
const titleCard = (title: string, lines: string[]): string =>
  card(`<h1>${esc(title)}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}`);

/** The iframe that shows the hotel. */
const hotelFrame = (page: Page): Frame => {
  const f = page.frames().find((x) => x !== page.mainFrame());
  if (!f) throw new Error("no hotel frame");
  return f;
};

const TILE_W = 64;
const TILE_H = 32;
const CENTRES = { lobby: { x: 32, y: 112 }, hr: { x: 32, y: 80 }, project: { x: 32, y: 112 } } as const;

/** Where the middle of a tile is in the window (same rule as e2e/support/world.ts). */
async function tilePoint(f: Frame, room: keyof typeof CENTRES, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await f.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoom = Number.parseInt((await f.locator(".al-top-right").getAttribute("data-zoom")) ?? "1", 10);
  const c = CENTRES[room];
  const rootX = Math.round(Math.floor(canvas.width) / 2 - c.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - c.y * zoom);
  return { x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2, y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2 };
}

/** Moves the mouse there over a short path (so the pointer is seen travelling), then clicks. */
async function clickAt(page: Page, p: { x: number; y: number }): Promise<void> {
  await page.mouse.move(p.x, p.y, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.click(p.x, p.y);
}

async function clickPiece(page: Page, f: Frame, room: keyof typeof CENTRES, x: number, y: number): Promise<void> {
  const p = await tilePoint(f, room, x, y);
  await clickAt(page, { x: p.x, y: p.y - 12 });
}

async function waitForRoom(f: Frame, label: string): Promise<void> {
  try {
    await expect(f.locator(".al-stage > canvas")).toBeVisible({ timeout: 30_000 });
  } catch (e) {
    await f.page().screenshot({ path: join(OUT, "debug.png") });
    throw new Error(`the hotel did not load in the frame (${f.url()}); see data/video/debug.png. ${String(e).slice(0, 200)}`);
  }
  await expect(f.locator(".al-floor-label")).toHaveText(label, { timeout: 30_000 });
  await expect(f.locator(".al-doors")).toHaveAttribute("data-phase", "open", { timeout: 30_000 });
}

async function goTo(page: Page, f: Frame, floor: string): Promise<void> {
  await f.getByRole("button", { name: /Take the elevator/ }).click();
  const panel = f.getByRole("dialog", { name: "Elevator" });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(700);
  await panel.getByRole("button", { name: `Go to ${floor}` }).click();
  await waitForRoom(f, floor);
}

const SNIPPET_TASKS = `- [x] 1. kiro-cli spike (run early; it gates this spec)
  - Verify KIRO_API_KEY auth, agent lookup, stream-json record shapes,
    write-outside-cwd denied, shell denied, credits per run
- [x] 2. Fixture repository haunted-todo
- [x] 3. Materialise step
- [x] 4. Role agents and prompts
- [x] 5. KiroCliRuntime`;
const SNIPPET_STEERING = `# Working protocol (every session)
1. Read the current status (docs/STATUS.md) and the spec named in the request.
2. Work only on the tasks the user asked for, in order.
3. Work on a branch named after the spec: \`feat/<spec-name>\`.
- Mark a task done in tasks.md only after \`pnpm check\` passes
  and the task's acceptance criteria are met.`;
const SNIPPET_CLI = `// The prompt goes to stdin. No \`--trust-*\` flag is ever passed:
// the agent file is the only grant surface.
return [
  "chat", "--v3", "--no-interactive",
  "--output-format", "stream-json",
  "--agent", member.agent ?? agentName(role),
  ...(model ? ["--model", model] : []),
];`;
const SNIPPET_AGENT = `"name": "agentlife-developer",
"tools": ["read", "write"],
"permissions": { "rules": [
  { "capability": "fs_read",   "match": ["**"],                      "effect": "allow" },
  { "capability": "fs_read",   "match": [".env", ".env.*", "*.pem", …], "effect": "deny" },
  { "capability": "fs_write",  "match": ["./**"],                    "effect": "allow" },
  { "capability": "fs_write",  "match": [".git/**", ".env", …],        "effect": "deny" },
  { "capability": "shell",     "match": ["*"],                       "effect": "deny" },
  { "capability": "web_fetch", "match": ["*"],                       "effect": "deny" } ] }`;

test("record the submission video", async ({ page, context }) => {
  mkdirSync(OUT, { recursive: true });
  const webm = join(OUT, "agentlife.webm");
  rmSync(webm, { force: true });
  const voice = makeVoice();

  // The hotels start without the first-visit guide; the scripted one in the lobby, the demo on its recorded floor.
  await context.addInitScript(() => {
    if (location.port === "5194") return;
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    if (!location.pathname.startsWith("/agentlife/")) sessionStorage.setItem("agentlife-floor", "lobby");
  });
  await page.exposeFunction("saveChunk", (b64: string) => appendFileSync(webm, Buffer.from(b64, "base64")));
  await page.goto(VIDEO_URLS.director);
  const d = director(page);
  const say = (id: LineId, minMs = 0): Promise<void> => d.say(id, LINES[id], voice.get(id), minMs);

  // Load the scripted hotel behind the first card, so the cut to the lobby is clean.
  await d.frame(VIDEO_URLS.live);
  await d.card(titleCard("Who checked the work?", ["A plan nobody read.", "Tests nobody ran.", "A diff nobody reviewed."]));
  await d.start();

  // 0:00 Hook.
  await say("hook", 1500);

  // The idea: the lobby.
  await d.card(titleCard("AGENT LIFE", ['An isometric hotel whose residents are <span class="accent">real AI agents</span> doing verifiable software work.']));
  await d.wait(1800);
  const live = hotelFrame(page);
  await waitForRoom(live, "Lobby");
  await d.card(null);
  await say("idea", 1000);

  // Register a project: the Reception.
  await clickPiece(page, live, "lobby", 1, 0);
  await expect(live.locator(".al-panel h3").first()).toHaveText(/Reception/, { timeout: 15_000 });
  await say("reception", 1500);
  await page.keyboard.press("Escape");

  // The job: the demo replay of the real run on haunted-todo.
  await d.frame(VIDEO_URLS.demo);
  await d.wait(500);
  const demo = hotelFrame(page);
  await expect(demo.getByRole("status").filter({ hasText: "Replay of a real run recorded on" })).toBeVisible({ timeout: 30_000 });
  await expect(demo.locator(".al-stage > canvas")).toBeVisible();
  const sayStart = say("start");
  await clickPiece(page, demo, "project", 3, 7);
  const computer = demo.locator(".al-panel");
  const opened = await computer.locator("h3").first().textContent({ timeout: 8000 }).catch(() => null);
  await sayStart;
  if (opened?.includes("Computer")) {
    await d.wait(600);
    await computer.getByRole("button", { name: "Start job" }).click();
    await page.keyboard.press("Escape");
  } else {
    // The computer could not be reached at this size: start from the replay's own entry.
    await d.frame(`${VIDEO_URLS.demo}?autostart`);
    await d.wait(1500);
  }
  const replay = hotelFrame(page);

  // Architect at work, at 4x.
  await replay.getByRole("button", { name: "4×" }).click();
  await say("architect", 4000);
  const openMailbox = replay.getByRole("button", { name: /Open mailbox/ });
  await expect(openMailbox).toBeVisible({ timeout: 120_000 });

  // The human gate, at 1x.
  await replay.getByRole("button", { name: "1×" }).click();
  await openMailbox.click();
  const panel = replay.locator(".al-panel");
  await expect(panel.locator("h3").first()).toHaveText("Mailbox");
  await say("gate", 1500);
  await panel.getByRole("button", { name: "Approve", exact: true }).click();
  await page.keyboard.press("Escape");

  // Build and test, at 4x.
  await replay.getByRole("button", { name: "4×" }).click();
  await say("build", 3000);
  const openReport = replay.getByRole("button", { name: /Open report/ });
  await expect(openReport).toBeVisible({ timeout: 180_000 });

  // QA and the report, at 1x.
  await replay.getByRole("button", { name: "1×" }).click();
  await openReport.click();
  await expect(panel.locator("h3").first()).toHaveText("Mailbox");
  const row = panel.locator(".al-report-item").first();
  if (await row.isVisible().catch(() => false)) await row.click();
  const sayReport = say("report");
  // Scroll the report slowly so the diff, the test log and the verdict pass by. The pointer waits over the team bar, so
  // no tooltip of the room shows through the panel.
  await page.mouse.move(110, 470, { steps: 10 });
  for (let i = 0; i < 6; i++) {
    await d.wait(1100);
    await panel.evaluate((el) => {
      const box = [el, ...el.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 4 && getComputedStyle(n).overflowY !== "visible");
      box?.scrollBy({ top: 260, behavior: "smooth" });
    });
  }
  await sayReport;
  await say("models", 500);
  await page.keyboard.press("Escape");

  // The game layer, in the scripted hotel: shop, HR, a wisp.
  await d.frame(VIDEO_URLS.live);
  await d.wait(500);
  const game = hotelFrame(page);
  await waitForRoom(game, "Lobby");
  await clickPiece(page, game, "lobby", 4, 4);
  const shop = game.getByRole("dialog", { name: "Shop" });
  await expect(shop).toBeVisible({ timeout: 15_000 });
  const sayShop = say("shop");
  await d.wait(1200);
  await shop.getByRole("tab", { name: "Outfits" }).click();
  await d.wait(900);
  const cap = shop.locator('.al-shop-item[data-part="flat_cap"]');
  await cap.getByRole("button", { name: /^Buy Checked flat cap/ }).click();
  await expect(cap).toContainText("Owned");
  await sayShop;
  await shop.getByRole("button", { name: "Close panel" }).click();

  await goTo(page, game, "HR Office");
  await clickPiece(page, game, "hr", 4, 0);
  const hr = game.getByRole("dialog", { name: "HR desk" });
  await expect(hr).toBeVisible({ timeout: 15_000 });
  const sayHr = say("hr");
  const member = hr.locator('section[data-project="haunted-todo"] li[data-member="developer"]');
  // The look of the member at the top of the panel (the scripted hotel's model name, "fake", stays out of the picture).
  await member.locator(".al-look-preview").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  await page.mouse.move(110, 470, { steps: 10 });
  await d.wait(900);
  await member.locator('select[data-slot="hat"]').selectOption("flat_cap");
  await sayHr;
  await hr.getByRole("button", { name: "Close panel" }).click();

  await goTo(page, game, "haunted-todo");
  await clickPiece(page, game, "project", 3, 7);
  const gamePanel = game.locator(".al-panel");
  await expect(gamePanel.locator("h3").first()).toHaveText("Computer", { timeout: 15_000 });
  await gamePanel.locator("textarea").fill("Add a title check to addTodo");
  await gamePanel.getByRole("button", { name: "Start job" }).click();
  await page.keyboard.press("Escape");
  const wisp = game.locator(".al-wisp:not([hidden])");
  await expect(wisp).toBeVisible({ timeout: 20_000 });
  const sayWisp = say("wisp", 1200);
  const box = await wisp.boundingBox();
  if (box) await clickAt(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await sayWisp;

  // Kiro as the builder: the spec, the steering, the construction board.
  await d.card(
    `<h2>Built with Kiro, from specs</h2><div class="file">.kiro/specs/agent-pipeline/tasks.md</div><pre>${esc(SNIPPET_TASKS)}</pre>` +
      `<div class="file">.kiro/steering/workflow.md</div><pre>${esc(SNIPPET_STEERING)}</pre>`,
  );
  const sayBuilder = say("builder");
  await d.wait(6500);
  await d.card(null);
  await goTo(page, game, "Lobby");
  await clickPiece(page, game, "lobby", 7, 0);
  await sayBuilder;
  await page.keyboard.press("Escape");

  // Kiro in the product.
  await d.card(
    `<h2>Kiro inside the product</h2><div class="file">packages/agent-engine/src/runtimes/kiro-cli.ts</div><pre>${esc(SNIPPET_CLI)}</pre>` +
      `<div class="file">packages/agent-engine/agents/agentlife-developer.json</div><pre>${esc(SNIPPET_AGENT)}</pre>`,
  );
  await say("product", 1500);

  // Close.
  await d.card(
    titleCard("AGENT LIFE", [
      'Demo: <span class="accent">adan291.github.io/agentlife-</span>',
      'Code: <span class="accent">github.com/adan291/agentlife-</span>',
      "Kiroween 2026 · Resurrection",
    ]),
  );
  await say("close", 2500);
  await d.stop();

  writeFileSync(join(OUT, "agentlife.srt"), d.srt(), "utf8");
  expect(existsSync(webm)).toBe(true);
});
