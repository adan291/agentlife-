import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EconomyConfigSchema } from "@agentlife/shared";
import { Economy, loadEconomyConfig } from "../src/economy-store.ts";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-wallet-"));
  file = join(dir, "wallet.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const open = (now = 1000, logs: string[] = []) => new Economy({ walletFile: file, inventoryFile: join(dir, "inventory.json"), config, now: () => now, onLog: (m) => logs.push(m) });
const saved = () => JSON.parse(readFileSync(file, "utf8")) as { since: number; balance: number; ledger: unknown[]; granted: string[] };

describe("Economy", () => {
  it("ships a config that passes the schema", () => {
    const shipped = loadEconomyConfig();
    expect(shipped.grants.branch_delivered).toBeGreaterThan(0);
  });

  it("creates the wallet file at once, so its start time survives a restart", () => {
    open(1234);
    expect(saved()).toMatchObject({ since: 1234, balance: 0, ledger: [], granted: [] });
    expect(open(9999).since).toBe(1234);
  });

  it("grants the amount from the config for each reason and saves it", () => {
    const e = open();
    const reasons = ["job_passed", "branch_delivered", "review_finished", "memory_accepted", "night_summary"] as const;
    const expected = [15, 20, 10, 5, 25];
    reasons.forEach((r, i) => expect(e.grant(r, `task-${i}`, 2000)?.amount).toBe(expected[i]));
    expect(e.balance).toBe(75);
    expect(saved().balance).toBe(75);
    expect(saved().ledger).toHaveLength(5);
  });

  it("counts a grant once, also across a restart (a gateway replay)", () => {
    const first = open();
    expect(first.grant("job_passed", "task-1", 2000)).toBeDefined();
    expect(first.grant("job_passed", "task-1", 2000)).toBeUndefined();
    const second = open(5000);
    expect(second.balance).toBe(15);
    expect(second.grant("job_passed", "task-1", 2000)).toBeUndefined();
    expect(second.grant("branch_delivered", "task-1", 2000)).toBeDefined();
    expect(second.balance).toBe(35);
  });

  it("pays nothing for an event older than the wallet", () => {
    const e = open(5000);
    expect(e.grant("job_passed", "task-old", 4999)).toBeUndefined();
    expect(e.balance).toBe(0);
    expect(saved().granted).toEqual([]);
  });

  it("moves an unreadable file aside, starts empty and never overwrites the old content", () => {
    writeFileSync(file, "{ not json", "utf8");
    const logs: string[] = [];
    const e = open(7000, logs);
    expect(e.balance).toBe(0);
    expect(e.since).toBe(7000);
    const aside = readdirSync(dir).filter((n) => n.startsWith("wallet.json.bad-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]!), "utf8")).toBe("{ not json");
    expect(logs.join("\n")).toContain("moved aside");
  });

  it("moves a file that fails the schema aside too (a negative balance)", () => {
    writeFileSync(file, JSON.stringify({ version: 1, since: 0, balance: -5, ledger: [], granted: [] }), "utf8");
    expect(open().balance).toBe(0);
    expect(readdirSync(dir).some((n) => n.startsWith("wallet.json.bad-"))).toBe(true);
  });

  it("writes through a temporary file: no .tmp is left behind", () => {
    const e = open();
    e.grant("job_passed", "task-1", 2000);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("counts nothing when the file cannot be written, and counts it later when it can", () => {
    const logs: string[] = [];
    // A folder where the file should be: the rename fails.
    const e = open(1000, logs);
    rmSync(file);
    mkdirSync(file);
    expect(e.grant("job_passed", "task-1", 2000)).toBeUndefined();
    expect(e.balance).toBe(0);
    expect(logs.some((m) => m.includes("cannot write") && m.includes("wallet.json"))).toBe(true);
    rmSync(file, { recursive: true });
    expect(e.grant("job_passed", "task-1", 2000)?.amount).toBe(15);
    expect(e.balance).toBe(15);
    expect(existsSync(file)).toBe(true);
  });
});

describe("Economy purchases", () => {
  const inventory = () => join(dir, "inventory.json");
  const savedStock = () => (JSON.parse(readFileSync(inventory(), "utf8")) as { stock: Record<string, number> }).stock;
  const shopOf = (now = 1000) => new Economy({ walletFile: file, inventoryFile: inventory(), config, now: () => now });
  const rich = () => {
    const e = shopOf();
    e.grant("branch_delivered", "task-1", 2000);
    e.grant("night_summary", "2026-11-12", 2000);
    return e; // 45 Ecto
  };

  it("sells the shipped catalogue: 25 items, no stock and the balance", () => {
    const shop = shopOf().shop();
    expect(shop.items.length).toBeGreaterThanOrEqual(24);
    expect(shop).toMatchObject({ balance: 0, stock: [], stockMax: 200 });
  });

  it("takes the price, adds the item to the stock and writes both files", () => {
    const e = rich();
    const r = e.buy("armchair"); // 30 Ecto
    expect(r.ok).toBe(true);
    expect(e.balance).toBe(15);
    expect(e.shop().stock).toEqual([{ itemId: "armchair", count: 1 }]);
    expect(savedStock()).toEqual({ armchair: 1 });
    expect(saved().balance).toBe(15);
    expect(e.ledger.at(-1)).toMatchObject({ amount: -30, reason: "purchase", ref: "armchair" });
  });

  it("refuses with the reason and changes nothing and writes nothing", () => {
    const e = rich();
    expect(e.buy("throne")).toEqual({ ok: false, reason: "You need 90 Ecto and have 45." });
    expect(e.buy("no_such_item")).toEqual({ ok: false, reason: "That item is not in the shop." });
    expect(e.buy("__proto__")).toEqual({ ok: false, reason: "That item is not in the shop." });
    expect(e.balance).toBe(45);
    expect(e.stockTotal).toBe(0);
    expect(existsSync(inventory())).toBe(false);
  });

  it("keeps the balance and the stock across a restart", () => {
    const first = rich();
    first.buy("fern");
    first.buy("fern");
    first.buy("cactus");
    const second = shopOf(9000);
    expect(second.balance).toBe(45 - 14 - 14 - 12);
    expect(second.shop().stock).toEqual([
      { itemId: "fern", count: 2 },
      { itemId: "cactus", count: 1 },
    ]);
    // A purchase after the restart adds to the same stock.
    expect(second.buy("fern").ok).toBe(false); // 5 Ecto left
    expect(second.grant("job_passed", "task-9", 20000)?.amount).toBe(15);
    expect(second.buy("fern").ok).toBe(true);
    expect(savedStock()).toEqual({ fern: 3, cactus: 1 });
  });

  it("refuses the 201st item", () => {
    writeFileSync(inventory(), JSON.stringify({ version: 1, stock: { fern: 200 } }), "utf8");
    const e = rich();
    expect(e.buy("cactus")).toEqual({ ok: false, reason: "Your inventory is full (200 items)." });
    expect(e.balance).toBe(45);
  });

  it("moves an unreadable inventory aside and starts with nothing", () => {
    writeFileSync(inventory(), JSON.stringify({ version: 1, stock: { fern: -1 } }), "utf8");
    const logs: string[] = [];
    const e = new Economy({ walletFile: file, inventoryFile: inventory(), config, now: () => 1000, onLog: (m) => logs.push(m) });
    expect(e.stockTotal).toBe(0);
    expect(readdirSync(dir).some((n) => n.startsWith("inventory.json.bad-"))).toBe(true);
  });

  it("refuses the purchase and keeps the Ecto when the inventory cannot be written", () => {
    const e = rich();
    mkdirSync(inventory()); // a folder where the file should be
    expect(e.buy("fern")).toEqual({ ok: false, reason: "Could not save your purchase." });
    expect(e.balance).toBe(45);
    expect(e.stockTotal).toBe(0);
    expect(saved().balance).toBe(45);
  });

  it("refuses the purchase, restores the inventory file and keeps the Ecto when the wallet cannot be written", () => {
    const e = rich();
    expect(e.buy("fern").ok).toBe(true); // 31 left, stock {fern: 1}
    rmSync(file);
    mkdirSync(file); // the wallet can no longer be replaced
    expect(e.buy("cactus")).toEqual({ ok: false, reason: "Could not save your purchase." });
    expect(e.balance).toBe(31);
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 1 }]);
    expect(savedStock()).toEqual({ fern: 1 });
  });
});

describe("Economy placed pieces", () => {
  const inventory = () => join(dir, "inventory.json");
  const onDisk = () => JSON.parse(readFileSync(inventory(), "utf8")) as { stock: Record<string, number>; placed: Record<string, { id: string; itemId: string }[]>; seq: number };
  const make = (logs: string[] = []) => new Economy({ walletFile: file, inventoryFile: inventory(), config, now: () => 1000, onLog: (m) => logs.push(m) });
  /** 100 Ecto: two fern and a cactus bought. */
  const owner = () => {
    const e = make();
    for (let i = 0; i < 4; i++) e.grant("night_summary", `2026-11-${10 + i}`, 2000);
    for (const id of ["fern", "fern", "cactus"]) expect(e.buy(id).ok).toBe(true);
    return e;
  };
  const to = { x: 2, y: 1, dir: 4 as const };

  it("a plan changes nothing until it is committed, then writes the file and the memory", () => {
    const e = owner();
    const plan = e.planPlace("alpha", "fern", to);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.piece).toEqual({ itemId: "bought_1", defId: "fern", x: 2, y: 1, dir: 4 });
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 2 }, { itemId: "cactus", count: 1 }]);
    expect(e.placedFurni("alpha")).toEqual([]);
    plan.commit();
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 1 }, { itemId: "cactus", count: 1 }]);
    expect(e.placedFurni("alpha")).toEqual([plan.piece]);
    expect(onDisk()).toMatchObject({ stock: { fern: 1, cactus: 1 }, seq: 1, placed: { alpha: [{ id: "bought_1", itemId: "fern" }] } });
  });

  it("refuses an item that is not in stock and a floor that is full", () => {
    const e = owner();
    expect(e.planPlace("alpha", "armchair", to)).toEqual({ ok: false, reason: "You do not have that item." });
    expect(e.planPickUp("alpha", "bought_1")).toEqual({ ok: false, reason: "That piece is not one of yours." });
    expect(e.planMove("alpha", "bought_1", to)).toEqual({ ok: false, reason: "That piece is not one of yours." });
  });

  it("a commit that cannot write throws and leaves the memory and the file as they were", () => {
    const logs: string[] = [];
    const e = make(logs);
    for (let i = 0; i < 2; i++) e.grant("night_summary", `2026-11-${10 + i}`, 2000);
    e.buy("fern");
    const plan = e.planPlace("alpha", "fern", to);
    if (!plan.ok) throw new Error(plan.reason);
    rmSync(inventory());
    mkdirSync(inventory()); // a folder where the file should be
    expect(() => plan.commit()).toThrow("cannot write the inventory");
    expect(e.placedFurni("alpha")).toEqual([]);
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 1 }]);
    expect(logs.some((m) => m.includes("cannot write") && m.includes("inventory.json"))).toBe(true);
  });

  it("keeps the pieces and the numbering across a restart", () => {
    const first = owner();
    const a = first.planPlace("alpha", "fern", to);
    if (!a.ok) throw new Error(a.reason);
    a.commit();
    const mv = first.planMove("alpha", "bought_1", { x: 5, y: 5, dir: 2 });
    if (!mv.ok) throw new Error(mv.reason);
    mv.commit();

    const second = make();
    expect(second.placedFurni("alpha")).toEqual([{ itemId: "bought_1", defId: "fern", x: 5, y: 5, dir: 2 }]);
    const b = second.planPlace("alpha", "fern", to);
    expect(b.ok && b.piece.itemId).toBe("bought_2");
    const back = second.planPickUp("alpha", "bought_1");
    if (!back.ok) throw new Error(back.reason);
    back.commit();
    expect(second.placedFurni("alpha")).toEqual([]);
    expect(second.shop().stock).toEqual([{ itemId: "fern", count: 2 }, { itemId: "cactus", count: 1 }]);
  });

  it("gives back the pieces of the floors the engine no longer lists, and keeps the others", () => {
    const e = owner();
    for (const [project, item] of [["alpha", "fern"], ["beta", "fern"], ["beta", "cactus"]] as const) {
      const p = e.planPlace(project, item, to);
      if (!p.ok) throw new Error(p.reason);
      p.commit();
    }
    expect(e.shop().stock).toEqual([]);
    expect(e.returnAbsentFloors(new Set(["alpha"]))).toBe(true);
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 1 }, { itemId: "cactus", count: 1 }]);
    expect(e.placedFurni("alpha")).toHaveLength(1);
    expect(e.placedFurni("beta")).toEqual([]);
    expect(e.returnAbsentFloors(new Set(["alpha"]))).toBe(false);
    expect(onDisk().placed).toEqual({ alpha: [expect.objectContaining({ itemId: "fern" })] });
  });

  it("gives back the pieces the floor does not show, and a piece whose item left the catalogue", () => {
    const e = owner();
    for (let i = 0; i < 2; i++) {
      const p = e.planPlace("alpha", "fern", { ...to, x: 2 + i });
      if (!p.ok) throw new Error(p.reason);
      p.commit();
    }
    expect(e.returnHiddenPieces("alpha", new Set(["bought_1", "bought_2"]))).toBe(false);
    expect(e.returnHiddenPieces("alpha", new Set(["bought_2"]))).toBe(true);
    expect(e.placedFurni("alpha").map((p) => p.itemId)).toEqual(["bought_2"]);
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 1 }, { itemId: "cactus", count: 1 }]);

    // An item that is no longer sold is not drawn, and the floor then does not show it either.
    const gone = new Economy({
      walletFile: file,
      inventoryFile: inventory(),
      config,
      catalogue: [{ id: "cactus", name: "Cactus", page: "plants", price: 12, defId: "cactus" }],
      now: () => 1000,
    });
    expect(gone.placedFurni("alpha")).toEqual([]);
    expect(gone.returnHiddenPieces("alpha", new Set())).toBe(true);
    expect(onDisk().placed).toEqual({});
  });

  it("opens a file written before pieces could be placed", () => {
    writeFileSync(inventory(), JSON.stringify({ version: 1, stock: { fern: 2 } }), "utf8");
    const e = make();
    expect(e.shop().stock).toEqual([{ itemId: "fern", count: 2 }]);
    expect(e.placedFurni("alpha")).toEqual([]);
    const p = e.planPlace("alpha", "fern", to);
    expect(p.ok && p.piece.itemId).toBe("bought_1");
  });
});
