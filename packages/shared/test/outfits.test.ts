import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BadgesFileSchema,
  ClientMsgSchema,
  OUTFIT_PARTS_MIN,
  OUTFIT_SLOTS,
  OutfitPartSchema,
  OutfitsFileSchema,
  REQUIRED_PARTS,
  ServerMsgSchema,
  WardrobeFileSchema,
  WardrobeStateSchema,
  WornFileSchema,
  WornStateSchema,
  applyOutfitPurchase,
  applyWear,
  checkOutfits,
  emptyWorn,
  newWallet,
  outfitIsEmpty,
  unlockText,
  unlockedBy,
  withSlot,
  wornKey,
  wornState,
} from "../src/index.ts";
import type { Outfit, OutfitPart, Wallet } from "../src/index.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const config = (name: string): unknown => JSON.parse(readFileSync(join(here, "..", "..", "world-server", "config", name), "utf8"));

const palette = { main: "#112233", shade: "#223344", light: "#334455", accent: "#445566" };
const part = (id: string, extra: Partial<OutfitPart> = {}): OutfitPart => ({ id, name: id, slot: "hat", price: 30, palette, ...extra });
const wallet = (balance: number): Wallet => ({ ...newWallet(0), balance });

const shipped = OutfitsFileSchema.parse(config("outfits.json")).parts;
const badgeIds = new Set(BadgesFileSchema.parse(config("badges.json")).badges.map((b) => b.id));

describe("the shipped outfit parts", () => {
  it("pass every check: 20 or more, every slot, the required set, real badges", () => {
    expect(checkOutfits(shipped, badgeIds)).toEqual([]);
    expect(shipped.length).toBeGreaterThanOrEqual(OUTFIT_PARTS_MIN);
    for (const slot of OUTFIT_SLOTS) expect(shipped.filter((p) => p.slot === slot).length, slot).toBeGreaterThanOrEqual(3);
    for (const id of REQUIRED_PARTS) expect(shipped.some((p) => p.id === id), id).toBe(true);
  });

  it("has the flat cap as a checked hat, the waistcoat as a top and the carnation and neckerchief as accessories", () => {
    const slotOf = (id: string) => shipped.find((p) => p.id === id)?.slot;
    expect([slotOf("flat_cap"), slotOf("waistcoat"), slotOf("neckerchief"), slotOf("carnation")]).toEqual(["hat", "top", "accessory", "accessory"]);
    expect(shipped.find((p) => p.id === "flat_cap")?.name).toMatch(/checked/i);
  });

  it("has some parts for sale and some for badges, never both", () => {
    expect(shipped.some((p) => p.price !== undefined)).toBe(true);
    expect(shipped.some((p) => p.badge !== undefined)).toBe(true);
    for (const p of shipped) expect((p.price === undefined) !== (p.badge === undefined), p.id).toBe(true);
  });
});

describe("checkOutfits", () => {
  const base = shipped;
  it("refuses a duplicate id", () => {
    expect(checkOutfits([...base, part("flat_cap")], badgeIds).join("\n")).toContain("duplicate outfit part id 'flat_cap'");
  });
  it("refuses a badge that does not exist", () => {
    const bad = base.map((p) => (p.id === "crown" ? { ...p, badge: "no_such_badge" } : p));
    expect(checkOutfits(bad, badgeIds).join("\n")).toContain("unknown badge 'no_such_badge'");
  });
  it("refuses too few parts, an unused slot and a missing required part", () => {
    const problems = checkOutfits([part("a"), part("b")], badgeIds).join("\n");
    expect(problems).toContain("at least 20");
    expect(problems).toContain("slot 'top'");
    expect(problems).toContain("slot 'accessory'");
    expect(problems).toContain("'flat_cap' is missing");
  });
});

