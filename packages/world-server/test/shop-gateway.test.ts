import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, ServerMsg } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-shop-gw-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const SINCE = 1000;
/** An economy in the scratch folder. `ecto` is granted at once (one grant of that size per call of 100 or less is not possible, so it is built from 25-Ecto nights). */
function economy(nights = 0): Economy {
  const e = new Economy({ walletFile: join(dir, "wallet.json"), inventoryFile: join(dir, "inventory.json"), config, now: () => SINCE });
  for (let i = 0; i < nights; i++) e.grant("night_summary", `2026-11-${String(10 + i).padStart(2, "0")}`, SINCE + 10);
  return e;
}

async function connect(eco: Economy | undefined, start: "lobby" | "project:alpha" = "lobby") {
  const gateway = await startGateway({ hotel: testHotel({ start, projects: ["alpha"] }), port: 0, tickMs: 5, ...(eco ? { economy: eco } : {}) });
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
  const settle = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}

type Conn = Awaited<ReturnType<typeof connect>>;
const shops = (c: Conn) => c.received.flatMap((m) => (m.type === "shop" ? [m.state] : []));
const shopErrors = (c: Conn) => c.received.flatMap((m) => (m.type === "error" && m.code === "shop_error" ? [m.message] : []));
const balances = (c: Conn) => c.received.flatMap((m) => (m.type === "wallet" ? [m.balance] : []));

describe("the shop through the gateway", () => {
  it("sends the shop before it opens the panel at the counter", async () => {
    const c = await connect(economy(2));
    c.send({ type: "use", itemId: "shop_counter_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("shop")).toBeGreaterThan(-1);
    expect(types.indexOf("shop")).toBeLessThan(types.indexOf("open_panel"));
    expect(c.received.find((m) => m.type === "open_panel")).toMatchObject({ panel: "shop" });
    const shop = shops(c)[0]!;
    expect(shop.balance).toBe(50);
    expect(shop.items.length).toBeGreaterThanOrEqual(24);
    expect(shop.stock).toEqual([]);
    expect(shop.stockMax).toBe(200);
  });

  it("sells an item: new balance, new stock, one answer of each kind", async () => {
    const c = await connect(economy(2));
    c.send({ type: "shop_buy", itemId: "armchair" });
    await c.waitFor(() => shops(c).length > 0);
    expect(shops(c)[0]).toMatchObject({ balance: 20, stock: [{ itemId: "armchair", count: 1 }] });
    expect(balances(c).at(-1)).toBe(20);
    c.send({ type: "shop_buy", itemId: "fern" });
    await c.waitFor(() => shops(c).length === 2);
    expect(shops(c)[1]).toMatchObject({ balance: 6, stock: [{ itemId: "armchair", count: 1 }, { itemId: "fern", count: 1 }] });
    expect(shopErrors(c)).toEqual([]);
  });

  it("refuses with the reason and changes nothing", async () => {
    const c = await connect(economy(1));
    c.send({ type: "shop_buy", itemId: "throne" });
    c.send({ type: "shop_buy", itemId: "no_such_item" });
    await c.waitFor(() => shopErrors(c).length === 2);
    expect(shopErrors(c)).toEqual(["You need 90 Ecto and have 25.", "That item is not in the shop."]);
    expect(shops(c)).toEqual([]);
    expect(balances(c).every((b) => b === 25)).toBe(true);
    // A message that is not an item id never gets as far as the shop.
    c.send({ type: "shop_buy", itemId: "../x" });
    await c.waitFor(() => c.received.some((m) => m.type === "error" && m.code === "bad_message"));
  });

  it("sells only at the counter in the lobby, and shows the shop on every floor", async () => {
    const c = await connect(economy(2), "project:alpha");
    c.send({ type: "shop_buy", itemId: "fern" });
    await c.waitFor(() => shopErrors(c).length === 1);
    expect(shopErrors(c)).toEqual(["The shop counter is in the lobby."]);
    c.send({ type: "shop_state" });
    await c.waitFor(() => shops(c).length === 1);
    expect(shops(c)[0]).toMatchObject({ balance: 50, stock: [] });
  });

  it("is closed without an economy: no wallet, no catalogue, an error with the reason", async () => {
    const c = await connect(undefined);
    c.send({ type: "use", itemId: "shop_counter_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    c.send({ type: "shop_buy", itemId: "fern" });
    await c.waitFor(() => shopErrors(c).length === 2);
    expect(shopErrors(c)).toEqual(["The shop is closed: it needs the real engine.", "The shop is closed: it needs the real engine."]);
    expect(shops(c)).toEqual([]);
    expect(balances(c)).toEqual([]);
  });

  it("keeps what was bought when the world-server restarts", async () => {
    const first = await connect(economy(2));
    first.send({ type: "shop_buy", itemId: "armchair" });
    await first.waitFor(() => shops(first).length === 1);
    const second = await connect(economy());
    second.send({ type: "shop_state" });
    await second.waitFor(() => shops(second).length === 1);
    expect(shops(second)[0]).toMatchObject({ balance: 20, stock: [{ itemId: "armchair", count: 1 }] });
  });
});
