import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ProgressConfigSchema, ServerMsgSchema, newProgress } from "@agentlife/shared";
import type { AgentEvent, BadgeDef, ClientMsg, OutfitPart, ServerMsg } from "@agentlife/shared";
import { Economy, loadOutfits } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { ProgressStore, loadBadges } from "../src/progress-store.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-outfits-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const SINCE = 1000;
const XP = ProgressConfigSchema.parse({
  version: 1,
  xp: { step_done: { member: 10 }, job_passed: { member: 25, user: 15 }, review_passed: { member: 20, user: 10 }, branch_delivered: { user: 20 }, plan_approved: { user: 5 } },
});
const palette = { main: "#112233", shade: "#223344", light: "#334455", accent: "#445566" };
const part = (id: string, extra: Partial<OutfitPart> = {}): OutfitPart => ({ id, name: `Part ${id}`, slot: "hat", price: 30, palette, ...extra });
const PARTS: OutfitPart[] = [
  part("cap", { price: 40 }),
  part("vest", { slot: "top", price: 60 }),
  part("rose", { slot: "accessory", price: 15 }),
  part("crown", { badge: "first_step", price: undefined }),
  part("halo", { badge: "veteran", price: undefined }),
];
const badgeName = (id: string) => ({ first_step: "Getting started", veteran: "Hotel veteran" })[id] ?? id;

const wallet = () => join(dir, "wallet.json");
const wardrobeFile = () => join(dir, "wardrobe.json");
const onDisk = () => JSON.parse(readFileSync(wardrobeFile(), "utf8")) as { version: number; owned: string[] };

/** An economy with a wardrobe in the scratch folder and `nights` x 25 Ecto. */
function make(opts: { nights?: number; parts?: OutfitPart[] | undefined; logs?: string[] } = {}): Economy {
  const e = new Economy({
    walletFile: wallet(),
    inventoryFile: join(dir, "inventory.json"),
    config,
    now: () => SINCE,
    ...("parts" in opts && opts.parts === undefined ? {} : { outfits: opts.parts ?? PARTS, wardrobeFile: wardrobeFile() }),
    badgeNames: badgeName,
    onLog: (m) => opts.logs?.push(m),
  });
  for (let i = 0; i < (opts.nights ?? 0); i++) e.grant("night_summary", `2026-11-${String(10 + i).padStart(2, "0")}`, SINCE + 10);
  return e;
}