describe("the part schema", () => {
  it("wants a price or a badge, not both and not neither", () => {
    expect(OutfitPartSchema.safeParse(part("a")).success).toBe(true);
    expect(OutfitPartSchema.safeParse(part("a", { price: undefined, badge: "veteran" })).success).toBe(true);
    expect(OutfitPartSchema.safeParse(part("a", { badge: "veteran" })).success).toBe(false);
    expect(OutfitPartSchema.safeParse(part("a", { price: undefined })).success).toBe(false);
  });
  it("wants four #rrggbb colours and a safe id", () => {
    expect(OutfitPartSchema.safeParse(part("a", { palette: { ...palette, accent: "red" } })).success).toBe(false);
    expect(OutfitPartSchema.safeParse(part("a", { palette: { main: "#112233", shade: "#223344", light: "#334455" } as never })).success).toBe(false);
    expect(OutfitPartSchema.safeParse(part("../x")).success).toBe(false);
    expect(OutfitPartSchema.safeParse(part("A")).success).toBe(false);
    expect(OutfitPartSchema.safeParse({ ...part("a"), extra: 1 }).success).toBe(false);
  });
  it("has a slot from the three", () => {
    expect(OutfitPartSchema.safeParse({ ...part("a"), slot: "shoes" }).success).toBe(false);
  });
});

describe("the wardrobe file", () => {
  it("is a list of part ids, each once", () => {
    expect(WardrobeFileSchema.safeParse({ version: 1, owned: ["flat_cap", "crown"] }).success).toBe(true);
    expect(WardrobeFileSchema.safeParse({ version: 1, owned: ["flat_cap", "flat_cap"] }).success).toBe(false);
    expect(WardrobeFileSchema.safeParse({ version: 1, owned: ["Bad Id"] }).success).toBe(false);
    expect(WardrobeFileSchema.safeParse({ version: 2, owned: [] }).success).toBe(false);
  });
});

describe("applyOutfitPurchase", () => {
  const cap = part("flat_cap", { price: 40, name: "Checked flat cap" });
  const crown = part("crown", { price: undefined, badge: "veteran" });
  const badgeName = () => "Hotel veteran";

  it("takes the price, adds the part and writes a ledger entry", () => {
    const r = applyOutfitPurchase(wallet(100), ["a"], cap, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.wallet.balance).toBe(60);
    expect(r.owned).toEqual(["a", "flat_cap"]);
    expect(r.entry).toEqual({ ts: 5, amount: -40, reason: "purchase", ref: "outfit:flat_cap" });
    expect(r.wallet.ledger.at(-1)).toEqual(r.entry);
  });

  it("refuses in order: unknown, badge only, already owned, too poor", () => {
    expect(applyOutfitPurchase(wallet(100), [], undefined, 0)).toMatchObject({ ok: false, code: "unknown_part", reason: "That outfit is not in the shop." });
    expect(applyOutfitPurchase(wallet(100), [], crown, 0, badgeName)).toMatchObject({ ok: false, code: "badge_only", reason: "This one cannot be bought: earn the Hotel veteran badge." });
    expect(applyOutfitPurchase(wallet(100), ["flat_cap"], cap, 0)).toMatchObject({ ok: false, code: "already_owned", reason: "You already own the Checked flat cap." });
    expect(applyOutfitPurchase(wallet(12), [], cap, 0)).toMatchObject({ ok: false, code: "not_enough_ecto", reason: "You need 40 Ecto and have 12." });
    // A badge part is badge-only even when it is owned and when the wallet is full.
    expect(applyOutfitPurchase(wallet(900), ["crown"], crown, 0)).toMatchObject({ ok: false, code: "badge_only" });
  });

  it("property: any sequence of purchases keeps the balance at or above zero, owns each part once and never buys a badge part", () => {
    const catalogue = [...shipped];
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600 }), fc.array(fc.integer({ min: 0, max: catalogue.length }), { maxLength: 60 }), (start, picks) => {
        let w = wallet(start);
        let owned: string[] = [];
        for (const i of picks) {
          const r = applyOutfitPurchase(w, owned, catalogue[i], 1);
          if (r.ok) {
            expect(catalogue[i]!.badge).toBeUndefined();
            w = r.wallet;
            owned = r.owned;
          } else {
            expect(r.reason.length).toBeGreaterThan(0);
          }
          expect(w.balance).toBeGreaterThanOrEqual(0);
          expect(new Set(owned).size).toBe(owned.length);
        }
        const spent = start - w.balance;
        expect(spent).toBe(owned.reduce((sum, id) => sum + (catalogue.find((p) => p.id === id)?.price ?? 0), 0));
      }),
    );
  });
});

