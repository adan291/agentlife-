// Mood of the desk agents, cheer and glum after a delivery, the coffee machine (waiting-fun task 2). All for show: none
// of it reaches a job.
import type { WebSocket } from "ws";
import { MOOD_BUSY_MS, MOOD_TIRED_MS, projectIdOfRoom, projectRoomId } from "@agentlife/shared";
import type { AgentEvent, ServerMsg } from "@agentlife/shared";
import { MoodKeeper } from "../../mood.ts";
import type { GatewayContext } from "../context.ts";
import type { EconomyFeature } from "./economy.ts";
import type { TeamFeature } from "./team.ts";

/** A delivered job older than this when its event arrives (a replay after a restart) makes the ghosts neither cheer nor sulk. */
const FRESH_DELIVERY_MS = 60_000;

export function createMood(ctx: GatewayContext, deps: { economy: Pick<EconomyFeature, "tracker">; team: Pick<TeamFeature, "ghostsOn"> }) {
  const opts = ctx.options.mood;
  const keeper = new MoodKeeper({ limits: { busyMs: opts?.busyMs ?? MOOD_BUSY_MS, tiredMs: opts?.tiredMs ?? MOOD_TIRED_MS } });
  /** What each project's moods looked like when they were last sent, so only a change is sent again. */
  const lastMoods = new Map<string, string>();
  const moodMsg = (projectId: string): ServerMsg => ({ type: "mood", roomId: projectRoomId(projectId), moods: keeper.moods(projectId) });

  /** Tells the user the moods of a project's floor when they changed (or `force`). */
  const pushMoods = (projectId: string, force = false): void => {
    const msg = moodMsg(projectId);
    const key = JSON.stringify(msg);
    if (!force && lastMoods.get(projectId) === key) return;
    lastMoods.set(projectId, key);
    ctx.toUser(projectRoomId(projectId), msg);
  };

  // A mood crosses its threshold between two events while an agent works: one look every few seconds catches it.
  const poll = setInterval(() => {
    const projectId = ctx.userProject();
    if (projectId !== undefined) pushMoods(projectId);
  }, opts?.pollMs ?? 15_000);
  poll.unref();

  /** The work an event shows changes the mood of its desk. */
  const observe = (ev: AgentEvent): void => {
    const worked = keeper.observe(ev);
    if (worked) pushMoods(worked.projectId);
  };

  /** A job was delivered: the ghosts of the floor cheer when it passed and look glum when it did not. */
  const reactToDelivery = (roomId: string, taskId: string, ts: number): void => {
    // An event from before the connection (the replay after a restart) is old news.
    if (Date.now() - ts > FRESH_DELIVERY_MS) return;
    const facts = deps.economy.tracker.facts(taskId);
    if (!facts) return;
    const emote = facts.failed || facts.verdict === "fail" ? "glum" : facts.verdict === "pass" ? "cheer" : undefined;
    if (!emote) return;
    for (const id of deps.team.ghostsOn(roomId)) ctx.toUser(roomId, { type: "emote", id, emote });
  };

  /**
   * The user used the coffee machine: the desk agent that is the most tired gets a cup and is rested. When nobody is tired
   * the user says so. Never throws.
   */
  const serveCoffee = (roomId: string): void => {
    const projectId = projectIdOfRoom(roomId);
    const current = ctx.session();
    if (projectId === undefined || !current) return;
    const role = keeper.mostTired(projectId);
    if (!role) return ctx.toUser(roomId, { type: "say", id: current.userId, text: "Nobody here needs coffee." });
    keeper.serveCoffee(projectId, role);
    ctx.toUser(roomId, { type: "say", id: role, text: "Thanks for the coffee!" });
    ctx.toUser(roomId, { type: "emote", id: role, emote: "cheer" });
    pushMoods(projectId, true);
  };

  /** The mood of the desk agents of a project floor, for the tags over their heads and their tooltips. */
  const welcome = (ws: WebSocket, roomId: string): void => {
    const projectId = projectIdOfRoom(roomId);
    if (projectId === undefined) return;
    const mood = moodMsg(projectId);
    lastMoods.set(projectId, JSON.stringify(mood));
    ctx.send(ws, mood);
  };

  return { observe, reactToDelivery, serveCoffee, welcome, close: () => clearInterval(poll) };
}
export type MoodFeature = ReturnType<typeof createMood>;
