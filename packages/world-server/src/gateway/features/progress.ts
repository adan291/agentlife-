// XP, levels, stats, badges and quests (team-progress).
import type { WebSocket } from "ws";
import { memberKey } from "@agentlife/shared";
import type { LevelUp } from "@agentlife/shared";
import type { TrackedFact } from "../../progress-tracker.ts";
import type { GatewayContext } from "../context.ts";
import type { EconomyFeature } from "./economy.ts";
import type { OutfitsFeature } from "./outfits.ts";
import type { TeamFeature } from "./team.ts";

type Named = ReadonlyMap<string, { projectId: string; memberId: string; name: string }>;

export function createProgress(
  ctx: GatewayContext,
  deps: { economy: Pick<EconomyFeature, "grantEcto">; outfits: Pick<OutfitsFeature, "unlockOutfits">; team: Pick<TeamFeature, "seatOfRole" | "slotOfMember"> },
) {
  const { progress, economy } = ctx.options;
  const { send } = ctx;
  /** Night jobs the user scheduled since the gateway started: part of the unique ref of each fact. */
  let nightScheduled = 0;

  /**
   * Pays the quests that were completed and whose Ecto the wallet does not have yet. The grant is the same idempotent call
   * as every other (`quest_done`, keyed by the day and the quest), so a payout that was paid before a crash is only taken
   * off the list. A payout that cannot be written stays and is tried again at the next fact and at start. Without an
   * economy a quest completes and pays nothing.
   */
  const payQuests = (): void => {
    if (!progress) return;
    for (const payout of progress.payouts()) {
      if (economy) {
        const entry = deps.economy.grantEcto("quest_done", payout.ref, Date.now(), payout.reward);
        if (!entry && !economy.hasGranted("quest_done", payout.ref)) continue;
      }
      progress.settle(payout.ref);
    }
  };

  const announceLevelUp = (up: LevelUp, named: Named): void => {
    const current = ctx.session();
    if (!current) return;
    if (up.who === "user") return void send(current.ws, { type: "level_up", who: "user", name: "You", level: up.to });
    const who = named.get(up.who.member);
    if (!who) return;
    const slot = deps.team.slotOfMember(who.projectId, who.memberId);
    send(current.ws, { type: "level_up", who: "member", name: who.name, level: up.to, ...(slot ? { slot } : {}) });
  };

  /** Counts a fact once, then tells the user: the new numbers, a level-up for each level that went up, and the badges earned. */
  const recordFact = async (tracked: TrackedFact): Promise<void> => {
    if (!progress) return;
    const { projectId } = tracked;
    const seats = projectId === undefined ? [] : await Promise.all(tracked.roles.map((role) => deps.team.seatOfRole(projectId, role)));
    const named = new Map<string, { projectId: string; memberId: string; name: string }>();
    if (projectId !== undefined) for (const s of seats) named.set(memberKey(projectId, s.id), { projectId, memberId: s.id, name: s.name });
    const result = progress.record(tracked.fact, [...named.keys()]);
    payQuests();
    if (result.badges.length > 0) deps.outfits.unlockOutfits(new Set(result.badges.map((b) => b.badge.id)));
    const current = ctx.session();
    if (!result.changed || !current) return;
    send(current.ws, { type: "progress", state: progress.view() });
    for (const up of result.levelUps) announceLevelUp(up, named);
    for (const earned of result.badges) {
      const owner = earned.who === "user" ? "You" : named.get(earned.who.member)?.name;
      if (owner) send(current.ws, { type: "badge_earned", who: earned.who === "user" ? "user" : "member", owner, badge: earned.badge.name });
    }
  };

  /** The user planned a night job: a quest and a badge count it. The ref is unique, there is nothing to replay. */
  const recordNightScheduled = async (): Promise<void> => {
    const ts = Date.now();
    await recordFact({ fact: { source: "night_scheduled", ref: `night-${ts}-${++nightScheduled}`, ts }, roles: [] });
  };

  const welcome = (ws: WebSocket): void => {
    if (progress) send(ws, { type: "progress", state: progress.view() });
  };

  return { enabled: progress !== undefined, payQuests, recordFact, recordNightScheduled, welcome };
}
export type ProgressFeature = ReturnType<typeof createProgress>;