describe("unlockedBy", () => {
  it("lists the parts that a badge unlocks and that are not owned yet", () => {
    expect(unlockedBy(shipped, [], new Set(["veteran"])).map((p) => p.id)).toEqual(["crown"]);
    expect(unlockedBy(shipped, ["crown"], new Set(["veteran"]))).toEqual([]);
    expect(unlockedBy(shipped, [], new Set()).length).toBe(0);
    expect(unlockedBy(shipped, [], new Set(["veteran", "ten_passes"])).map((p) => p.id)).toEqual(["crown", "halo"]);
  });
  it("never lists a part for sale", () => {
    const all = new Set(shipped.flatMap((p) => (p.badge ? [p.badge] : [])));
    for (const p of unlockedBy(shipped, [], all)) expect(p.price).toBeUndefined();
  });
});

describe("messages", () => {
  it("accepts the two client messages and checks the id", () => {
    expect(ClientMsgSchema.safeParse({ type: "wardrobe_state" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "outfit_buy", partId: "flat_cap" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "outfit_buy", partId: "../x" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "outfit_buy" }).success).toBe(false);
  });
  it("accepts the wardrobe and the unlock toast", () => {
    const state = { balance: 10, parts: shipped, owned: ["flat_cap"], badges: [{ id: "veteran", name: "Hotel veteran" }] };
    expect(WardrobeStateSchema.safeParse(state).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "wardrobe", state }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "part_unlocked", partId: "crown", name: "Paper crown", slot: "hat", badge: "Hotel veteran" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "part_unlocked", partId: "crown", name: "Paper crown", slot: "feet", badge: "x" }).success).toBe(false);
    expect(unlockText("Paper crown", "hat", "Hotel veteran")).toBe("Unlocked: Paper crown (hat), from the Hotel veteran badge");
  });
});

// ---- wearing (ghost-skins task 2) ----

describe("applyWear", () => {
  const cap = part("flat_cap", { name: "Checked flat cap" });
  const vest = part("waistcoat", { name: "Waistcoat", slot: "top" });
  const parts = [cap, vest, part("rose", { slot: "accessory" })];

  it("puts an owned part of the right slot on, keeping the other slots", () => {
    expect(applyWear(parts, ["flat_cap", "waistcoat"], { top: "waistcoat" }, "hat", "flat_cap")).toEqual({ ok: true, outfit: { top: "waistcoat", hat: "flat_cap" } });
  });

  it("replaces the part in the slot, and wearing the same part again is not an error", () => {
    const other = part("beanie");
    const r = applyWear([...parts, other], ["flat_cap", "beanie"], { hat: "flat_cap" }, "hat", "beanie");
    expect(r).toEqual({ ok: true, outfit: { hat: "beanie" } });
    expect(applyWear(parts, ["flat_cap"], { hat: "flat_cap" }, "hat", "flat_cap")).toEqual({ ok: true, outfit: { hat: "flat_cap" } });
  });

  it("takes a slot off, and that is allowed even when nothing is owned or the slot is empty", () => {
    expect(applyWear(parts, [], { hat: "flat_cap", top: "waistcoat" }, "hat", null)).toEqual({ ok: true, outfit: { top: "waistcoat" } });
    expect(applyWear(parts, [], {}, "top", null)).toEqual({ ok: true, outfit: {} });
  });

  it("refuses in order: unknown, not owned, wrong slot", () => {
    expect(applyWear(parts, ["flat_cap"], {}, "hat", "nope")).toMatchObject({ ok: false, code: "unknown_part", reason: "That outfit is not in the shop." });
    expect(applyWear(parts, [], {}, "hat", "flat_cap")).toMatchObject({
      ok: false,
      code: "not_owned",
      reason: "You do not own the Checked flat cap yet. Buy it at the shop counter in the lobby.",
    });
    expect(applyWear(parts, ["flat_cap"], {}, "top", "flat_cap")).toMatchObject({ ok: false, code: "wrong_slot", reason: "The Checked flat cap is a hat, not a top." });
    // Not owned wins over a wrong slot: the user is told to buy it first.
    expect(applyWear(parts, [], {}, "top", "flat_cap")).toMatchObject({ code: "not_owned" });
  });

  it("property: any sequence of wearing and taking off keeps every worn id owned, in its own slot", () => {
    fc.assert(
      fc.property(
        fc.subarray(shipped.map((p) => p.id)),
        fc.array(fc.tuple(fc.constantFrom(...OUTFIT_SLOTS), fc.option(fc.integer({ min: 0, max: shipped.length }), { nil: null })), { maxLength: 80 }),
        (owned, steps) => {
          let outfit: Outfit = {};
          for (const [slot, pick] of steps) {
            const id = pick === null ? null : (shipped[pick]?.id ?? "unknown_id");
            const r = applyWear(shipped, owned, outfit, slot, id);
            if (r.ok) outfit = r.outfit;
            for (const s of OUTFIT_SLOTS) {
              const worn = outfit[s];
              if (worn === undefined) continue;
              expect(owned).toContain(worn);
              expect(shipped.find((p) => p.id === worn)?.slot).toBe(s);
            }
          }
        },
      ),
    );
  });
});

