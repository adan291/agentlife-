import type { Hotel } from "@agentlife/shared";
import type { BugStore } from "../bug-store.ts";
import type { Economy } from "../economy-store.ts";
import type { EngineLink } from "../engine-link.ts";
import type { LayoutStore } from "../layout-store.ts";
import type { WornStore } from "../outfit-store.ts";
import type { ProgressStore } from "../progress-store.ts";
import type { WispOptions } from "../wisps.ts";

export interface GatewayOptions {
  /** The rooms. Project floors are added and removed to match the engine's projects. */
  hotel: Hotel;
  /** Source of jobs and agent events. Without it, job commands reply `engine_unavailable`. */
  engine?: EngineLink;
  host?: string;
  /** 0 picks an ephemeral port. */
  port?: number;
  /**
   * Origins allowed to open a WebSocket (security audit M3). Default: the Vite dev server on localhost and
   * 127.0.0.1, port 5173. A request without Origin is accepted only when `host` is a loopback address.
   */
  allowedOrigins?: readonly string[];
  /** Milliseconds between checks for deferred sim messages. */
  tickMs?: number;
  /** Milliseconds between looks at the engine's night shift (summaries, window). Default 60000. */
  nightPollMs?: number;
  /** Milliseconds the overview waits after a change before it is sent (changes within it are sent once). Default 300. */
  overviewDebounceMs?: number;
  /** Clock for the rate limiter. */
  clock?: () => number;
  /** Where arrangements of project floors are saved. Without it a move still works but is not kept across restarts. */
  layouts?: Pick<LayoutStore, "set">;
  /**
   * The user's Ecto (furni-shop). Without it the hotel has no economy: no `wallet` message is sent and nothing is
   * granted. `main.ts` passes one only for a real engine, because the fake engine's jobs are not real work.
   */
  economy?: Pick<
    Economy,
    "balance" | "ledger" | "grant" | "hasGranted" | "shop" | "buy" | "planPlace" | "planPickUp" | "planMove" | "returnAbsentFloors" | "returnHiddenPieces" | "hasWardrobe" | "wardrobe" | "buyPart" | "unlockParts"
  >;
  /** Test knobs of the wisps (waiting-fun): how often they appear, how long they live and the random source. Defaults: 20 to 60 s and 8 s. */
  wisps?: WispOptions;
  /** Test knobs of the mood of the desk agents: the work that makes them busy and tired, and how often a crossing is looked for. Defaults: 20 min, 60 min and 15 s. */
  mood?: { busyMs?: number; tiredMs?: number; pollMs?: number };
  /** Test knobs of the Builder's stale state: how long it may stay silent while busy, and how often that is looked at. Defaults: 10 min and 30 s. */
  builder?: { staleMs?: number; pollMs?: number };
  /**
   * XP, levels and stats (team-progress). Without it the hotel has no progress: no `progress` message is sent and nothing
   * is counted. `main.ts` passes one only for a real engine, because the fake engine's jobs are not real work.
   */
  progress?: Pick<ProgressStore, "record" | "view" | "payouts" | "settle">;
  /**
   * What the user and the team members wear (ghost-skins). Only used together with an economy that has a wardrobe: without
   * both, no `outfits` message is sent and every wear request is refused.
   */
  outfits?: Pick<WornStore, "state" | "outfitOf" | "set" | "pruneProject">;
  /**
   * The Bug sack (spec bug-sack). Without it a `bug_report` is answered with `bug_error` and an error in the gateway is
   * only swallowed as before. `main.ts` passes one only for the real engine or when `AGENTLIFE_BUGS_FILE` is set.
   */
  bugs?: Pick<BugStore, "record" | "recordError" | "setStatus" | "get" | "summaries" | "openCount" | "readScreenshot" | "exportMarkdown" | "onChange">;
}

export type EconomyPort = NonNullable<GatewayOptions["economy"]>;