describe("the wardrobe in Economy", () => {
  it("ships parts that load against the real badges", () => {
    const parts = loadOutfits(new Set(loadBadges().map((b) => b.id)));
    expect(parts.length).toBeGreaterThanOrEqual(20);
  });

  it("is off without parts: no state, no file, buying is refused", () => {
    const e = make({ parts: undefined, nights: 2 });
    expect(e.hasWardrobe).toBe(false);
    expect(e.wardrobe()).toBeUndefined();
    expect(e.buyPart("cap")).toEqual({ ok: false, reason: "The shop is closed: it needs the real engine." });
    expect(e.unlockParts(new Set(["veteran"]))).toEqual([]);
    expect(existsSync(wardrobeFile())).toBe(false);
  });

  it("starts empty and names the badges the parts ask for", () => {
    const e = make({ nights: 1 });
    expect(e.wardrobe()).toEqual({
      balance: 25,
      parts: PARTS,
      owned: [],
      badges: [{ id: "first_step", name: "Getting started" }, { id: "veteran", name: "Hotel veteran" }],
    });
  });

  it("buys a part: the balance falls, the wardrobe grows, both files are written", () => {
    const e = make({ nights: 3 });
    const r = e.buyPart("cap");
    expect(r).toMatchObject({ ok: true, entry: { amount: -40, reason: "purchase", ref: "outfit:cap" } });
    expect(e.balance).toBe(35);
    expect(e.wardrobe()?.owned).toEqual(["cap"]);
    expect(onDisk()).toEqual({ version: 1, owned: ["cap"] });
    expect(JSON.parse(readFileSync(wallet(), "utf8")).balance).toBe(35);
  });

  it("refuses with the reason and changes nothing", () => {
    const e = make({ nights: 1 });
    expect(e.buyPart("vest")).toEqual({ ok: false, reason: "You need 60 Ecto and have 25." });
    expect(e.buyPart("nope")).toEqual({ ok: false, reason: "That outfit is not in the shop." });
    expect(e.buyPart("crown")).toEqual({ ok: false, reason: "This one cannot be bought: earn the Getting started badge." });
    expect(e.buyPart("rose").ok).toBe(true);
    expect(e.buyPart("rose")).toEqual({ ok: false, reason: "You already own the Part rose." });
    expect(e.balance).toBe(10);
    expect(e.wardrobe()?.owned).toEqual(["rose"]);
  });

  it("keeps the wardrobe across a restart", () => {
    const first = make({ nights: 3 });
    first.buyPart("cap");
    first.unlockParts(new Set(["first_step"]));
    const again = make();
    expect(again.wardrobe()?.owned).toEqual(["cap", "crown"]);
    expect(again.balance).toBe(35);
  });

  it("unlocks a badge part once, for any badge, in one write", () => {
    const e = make();
    expect(e.unlockParts(new Set())).toEqual([]);
    expect(e.unlockParts(new Set(["something_else"]))).toEqual([]);
    const got = e.unlockParts(new Set(["first_step", "veteran"]));
    expect(got.map((u) => [u.part.id, u.badgeName])).toEqual([["crown", "Getting started"], ["halo", "Hotel veteran"]]);
    expect(e.unlockParts(new Set(["first_step", "veteran"]))).toEqual([]);
    expect(onDisk().owned).toEqual(["crown", "halo"]);
  });

  it("does not unlock a part that was bought, and a bought badge part cannot exist", () => {
    const e = make({ parts: [part("cap", { badge: "first_step", price: undefined }), ...PARTS.slice(1)] });
    expect(e.unlockParts(new Set(["first_step"])).map((u) => u.part.id)).toEqual(["cap", "crown"]);
  });

  it("moves a wardrobe it cannot read aside and starts empty", () => {
    writeFileSync(wardrobeFile(), JSON.stringify({ version: 1, owned: ["cap", "cap"] }), "utf8");
    const logs: string[] = [];
    const e = make({ logs });
    expect(e.wardrobe()?.owned).toEqual([]);
    expect(readdirSync(dir).some((n) => n.startsWith("wardrobe.json.bad-"))).toBe(true);
    expect(logs.join("\n")).toContain("unreadable");
  });

  it("refuses the purchase and keeps the Ecto when the wardrobe cannot be written", () => {
    const e = make({ nights: 2 });
    mkdirSync(wardrobeFile());
    expect(e.buyPart("cap")).toEqual({ ok: false, reason: "Could not save your purchase." });
    expect(e.balance).toBe(50);
    expect(e.wardrobe()?.owned).toEqual([]);
  });

  it("refuses the purchase, puts the wardrobe back and keeps the Ecto when the wallet cannot be written", () => {
    const e = make({ nights: 3 });
    expect(e.buyPart("rose").ok).toBe(true); // 60 left
    rmSync(wallet());
    mkdirSync(wallet());
    expect(e.buyPart("cap")).toEqual({ ok: false, reason: "Could not save your purchase." });
    expect(e.balance).toBe(60);
    expect(e.wardrobe()?.owned).toEqual(["rose"]);
    expect(onDisk().owned).toEqual(["rose"]);
  });

  it("tries an unlock again when the file could not be written", () => {
    const e = make();
    mkdirSync(wardrobeFile());
    expect(e.unlockParts(new Set(["first_step"]))).toEqual([]);
    expect(e.wardrobe()?.owned).toEqual([]);
    rmSync(wardrobeFile(), { recursive: true });
    expect(e.unlockParts(new Set(["first_step"])).map((u) => u.part.id)).toEqual(["crown"]);
  });
});

// ---- through the gateway ----