describe("the outfits file and what the server tells", () => {
  it("is the user's outfit and one outfit per member, no empty ones", () => {
    const file = { version: 1, user: { hat: "crown" }, members: { "alpha/developer": { hat: "flat_cap", top: "waistcoat" } } };
    expect(WornFileSchema.safeParse(file).success).toBe(true);
    expect(WornFileSchema.safeParse(emptyWorn()).success).toBe(true);
    expect(WornFileSchema.safeParse({ ...file, members: { "alpha/developer": {} } }).success).toBe(false);
    expect(WornFileSchema.safeParse({ ...file, members: { "../x/developer": { hat: "a" } } }).success).toBe(false);
    expect(WornFileSchema.safeParse({ ...file, members: { developer: { hat: "a" } } }).success).toBe(false);
    expect(WornFileSchema.safeParse({ ...file, user: { shoes: "a" } }).success).toBe(false);
    expect(WornFileSchema.safeParse({ ...file, user: { hat: "Bad Id" } }).success).toBe(false);
    expect(WornFileSchema.safeParse({ ...file, version: 2 }).success).toBe(false);
  });

  it("turns into the list the client reads, with the project and the member split", () => {
    const state = wornState({ version: 1, user: { top: "waistcoat" }, members: { "my-app/ada": { accessory: "rose" }, "alpha/developer": { hat: "flat_cap" } } });
    expect(state).toEqual({
      user: { top: "waistcoat" },
      members: [
        { project: "my-app", member: "ada", outfit: { accessory: "rose" } },
        { project: "alpha", member: "developer", outfit: { hat: "flat_cap" } },
      ],
    });
    expect(WornStateSchema.safeParse(state).success).toBe(true);
    expect(wornKey("alpha", "developer")).toBe("alpha/developer");
  });

  it("has withSlot and outfitIsEmpty agree", () => {
    expect(outfitIsEmpty({})).toBe(true);
    expect(outfitIsEmpty(withSlot({}, "hat", "flat_cap"))).toBe(false);
    expect(outfitIsEmpty(withSlot({ hat: "flat_cap" }, "hat", null))).toBe(true);
  });

  it("accepts outfit_wear for the user and for a member, and nothing else", () => {
    const ok = (m: unknown) => ClientMsgSchema.safeParse(m).success;
    expect(ok({ type: "outfit_wear", who: "user", slot: "hat", partId: "flat_cap" })).toBe(true);
    expect(ok({ type: "outfit_wear", who: "user", slot: "hat", partId: null })).toBe(true);
    expect(ok({ type: "outfit_wear", who: { project: "alpha", member: "developer" }, slot: "top", partId: "waistcoat" })).toBe(true);
    expect(ok({ type: "outfit_wear", who: "everybody", slot: "hat", partId: "flat_cap" })).toBe(false);
    expect(ok({ type: "outfit_wear", who: { project: "../x", member: "developer" }, slot: "hat", partId: null })).toBe(false);
    expect(ok({ type: "outfit_wear", who: "user", slot: "shoes", partId: null })).toBe(false);
    expect(ok({ type: "outfit_wear", who: "user", slot: "hat", partId: "../x" })).toBe(false);
    expect(ok({ type: "outfit_wear", who: "user", slot: "hat" })).toBe(false);
  });

  it("accepts the outfits message and the outfit_error code", () => {
    const state = { user: {}, members: [{ project: "alpha", member: "developer", outfit: { hat: "flat_cap" } }] };
    expect(ServerMsgSchema.safeParse({ type: "outfits", state }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "outfits", state: { user: { hat: 3 }, members: [] } }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "outfit_error", message: "no" }).success).toBe(true);
  });
});
