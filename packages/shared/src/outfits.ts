import { z } from "zod";
import { LEDGER_MAX, keepLast } from "./economy.ts";
import type { LedgerEntry, Wallet } from "./economy.ts";
import { PRICE_MAX } from "./shop.ts";

/**
 * Outfits for the ghosts (ghost-skins): the parts, the wardrobe of the user and the rules to get a part. Pure; the
 * world-server keeps the files and the client draws the parts. See the spec's design.md.
 */

export const OUTFIT_SLOTS = ["hat", "top", "accessory"] as const;
export const OutfitSlotSchema = z.enum(OUTFIT_SLOTS);
export type OutfitSlot = z.infer<typeof OutfitSlotSchema>;

export const SLOT_LABELS: Readonly<Record<OutfitSlot, string>> = { hat: "Hat", top: "Top", accessory: "Accessory" };
/** Plural headings of the shop's Outfits page. */
export const SLOT_HEADINGS: Readonly<Record<OutfitSlot, string>> = { hat: "Hats", top: "Tops", accessory: "Accessories" };

/** The parts the shop must have, and the most a file may hold. */
export const OUTFIT_PARTS_MIN = 20;
export const OUTFIT_PARTS_MAX = 100;
/** Parts a wardrobe may hold (more than the file can have, so a smaller file never invalidates it). */
export const WARDROBE_MAX = 200;

/** The set the user asked for and the Kiroween pieces: these ids must exist. */
export const REQUIRED_PARTS = ["flat_cap", "waistcoat", "neckerchief", "carnation", "pumpkin_hat", "witch_hat", "bat_bow_tie", "candle"] as const;

export const PartIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
export const HexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * The four colours of a part. A recipe decides where each goes: `main` is the body of the piece, `shade` its dark side and
 * outlines, `light` the highlights or the second colour of a pattern, `accent` the small details (buttons, stems, flames).
 */
export const PartPaletteSchema = z.object({ main: HexColourSchema, shade: HexColourSchema, light: HexColourSchema, accent: HexColourSchema }).strict();
export type PartPalette = z.infer<typeof PartPaletteSchema>;

export const OutfitPartSchema = z
  .object({
    id: PartIdSchema,
    name: z.string().min(1).max(30),
    slot: OutfitSlotSchema,
    /** Ecto. Exactly one of `price` and `badge`. */
    price: z.number().int().min(1).max(PRICE_MAX).optional(),
    /** A badge id (`badges.json`) that unlocks the part for free; the part is then not for sale. */
    badge: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).optional(),
    palette: PartPaletteSchema,
  })
  .strict()
  .refine((p) => (p.price === undefined) !== (p.badge === undefined), "a part has a price or a badge, not both and not neither");
export type OutfitPart = z.infer<typeof OutfitPartSchema>;

/** `config/outfits.json`. */
export const OutfitsFileSchema = z.object({ version: z.literal(1), parts: z.array(OutfitPartSchema).max(OUTFIT_PARTS_MAX) }).strict();
export type OutfitsFile = z.infer<typeof OutfitsFileSchema>;

/** Every problem of a parts list, in words. Empty means the shop can show it. `badgeIds` are the badges that exist. */
export function checkOutfits(parts: readonly OutfitPart[], badgeIds: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (parts.length < OUTFIT_PARTS_MIN) problems.push(`there are ${parts.length} outfit parts, at least ${OUTFIT_PARTS_MIN} are required`);
  const seen = new Set<string>();
  for (const part of parts) {
    if (seen.has(part.id)) problems.push(`duplicate outfit part id '${part.id}'`);
    seen.add(part.id);
    if (part.badge !== undefined && !badgeIds.has(part.badge)) problems.push(`part '${part.id}' is unlocked by the unknown badge '${part.badge}'`);
  }
  for (const slot of OUTFIT_SLOTS) if (!parts.some((p) => p.slot === slot)) problems.push(`no outfit part uses the slot '${slot}'`);
  for (const id of REQUIRED_PARTS) if (!seen.has(id)) problems.push(`the outfit part '${id}' is missing`);
  return problems;
}

