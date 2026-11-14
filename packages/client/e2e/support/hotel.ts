import type { Page } from "@playwright/test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The address the client was built with by the Vite server of the main test server (`playwright.config.ts`). */
const BUILT_IN_WORLD_URL = /^ws:\/\/127\.0\.0\.1:8795\/?$/;

const WORLD_SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "world-server");

/** A quest pool that one scripted job finishes whichever three the date picks: a plan, steps and a pass. */
const QUEST_POOL = [
  { id: "q_plan", title: "Approve a plan", counter: "plan_approved", target: 1, reward: 10 },
  { id: "q_pass", title: "Get a job to pass", counter: "job_passed", target: 1, reward: 20 },
  { id: "q_steps", title: "Finish three steps", counter: "step_done", target: 3, reward: 15 },
  { id: "q_step", title: "Finish a step", counter: "step_done", target: 1, reward: 5 },
  { id: "q_two", title: "Finish two steps", counter: "step_done", target: 2, reward: 8 },
  { id: "q_pass_b", title: "Get a job to pass again", counter: "job_passed", target: 1, reward: 12 },
];

/** What the user can pay with at the start of a journey. */
export const START_BALANCE = 500;

export interface Hotel {
  /** `ws://127.0.0.1:<port>` of this hotel's own world-server. */
  readonly url: string;
  /** The scratch folder: wallet, inventory, wardrobe, outfits, layouts, progress and quests of this hotel only. */
  readonly dir: string;
  /** Every text frame the page sent to this hotel, oldest first (the page cannot be asked what it sent). */
  readonly sent: string[];
  /** Sends the page's world connection to this hotel instead of the one the client was built with. */
  attach(page: Page): Promise<void>;
  /** Stops the world-server and removes the scratch folder. */
  stop(): Promise<void>;
}

/** A free TCP port: listen on 0, read the number, close. The gap before the server binds it is a few milliseconds. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

function waitForListening(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`the scratch world-server did not start in 30 s:\n${log}`)), 30_000);
    const onData = (chunk: Buffer): void => {
      log += chunk.toString("utf8");
      if (log.includes("world-server listening")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => {
      log += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the scratch world-server exited with code ${String(code)}:\n${log}`));
    });
  });
}

/** A bought piece already standing on a project floor when the hotel starts (the visual comparisons need a decorated floor). */
export interface SeedPiece {
  /** The catalogue item (`fern`). */
  item: string;
  x: number;
  y: number;
  dir: 0 | 2 | 4 | 6;
}

/** What a hotel starts with besides the defaults. */
export interface HotelSeed {
  /** Pieces placed on project floors, by project id. They are numbered `bought_1`, `bought_2`... in the order given. */
  placed?: Readonly<Record<string, readonly SeedPiece[]>>;
}

/**
 * Starts a hotel of its own: a scripted engine with an HR office and branch delivery, a wallet with Ecto, wisps every
 * 300 to 500 ms, and scratch files for everything it saves. Nothing is read from or written to `data/`.
 */
export async function startHotel(options: HotelSeed = {}): Promise<Hotel> {
  const dir = await mkdtemp(join(tmpdir(), "agentlife-journey-"));
  const file = (name: string): string => join(dir, `${name}.json`);
  const seed = (name: string, value: unknown): Promise<void> => writeFile(file(name), `${JSON.stringify(value)}\n`, "utf8");
  let seq = 0;
  const placed = Object.fromEntries(
    Object.entries(options.placed ?? {}).map(([project, pieces]) => [
      project,
      pieces.map((p) => ({ id: `bought_${++seq}`, itemId: p.item, x: p.x, y: p.y, dir: p.dir })),
    ]),
  );
  await Promise.all([
    seed("wallet", { version: 1, since: 0, balance: START_BALANCE, ledger: [], granted: [] }),
    seed("inventory", { version: 1, stock: {}, placed, seq }),
    seed("wardrobe", { version: 1, owned: [] }),
    seed("quests", { version: 1, quests: QUEST_POOL }),
  ]);

  const port = await freePort();
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "src/main.ts"], {
    cwd: WORLD_SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      ENGINE: "fake",
      FAKE_HR: "1",
      FAKE_DELIVER: "1",
      AGENTLIFE_WISP_MS: "300,500",
      AGENTLIFE_LAYOUTS_FILE: file("layouts"),
      AGENTLIFE_WALLET_FILE: file("wallet"),
      AGENTLIFE_INVENTORY_FILE: file("inventory"),
      AGENTLIFE_WARDROBE_FILE: file("wardrobe"),
      AGENTLIFE_OUTFITS_FILE: file("outfits"),
      AGENTLIFE_PROGRESS_FILE: file("progress"),
      AGENTLIFE_QUESTS_FILE: file("quests"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stop = async (): Promise<void> => {
    if (child.exitCode === null && !child.killed) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  try {
    await waitForListening(child);
  } catch (e) {
    await stop();
    throw e;
  }

  const url = `ws://127.0.0.1:${port}`;
  const sent: string[] = [];
  return {
    url,
    dir,
    sent,
    stop,
    attach: (page) =>
      page.routeWebSocket(BUILT_IN_WORLD_URL, (ws) => {
        const upstream = new WebSocket(url);
        upstream.binaryType = "arraybuffer";
        // The protocol is JSON text; a binary frame would be a bug of the client, so it is passed on as text.
        const waiting: string[] = [];
        upstream.addEventListener("open", () => {
          for (const message of waiting.splice(0)) upstream.send(message);
        });
        upstream.addEventListener("message", (event) => {
          ws.send(typeof event.data === "string" ? event.data : Buffer.from(event.data as ArrayBuffer));
        });
        upstream.addEventListener("close", () => void ws.close());
        ws.onMessage((message) => {
          const text = typeof message === "string" ? message : message.toString("utf8");
          sent.push(text);
          if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
          else waiting.push(text);
        });
        ws.onClose(() => upstream.close());
      }),
  };
}
