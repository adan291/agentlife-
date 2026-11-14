import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, Outfit, OutfitPart, RoomId, ServerMsg, TeamMember } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, HrLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { WornStore } from "../src/outfit-store.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-wear-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const wornFile = () => join(dir, "outfits.json");
const onDisk = () => JSON.parse(readFileSync(wornFile(), "utf8")) as { version: number; user: Outfit; members: Record<string, Outfit> };

describe("WornStore", () => {
  const make = (logs?: string[]) => new WornStore({ file: wornFile(), now: () => 7, onLog: (m) => logs?.push(m) });

  it("starts bare and writes no file until somebody is dressed", () => {
    const s = make();
    expect(s.state()).toEqual({ user: {}, members: [] });
    expect(existsSync(wornFile())).toBe(false);
  });

  it("dresses the user and a member, and keeps both across a restart", () => {
    const s = make();
    expect(s.set("user", { hat: "crown" })).toEqual({ ok: true, changed: true });
    expect(s.set({ project: "alpha", member: "developer" }, { hat: "flat_cap", top: "waistcoat" })).toEqual({ ok: true, changed: true });
    expect(onDisk()).toEqual({ version: 1, user: { hat: "crown" }, members: { "alpha/developer": { hat: "flat_cap", top: "waistcoat" } } });
    const again = make();
    expect(again.state()).toEqual({ user: { hat: "crown" }, members: [{ project: "alpha", member: "developer", outfit: { hat: "flat_cap", top: "waistcoat" } }] });
    expect(again.outfitOf({ project: "alpha", member: "developer" })).toEqual({ hat: "flat_cap", top: "waistcoat" });
    expect(again.outfitOf({ project: "alpha", member: "qa" })).toEqual({});
  });

  it("says nothing changed when the same outfit is set again, whatever the order of its keys", () => {
    const s = make();
    s.set("user", { hat: "crown", top: "waistcoat" });
    expect(s.set("user", { top: "waistcoat", hat: "crown" })).toEqual({ ok: true, changed: false });
  });

  it("does not store an empty outfit: taking everything off removes the member", () => {
    const s = make();
    const who = { project: "alpha", member: "developer" };
    s.set(who, { hat: "flat_cap" });
    expect(s.setSlot(who, "hat", null)).toEqual({ ok: true, changed: true });
    expect(onDisk().members).toEqual({});
    expect(s.state().members).toEqual([]);
  });

  it("moves a file it cannot read aside and starts bare", () => {
    writeFileSync(wornFile(), JSON.stringify({ version: 1, user: {}, members: { "alpha/dev": {} } }), "utf8");
    const logs: string[] = [];
    const s = make(logs);
    expect(s.state()).toEqual({ user: {}, members: [] });
    expect(readdirSync(dir).some((n) => n.startsWith("outfits.json.bad-"))).toBe(true);
    expect(logs.join("\n")).toContain("unreadable");
  });

  it("changes nothing when the file cannot be written", () => {
    const logs: string[] = [];
    const s = make(logs);
    s.set("user", { hat: "crown" });
    rmSync(wornFile());
    mkdirSync(wornFile());
    expect(s.set("user", { hat: "halo" })).toEqual({ ok: false, reason: "Could not save the outfit." });
    expect(s.outfitOf("user")).toEqual({ hat: "crown" });
    expect(logs.join("\n")).toContain("cannot write");
  });

  it("drops the members of a project who left the team, and no one else", () => {
    const s = make();
    s.set({ project: "alpha", member: "developer" }, { hat: "flat_cap" });
    s.set({ project: "alpha", member: "ada" }, { top: "waistcoat" });
    s.set({ project: "alphabet", member: "ada" }, { top: "waistcoat" });
    s.set("user", { hat: "crown" });
    expect(s.pruneProject("alpha", new Set(["developer"]))).toBe(true);
    expect(s.state().members.map((m) => `${m.project}/${m.member}`).sort()).toEqual(["alpha/developer", "alphabet/ada"]);
    expect(s.outfitOf("user")).toEqual({ hat: "crown" });
    expect(s.pruneProject("alpha", new Set(["developer"]))).toBe(false);
    expect(onDisk().members["alpha/ada"]).toBeUndefined();
  });

  it("keeps everybody when a prune cannot be written", () => {
    const s = make();
    s.set({ project: "alpha", member: "ada" }, { top: "waistcoat" });
    rmSync(wornFile());
    mkdirSync(wornFile());
    expect(s.pruneProject("alpha", new Set())).toBe(false);
    expect(s.outfitOf({ project: "alpha", member: "ada" })).toEqual({ top: "waistcoat" });
  });
});