// ---- data/wardrobe.json ----

/** `data/wardrobe.json`: the part ids the user owns, in the order they were got. */
export const WardrobeFileSchema = z
  .object({
    version: z.literal(1),
    owned: z.array(PartIdSchema).max(WARDROBE_MAX),
  })
  .strict()
  .refine((w) => new Set(w.owned).size === w.owned.length, "a part is owned once");
export type WardrobeFile = z.infer<typeof WardrobeFileSchema>;

export function emptyWardrobe(): WardrobeFile {
  return { version: 1, owned: [] };
}

// ---- purchase ----

export const OUTFIT_PURCHASE_CODES = ["unknown_part", "badge_only", "already_owned", "not_enough_ecto"] as const;
export type OutfitPurchaseCode = (typeof OUTFIT_PURCHASE_CODES)[number];

export type OutfitPurchaseResult =
  | { ok: true; wallet: Wallet; owned: string[]; entry: LedgerEntry }
  | { ok: false; code: OutfitPurchaseCode; reason: string };

/** The ledger `ref` of an outfit purchase: it cannot be mistaken for a furniture item id. */
export function outfitRef(partId: string): string {
  return `outfit:${partId}`;
}

/**
 * Buys one part. The first rule that fails answers and nothing changes: the part must exist, must be for sale (a badge
 * part is only unlocked), must not be owned yet, and the balance must cover the price. `badgeName` is for the refusal text.
 */
export function applyOutfitPurchase(
  wallet: Wallet,
  owned: readonly string[],
  part: OutfitPart | undefined,
  ts: number,
  badgeName?: (badgeId: string) => string,
): OutfitPurchaseResult {
  if (!part) return { ok: false, code: "unknown_part", reason: "That outfit is not in the shop." };
  if (part.badge !== undefined || part.price === undefined) {
    const badge = part.badge === undefined ? "its badge" : `the ${badgeName?.(part.badge) ?? part.badge} badge`;
    return { ok: false, code: "badge_only", reason: `This one cannot be bought: earn ${badge}.` };
  }
  if (owned.includes(part.id)) return { ok: false, code: "already_owned", reason: `You already own the ${part.name}.` };
  if (wallet.balance < part.price) return { ok: false, code: "not_enough_ecto", reason: `You need ${part.price} Ecto and have ${wallet.balance}.` };
  const entry: LedgerEntry = { ts, amount: -part.price, reason: "purchase", ref: outfitRef(part.id) };
  return {
    ok: true,
    wallet: { ...wallet, balance: wallet.balance - part.price, ledger: keepLast([...wallet.ledger, entry], LEDGER_MAX) },
    owned: [...owned, part.id],
    entry,
  };
}

/** The parts that a badge in `badgeIds` unlocks and that are not owned yet, in file order. */
export function unlockedBy(parts: readonly OutfitPart[], owned: readonly string[], badgeIds: ReadonlySet<string>): OutfitPart[] {
  return parts.filter((p) => p.badge !== undefined && badgeIds.has(p.badge) && !owned.includes(p.id));
}

// ---- what the server tells the client ----

export const WardrobeBadgeSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), name: z.string().min(1).max(30) });

/**
 * The wardrobe as the Outfits page needs it, and the parts the client draws with. `badges` names the badges the parts
 * ask for, so the page can say what to earn without the progress view.
 */
export const WardrobeStateSchema = z.object({
  balance: z.number().int().nonnegative(),
  parts: z.array(OutfitPartSchema).max(OUTFIT_PARTS_MAX),
  owned: z.array(PartIdSchema).max(WARDROBE_MAX),
  badges: z.array(WardrobeBadgeSchema).max(OUTFIT_PARTS_MAX),
});
export type WardrobeState = z.infer<typeof WardrobeStateSchema>;

/** "Unlocked: Crown (hat), from the Hotel veteran badge". */
export function unlockText(partName: string, slot: OutfitSlot, badgeName: string): string {
  return `Unlocked: ${partName} (${SLOT_LABELS[slot].toLowerCase()}), from the ${badgeName} badge`;
}