async function connect(eco: Economy | undefined, opts: { start?: "lobby" | "project:alpha"; progress?: ProgressStore; link?: EngineLink } = {}) {
  const gateway = await startGateway({
    hotel: testHotel({ start: opts.start ?? "lobby", projects: ["alpha"] }),
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    ...(opts.link ? { engine: opts.link } : {}),
    ...(eco ? { economy: eco } : {}),
    ...(opts.progress ? { progress: opts.progress } : {}),
  });
  gateways.push(gateway);
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    received.push(ServerMsgSchema.parse(JSON.parse(d.toString())));
    waiters.splice(0).forEach((w) => w());
  });
  const waitFor = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, left);
      });
    }
  };
  await waitFor(() => received.some((m) => m.type === "welcome"));
  const send = (msg: ClientMsg | Record<string, unknown>) => ws.send(JSON.stringify(msg));
  const settle = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}
type Conn = Awaited<ReturnType<typeof connect>>;
const wardrobes = (c: Conn) => c.received.flatMap((m) => (m.type === "wardrobe" ? [m.state] : []));
const unlocks = (c: Conn) => c.received.flatMap((m) => (m.type === "part_unlocked" ? [m] : []));
const shopErrors = (c: Conn) => c.received.flatMap((m) => (m.type === "error" && m.code === "shop_error" ? [m.message] : []));
const wallets = (c: Conn) => c.received.flatMap((m) => (m.type === "wallet" ? [m.balance] : []));