// ---- through the gateway ----

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 100 } });
const palette = { main: "#112233", shade: "#223344", light: "#334455", accent: "#445566" };
const part = (id: string, slot: OutfitPart["slot"], price: number): OutfitPart => ({ id, name: `Part ${id}`, slot, price, palette });
const PARTS: OutfitPart[] = [part("cap", "hat", 40), part("vest", "top", 30), part("rose", "accessory", 15), part("beret", "hat", 20)];

/** An economy with 100 Ecto and a wardrobe that owns what `own` lists. */
function economy(own: string[] = ["cap", "vest"], withParts = true): Economy {
  const e = new Economy({
    walletFile: join(dir, "wallet.json"),
    inventoryFile: join(dir, "inventory.json"),
    config,
    now: () => 1000,
    ...(withParts ? { outfits: PARTS, wardrobeFile: join(dir, "wardrobe.json") } : {}),
  });
  e.grant("night_summary", "2026-11-10", 1010);
  for (const id of own) e.buyPart(id);
  return e;
}

const member = (id: string, role: TeamMember["role"], displayName: string): TeamMember => ({ id, role, displayName, templateId: role, model: "auto" });

/** An engine whose HR office keeps its team in memory, and lets the test change the team behind the gateway's back. */
function engineWithHr(initial: TeamMember[] = [member("architect", "architect", "Architect"), member("developer", "developer", "Developer"), member("qa", "qa", "QA")]) {
  const queue = new EventQueue<AgentEvent>();
  const team = { members: initial };
  const refuse = () => Promise.reject(new Error("not used"));
  const hr: HrLink = {
    state: () => Promise.resolve({ catalogue: [], teams: [{ projectId: "alpha", name: "ALPHA", customised: true, members: [...team.members] }], imports: [], sources: [], models: {} }),
    team: (projectId) => (projectId === "alpha" ? Promise.resolve({ projectId, customised: true, members: [...team.members] }) : Promise.reject(new Error("unknown project"))),
    hire: (_p, body) => {
      const added = member("dev-2", "developer", body.displayName);
      team.members = [...team.members, added];
      return Promise.resolve(added);
    },
    update: refuse,
    fire: (_p, id) => {
      team.members = team.members.filter((m) => m.id !== id);
      return Promise.resolve();
    },
    importTemplate: refuse,
    approveImport: refuse,
    rejectImport: refuse,
    suggest: refuse,
  };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([{ id: "alpha", name: "ALPHA" }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "ALPHA", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1 }]),
    hr,
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, team };
}

async function connect(opts: { start?: RoomId; eco?: Economy | undefined; worn?: WornStore | undefined; link?: EngineLink | undefined } = {}) {
  const gateway = await startGateway({
    hotel: testHotel({ start: opts.start ?? "hr", projects: ["alpha"] }),
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    ...(opts.link ? { engine: opts.link } : {}),
    ...(opts.eco ? { economy: opts.eco } : {}),
    ...(opts.worn ? { outfits: opts.worn } : {}),
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
        setTimeout(r, Math.min(left, 25));
      });
    }
  };
  await waitFor(() => received.some((m) => m.type === "welcome"));
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  const settle = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}
type Conn = Awaited<ReturnType<typeof connect>>;
const outfitMsgs = (c: Conn) => c.received.flatMap((m) => (m.type === "outfits" ? [m.state] : []));
const outfitErrors = (c: Conn) => c.received.flatMap((m) => (m.type === "error" && m.code === "outfit_error" ? [m.message] : []));
const newStore = () => new WornStore({ file: wornFile() });
const dev = { project: "alpha", member: "developer" };

