import { z } from "zod";
import { localDay } from "./badges.ts";
import type { FurniDef } from "./furni.ts";
import { footprintSize } from "./room.ts";
import type { PlacedFurni } from "./room.ts";

/**
 * Things to do while the agents work (waiting-fun). Pure rules and constants; the world-server decides what exists and
 * what is granted, the client draws. Nothing here changes a job, a model or a permission. See the spec's design.md.
 */

// ---- wisps ----

/** Ecto for one wisp. A fixed constant, like the reward of a quest: `config/economy.json` keeps its five fixed reasons. */
export const WISP_REWARD = 1;
/** How long a wisp is there, and how late a click that was sent in time may still arrive. */
export const WISP_LIFE_MS = 8000;
export const WISP_GRACE_MS = 1000;
/** A wisp is tried every this long (a random time in between), while a job runs on the user's floor. */
export const WISP_MIN_MS = 20_000;
export const WISP_MAX_MS = 60_000;
/** Catches that pay, per job and per local day. */
export const WISPS_PER_JOB = 10;
export const WISPS_PER_DAY = 50;
/** A task id longer than this cannot carry the `.<n>` of its catches inside the 100 characters of a grant ref. */
export const WISP_TASK_ID_MAX = 90;

export const WispIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/** The grant ref of the `n`th wisp of a job (1 to `WISPS_PER_JOB`). */
export function wispRef(taskId: string, n: number): string {
  return `${taskId}.${n}`;
}

/** The first catch number of the job that the wallet has not paid yet, or undefined when the job reached its limit. */
export function nextWispRef(taskId: string, paid: (ref: string) => boolean): string | undefined {
  for (let n = 1; n <= WISPS_PER_JOB; n++) {
    const ref = wispRef(taskId, n);
    if (!paid(ref)) return ref;
  }
  return undefined;
}

/** Catches paid on the local day of `now`, read from the wallet's ledger. */
export function wispsToday(ledger: readonly { ts: number; reason: string }[], now: number): number {
  const today = localDay(now);
  let n = 0;
  for (const e of ledger) if (e.reason === "wisp_caught" && localDay(e.ts) === today) n++;
  return n;
}

// ---- seats ----

/** Furniture the avatar can sit on. One sitter per piece. */
export const SEAT_DEFS: readonly string[] = ["chair", "sofa", "armchair", "bench", "beanbag", "throne"];

export function isSeatDef(def: Pick<FurniDef, "id"> | undefined): boolean {
  return def !== undefined && SEAT_DEFS.includes(def.id);
}

/**
 * The tile an avatar sits on: the footprint tile next to the use tile (the tile in front of the piece). A sofa seats
 * its sitter at the end that is nearest to where the avatar comes from.
 */
export function seatTile(p: PlacedFurni, def: FurniDef): { x: number; y: number } {
  const { w, l } = footprintSize(def, p.dir);
  switch (p.dir) {
    case 2:
      return { x: p.x + w - 1, y: p.y };
    case 4:
      return { x: p.x, y: p.y + l - 1 };
    default:
      return { x: p.x, y: p.y };
  }
}

// ---- emotes ----

/** What the user can play. */
export const USER_EMOTES = ["wave", "dance", "cheer"] as const;
export const UserEmoteSchema = z.enum(USER_EMOTES);
export type UserEmote = z.infer<typeof UserEmoteSchema>;

/** What the room can show: the user's, and `glum` for an agent whose job did not pass. */
export const EmoteSchema = z.enum([...USER_EMOTES, "glum"]);
export type Emote = z.infer<typeof EmoteSchema>;

/** How long the client plays each emote. */
export const EMOTE_MS: Readonly<Record<Emote, number>> = { wave: 2400, cheer: 2400, dance: 5000, glum: 3000 };

// ---- mood ----

export const MOODS = ["rested", "busy", "tired"] as const;
export const MoodSchema = z.enum(MOODS);
export type Mood = z.infer<typeof MoodSchema>;

/** Work today (since the last coffee) from which an agent is busy, and from which it is tired. */
export const MOOD_BUSY_MS = 20 * 60_000;
export const MOOD_TIRED_MS = 60 * 60_000;

export interface MoodLimits {
  busyMs: number;
  tiredMs: number;
}
export const DEFAULT_MOOD_LIMITS: MoodLimits = { busyMs: MOOD_BUSY_MS, tiredMs: MOOD_TIRED_MS };

/** The mood of an agent that has worked `workedMs` today. Never gets better as the time grows. */
export function moodOf(workedMs: number, limits: MoodLimits = DEFAULT_MOOD_LIMITS): Mood {
  if (workedMs >= limits.tiredMs) return "tired";
  if (workedMs >= limits.busyMs) return "busy";
  return "rested";
}

/** The line of the agent tooltip. It says what mood is not: a mood never changes work. */
export function moodLine(mood: Mood): string {
  const label = mood === "rested" ? "Rested" : mood === "busy" ? "Busy" : "Tired";
  return `Mood: ${label}. Only for show: it never changes a job, a model or a permission.`;
}