describe("outfits through the gateway", () => {
  it("sends the wardrobe right after the wallet at every welcome", async () => {
    const c = await connect(make({ nights: 2 }));
    await c.waitFor(() => wardrobes(c).length > 0);
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("wardrobe")).toBeGreaterThan(types.indexOf("wallet"));
    expect(wardrobes(c)[0]).toMatchObject({ balance: 50, owned: [] });
    expect(wardrobes(c)[0]?.parts).toHaveLength(PARTS.length);
  });

  it("sends nothing without a wardrobe, and answers a request with the closed-shop text", async () => {
    const c = await connect(make({ parts: undefined, nights: 1 }));
    c.send({ type: "wardrobe_state" });
    c.send({ type: "outfit_buy", partId: "cap" });
    await c.waitFor(() => shopErrors(c).length === 2);
    expect(shopErrors(c)).toEqual(["The shop is closed: it needs the real engine.", "The shop is closed: it needs the real engine."]);
    expect(wardrobes(c)).toEqual([]);
    const none = await connect(undefined);
    none.send({ type: "outfit_buy", partId: "cap" });
    await none.waitFor(() => shopErrors(none).length === 1);
    expect(wardrobes(none)).toEqual([]);
  });

  it("sends the wardrobe when the shop panel opens and on request, on any floor", async () => {
    const c = await connect(make({ nights: 1 }), { start: "project:alpha" });
    const before = wardrobes(c).length;
    c.send({ type: "wardrobe_state" });
    await c.waitFor(() => wardrobes(c).length === before + 1);
  });

  it("sells a part: new balance, new wardrobe, a file on disk", async () => {
    const c = await connect(make({ nights: 3 }));
    c.send({ type: "outfit_buy", partId: "cap" });
    await c.waitFor(() => wardrobes(c).some((w) => w.owned.includes("cap")));
    expect(wardrobes(c).at(-1)).toMatchObject({ balance: 35, owned: ["cap"] });
    expect(wallets(c).at(-1)).toBe(35);
    expect(onDisk().owned).toEqual(["cap"]);
    expect(shopErrors(c)).toEqual([]);
  });

  it("refuses with the reason: too poor, owned, badge only, unknown, and not in the lobby", async () => {
    const c = await connect(make({ nights: 1 }));
    for (const partId of ["vest", "crown", "nope"]) c.send({ type: "outfit_buy", partId });
    await c.waitFor(() => shopErrors(c).length === 3);
    expect(shopErrors(c)).toEqual([
      "You need 60 Ecto and have 25.",
      "This one cannot be bought: earn the Getting started badge.",
      "That outfit is not in the shop.",
    ]);
    c.send({ type: "outfit_buy", partId: "rose" });
    await c.waitFor(() => wardrobes(c).some((w) => w.owned.includes("rose")));
    c.send({ type: "outfit_buy", partId: "rose" });
    await c.waitFor(() => shopErrors(c).length === 4);
    expect(shopErrors(c)[3]).toBe("You already own the Part rose.");
    c.send({ type: "outfit_buy", partId: "../x" });
    await c.waitFor(() => c.received.some((m) => m.type === "error" && m.code === "bad_message"));

    const far = await connect(make({ nights: 3 }), { start: "project:alpha" });
    far.send({ type: "outfit_buy", partId: "cap" });
    await far.waitFor(() => shopErrors(far).length === 1);
    expect(shopErrors(far)).toEqual(["The shop counter is in the lobby."]);
  });

  /** A progress file in which the user and a member already hold a badge. */
  function progressWith(badges: { user?: string[]; member?: string[] }): ProgressStore {
    const file = join(dir, "progress.json");
    const p = newProgress(SINCE);
    for (const id of badges.user ?? []) p.user.badges[id] = SINCE;
    if (badges.member) {
      p.members["alpha/ada"] = { xp: 0, counts: {}, stepMs: 0, streak: 0, badges: Object.fromEntries(badges.member.map((id) => [id, SINCE])) };
    }
    writeFileSync(file, JSON.stringify(p), "utf8");
    return new ProgressStore({ file, config: XP, now: () => SINCE });
  }

  it("unlocks at the welcome the parts of badges the user and any member already have, once", async () => {
    const eco = make();
    const c = await connect(eco, { progress: progressWith({ user: ["veteran"], member: ["first_step"] }) });
    await c.waitFor(() => wardrobes(c).length > 0);
    expect(unlocks(c).map((u) => [u.partId, u.badge]).sort()).toEqual([["crown", "Getting started"], ["halo", "Hotel veteran"]]);
    expect(wardrobes(c)[0]?.owned.sort()).toEqual(["crown", "halo"]);
    // The unlock toast comes before the wardrobe that holds the parts.
    const types = c.received.map((m) => m.type);
    expect(types.lastIndexOf("part_unlocked")).toBeLessThan(types.indexOf("wardrobe"));
    // A second visit announces nothing.
    const again = await connect(eco, { progress: progressWith({ user: ["veteran"], member: ["first_step"] }) });
    await again.waitFor(() => wardrobes(again).length > 0);
    expect(unlocks(again)).toEqual([]);
    expect(wardrobes(again)[0]?.owned.sort()).toEqual(["crown", "halo"]);
  });

  it("unlocks when a team member earns the badge during the session", async () => {
    const badges: BadgeDef[] = [
      { id: "first_step", name: "Getting started", description: "Finish a step", scope: "member", rule: { counter: "step_done", atLeast: 1 }, icon: { shape: "star", colour: "#ffffff" } },
    ];
    const queue = new EventQueue<AgentEvent>();
    const link: EngineLink = {
      listRepos: () => Promise.resolve([]),
      listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
      startJob: () => Promise.reject(new Error("not used")),
      resolveApproval: () => Promise.resolve(),
      getJob: () => Promise.reject(new Error("not used")),
      events: () => queue,
      close: () => queue.close(),
    };
    const progress = new ProgressStore({
      file: join(dir, "progress.json"),
      config: XP,
      badges,
      now: () => SINCE,
    });
    const c = await connect(make(), { start: "project:alpha", progress, link });
    await c.waitFor(() => wardrobes(c).length > 0);
    expect(unlocks(c)).toEqual([]);
    queue.push({ seq: 1, ts: SINCE + 100, type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" } as AgentEvent);
    queue.push({ seq: 2, ts: SINCE + 100, type: "agent.state_changed", taskId: "t1", agentId: "alpha:developer", state: "done" } as AgentEvent);
    await c.waitFor(() => unlocks(c).length > 0);
    expect(unlocks(c)).toEqual([{ type: "part_unlocked", partId: "crown", name: "Part crown", slot: "hat", badge: "Getting started" }]);
    await c.waitFor(() => wardrobes(c).some((w) => w.owned.includes("crown")));
    expect(onDisk().owned).toEqual(["crown"]);
  });
});