describe("wearing through the gateway", () => {
  it("sends the outfits right after the wardrobe at every welcome", async () => {
    const worn = newStore();
    worn.set("user", { hat: "cap" });
    const c = await connect({ eco: economy(), worn, link: engineWithHr().link });
    await c.waitFor(() => outfitMsgs(c).length > 0);
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("outfits")).toBeGreaterThan(types.indexOf("wardrobe"));
    expect(outfitMsgs(c)[0]).toEqual({ user: { hat: "cap" }, members: [] });
  });

  it("sends nothing without a wardrobe, and refuses to dress anybody", async () => {
    const noParts = await connect({ eco: economy([], false), worn: newStore(), link: engineWithHr().link });
    noParts.send({ type: "outfit_wear", who: "user", slot: "hat", partId: "cap" });
    await noParts.waitFor(() => outfitErrors(noParts).length === 1);
    expect(outfitErrors(noParts)).toEqual(["The hotel has no wardrobe: it needs the real engine."]);
    expect(outfitMsgs(noParts)).toEqual([]);
    const none = await connect({ link: engineWithHr().link });
    none.send({ type: "outfit_wear", who: "user", slot: "hat", partId: null });
    await none.waitFor(() => outfitErrors(none).length === 1);
    expect(outfitMsgs(none)).toEqual([]);
    expect(existsSync(wornFile())).toBe(false);
  });

  it("dresses the user on any floor and keeps it in the file", async () => {
    const c = await connect({ start: "lobby", eco: economy(), worn: newStore(), link: engineWithHr().link });
    c.send({ type: "outfit_wear", who: "user", slot: "hat", partId: "cap" });
    await c.waitFor(() => outfitMsgs(c).some((o) => o.user.hat === "cap"));
    c.send({ type: "outfit_wear", who: "user", slot: "top", partId: "vest" });
    await c.waitFor(() => outfitMsgs(c).some((o) => o.user.top === "vest"));
    expect(onDisk().user).toEqual({ hat: "cap", top: "vest" });
    c.send({ type: "outfit_wear", who: "user", slot: "hat", partId: null });
    await c.waitFor(() => outfitMsgs(c).length === 4 && outfitMsgs(c).at(-1)?.user.hat === undefined);
    expect(onDisk().user).toEqual({ top: "vest" });
    expect(outfitErrors(c)).toEqual([]);
  });

  it("dresses a team member in the HR office, and the same part on another member at once", async () => {
    const c = await connect({ eco: economy(), worn: newStore(), link: engineWithHr().link });
    c.send({ type: "outfit_wear", who: dev, slot: "hat", partId: "cap" });
    await c.waitFor(() => outfitMsgs(c).some((o) => o.members.length === 1));
    c.send({ type: "outfit_wear", who: { project: "alpha", member: "qa" }, slot: "hat", partId: "cap" });
    await c.waitFor(() => outfitMsgs(c).some((o) => o.members.length === 2));
    expect(outfitMsgs(c).at(-1)?.members).toEqual([
      { project: "alpha", member: "developer", outfit: { hat: "cap" } },
      { project: "alpha", member: "qa", outfit: { hat: "cap" } },
    ]);
    expect(outfitErrors(c)).toEqual([]);
  });

  it("refuses a part that is not owned, in the wrong slot, or unknown, and changes nothing", async () => {
    const c = await connect({ eco: economy(["cap"]), worn: newStore(), link: engineWithHr().link });
    c.send({ type: "outfit_wear", who: dev, slot: "top", partId: "vest" });
    c.send({ type: "outfit_wear", who: dev, slot: "top", partId: "cap" });
    c.send({ type: "outfit_wear", who: dev, slot: "hat", partId: "nope" });
    await c.waitFor(() => outfitErrors(c).length === 3);
    expect(outfitErrors(c)).toEqual([
      "You do not own the Part vest yet. Buy it at the shop counter in the lobby.",
      "The Part cap is a hat, not a top.",
      "That outfit is not in the shop.",
    ]);
    expect(existsSync(wornFile())).toBe(false);
  });

  it("refuses a member who is not on the team, a project that does not exist, and a member outside the HR office", async () => {
    const c = await connect({ eco: economy(), worn: newStore(), link: engineWithHr().link });
    c.send({ type: "outfit_wear", who: { project: "alpha", member: "ghost" }, slot: "hat", partId: "cap" });
    c.send({ type: "outfit_wear", who: { project: "nowhere", member: "developer" }, slot: "hat", partId: "cap" });
    await c.waitFor(() => outfitErrors(c).length === 2);
    expect(outfitErrors(c)).toEqual(["That team member is not on this project's team.", "Could not read that project's team."]);
    const lobby = await connect({ start: "lobby", eco: economy(), worn: newStore(), link: engineWithHr().link });
    lobby.send({ type: "outfit_wear", who: dev, slot: "hat", partId: "cap" });
    await lobby.waitFor(() => outfitErrors(lobby).length === 1);
    expect(outfitErrors(lobby)).toEqual(["Team members are dressed at the HR desk."]);
    expect(existsSync(wornFile())).toBe(false);
  });

  it("needs the HR office of the real engine to dress a member", async () => {
    const c = await connect({ eco: economy(), worn: newStore() });
    c.send({ type: "outfit_wear", who: dev, slot: "hat", partId: "cap" });
    await c.waitFor(() => outfitErrors(c).length === 1);
    expect(outfitErrors(c)).toEqual(["The HR office needs the real engine."]);
  });

  it("answers a failed save with the reason and keeps the old outfit", async () => {
    const c = await connect({ start: "lobby", eco: economy(), worn: newStore(), link: engineWithHr().link });
    mkdirSync(wornFile());
    c.send({ type: "outfit_wear", who: "user", slot: "hat", partId: "cap" });
    await c.waitFor(() => outfitErrors(c).length === 1);
    expect(outfitErrors(c)).toEqual(["Could not save the outfit."]);
    expect(outfitMsgs(c).every((o) => o.user.hat === undefined)).toBe(true);
  });

  it("keeps the look when the world-server restarts, and shows it at the next welcome", async () => {
    const first = await connect({ eco: economy(), worn: newStore(), link: engineWithHr().link });
    first.send({ type: "outfit_wear", who: dev, slot: "hat", partId: "cap" });
    first.send({ type: "outfit_wear", who: "user", slot: "top", partId: "vest" });
    await first.waitFor(() => outfitMsgs(first).some((o) => o.members.length === 1 && o.user.top === "vest"));
    await gateways.shift()!.close();
    const second = await connect({ eco: economy([]), worn: newStore(), link: engineWithHr().link });
    await second.waitFor(() => outfitMsgs(second).length > 0);
    expect(outfitMsgs(second)[0]).toEqual({ user: { top: "vest" }, members: [{ project: "alpha", member: "developer", outfit: { hat: "cap" } }] });
  });

  it("drops the outfit of a member who is let go, keeps the part in the wardrobe, and a new hire with the same id starts bare", async () => {
    const e = engineWithHr([member("architect", "architect", "Architect"), member("developer", "developer", "Developer"), member("qa", "qa", "QA"), member("dev-2", "developer", "Ada")]);
    const eco = economy();
    const c = await connect({ eco, worn: newStore(), link: e.link });
    const ada = { project: "alpha", member: "dev-2" };
    c.send({ type: "outfit_wear", who: ada, slot: "hat", partId: "cap" });
    c.send({ type: "outfit_wear", who: dev, slot: "top", partId: "vest" });
    await c.waitFor(() => outfitMsgs(c).some((o) => o.members.length === 2));
    c.send({ type: "hr_do", act: { action: "fire", projectId: "alpha", memberId: "dev-2" } });
    await c.waitFor(() => outfitMsgs(c).at(-1)?.members.length === 1);
    expect(outfitMsgs(c).at(-1)?.members).toEqual([{ project: "alpha", member: "developer", outfit: { top: "vest" } }]);
    expect(onDisk().members["alpha/dev-2"]).toBeUndefined();
    expect(eco.wardrobe()?.owned).toEqual(["cap", "vest"]);
    // Somebody hired later who gets the same id starts with nothing on.
    c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId: "developer", displayName: "Bea" } });
    await c.waitFor(() => c.received.filter((m) => m.type === "hr").length === 2);
    await c.settle();
    expect(outfitMsgs(c).at(-1)?.members.map((m) => m.member)).toEqual(["developer"]);
  });

  it("drops the outfit of a member who was let go outside the hotel at the next visit to the floor", async () => {
    const e = engineWithHr([member("architect", "architect", "Architect"), member("developer", "developer", "Developer"), member("qa", "qa", "QA"), member("dev-2", "developer", "Ada")]);
    const worn = newStore();
    worn.set({ project: "alpha", member: "dev-2" }, { hat: "cap" });
    e.team.members = e.team.members.filter((m) => m.id !== "dev-2");
    const c = await connect({ start: "project:alpha", eco: economy(), worn, link: e.link });
    // The first `outfits` still has her; the one that follows the read of the team does not.
    await c.waitFor(() => outfitMsgs(c).some((o) => o.members.length === 0));
    expect(onDisk().members).toEqual({});
  });
});
