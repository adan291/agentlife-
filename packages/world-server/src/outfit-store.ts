import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORN_MEMBERS_MAX, WornFileSchema, emptyWorn, outfitIsEmpty, withSlot, wornKey, wornState } from "@agentlife/shared";
import type { Outfit, OutfitSlot, WearWho, WornFile, WornState } from "@agentlife/shared";
import { readJsonFile, writeJsonFile } from "./json-file.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** `data/outfits.json` at the repository root, or `AGENTLIFE_OUTFITS_FILE`. */
export function defaultOutfitsFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_OUTFITS_FILE"] ?? join(here, "..", "..", "..", "data", "outfits.json");
}

export interface WornStoreOptions {
  file: string;
  now?: () => number;
  onLog?: (message: string) => void;
}

export type WearChange = { ok: true; changed: boolean } | { ok: false; reason: string };

/**
 * What the user and the team members wear (ghost-skins), kept in `data/outfits.json`. The rules that decide whether a
 * part may be worn are the shared `applyWear`; this class only keeps the answer. Nothing here knows whether a member
 * exists: the gateway checks that against the engine's team before it asks. A write that fails changes nothing.
 */
export class WornStore {
  private worn: WornFile;
  private readonly file: string;
  private readonly log: (message: string) => void;

  constructor(opts: WornStoreOptions) {
    this.file = opts.file;
    this.log = opts.onLog ?? (() => undefined);
    const read = readJsonFile(this.file, WornFileSchema, { ...(opts.now ? { now: opts.now } : {}), onLog: this.log });
    this.worn = read ?? emptyWorn();
  }

  state(): WornState {
    return wornState(this.worn);
  }

  /** What one person wears now (a copy). */
  outfitOf(who: WearWho): Outfit {
    return { ...(who === "user" ? this.worn.user : (this.worn.members[wornKey(who.project, who.member)] ?? {})) };
  }

  private save(next: WornFile): boolean {
    try {
      writeJsonFile(this.file, next);
    } catch (e) {
      this.log(`cannot write ${this.file}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    this.worn = next;
    return true;
  }

  /** The file with `who` dressed in `outfit` (an empty outfit removes a member's entry). */
  private with(who: WearWho, outfit: Outfit): WornFile {
    if (who === "user") return { ...this.worn, user: outfit };
    const members = { ...this.worn.members };
    const key = wornKey(who.project, who.member);
    if (outfitIsEmpty(outfit)) delete members[key];
    else members[key] = outfit;
    return { ...this.worn, members };
  }

  /**
   * Keeps `outfit` as what `who` wears. `changed` is false when it already was. Refused when the file is full of other
   * members or cannot be written (then nothing changed).
   */
  set(who: WearWho, outfit: Outfit): WearChange {
    const before = this.outfitOf(who);
    if (JSON.stringify(sorted(before)) === JSON.stringify(sorted(outfit))) return { ok: true, changed: false };
    if (who !== "user" && !outfitIsEmpty(outfit) && Object.keys(this.worn.members).length >= WORN_MEMBERS_MAX && this.worn.members[wornKey(who.project, who.member)] === undefined) {
      return { ok: false, reason: "Too many team members already wear something." };
    }
    return this.save(this.with(who, outfit)) ? { ok: true, changed: true } : { ok: false, reason: "Could not save the outfit." };
  }

  /** Puts one slot of `who` right (a convenience for tests and callers that already hold the new part id). */
  setSlot(who: WearWho, slot: OutfitSlot, partId: string | null): WearChange {
    return this.set(who, withSlot(this.outfitOf(who), slot, partId));
  }

  /**
   * Drops the outfit of every member of `project` whose id is not in `memberIds` (they were let go). Returns true when
   * something was dropped; a failed write drops nothing and the next call tries again.
   */
  pruneProject(project: string, memberIds: ReadonlySet<string>): boolean {
    const prefix = `${project}/`;
    const gone = Object.keys(this.worn.members).filter((key) => key.startsWith(prefix) && !memberIds.has(key.slice(prefix.length)));
    if (gone.length === 0) return false;
    const members = { ...this.worn.members };
    for (const key of gone) delete members[key];
    return this.save({ ...this.worn, members });
  }
}

function sorted(o: Outfit): Outfit {
  const out: Outfit = {};
  if (o.hat !== undefined) out.hat = o.hat;
  if (o.top !== undefined) out.top = o.top;
  if (o.accessory !== undefined) out.accessory = o.accessory;
  return out;
}
