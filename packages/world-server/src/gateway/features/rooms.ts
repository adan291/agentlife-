// Rooms: the welcome into a room, moving between rooms (elevator, doors, list view), and the simulation output of a
// room (walks, says, panels) in the right order.
import type { WebSocket } from "ws";
import type { ClientMsg, ServerMsg, WelcomeMsg } from "@agentlife/shared";
import type { GatewayContext, Handlers } from "../context.ts";
import type { createBugs } from "./bugs.ts";
import type { EconomyFeature } from "./economy.ts";
import type { FloorsFeature } from "./floors.ts";
import type { JobsFeature } from "./jobs.ts";
import type { MoodFeature } from "./mood.ts";
import type { NightFeature } from "./night.ts";
import type { OutfitsFeature } from "./outfits.ts";
import type { PanelsFeature } from "./panels.ts";
import type { ProgressFeature } from "./progress.ts";
import type { TeamFeature } from "./team.ts";
import type { WispsFeature } from "./wisps.ts";

export interface RoomDeps {
  panels: Pick<PanelsFeature, "panelData">;
  wisps: Pick<WispsFeature, "forget">;
  mood: Pick<MoodFeature, "serveCoffee" | "welcome">;
  economy: Pick<EconomyFeature, "welcome">;
  bugs: Pick<ReturnType<typeof createBugs>, "welcome">;
  outfits: Pick<OutfitsFeature, "welcome">;
  progress: Pick<ProgressFeature, "welcome">;
  night: Pick<NightFeature, "welcome">;
  jobs: Pick<JobsFeature, "sendJobUpdate">;
  team: Pick<TeamFeature, "welcome">;
  floors: Pick<FloorsFeature, "pushFloors">;
}

export function createRooms(ctx: GatewayContext, d: RoomDeps) {
  const { hotel, send } = ctx;

  /** Welcome for a room, with that floor's work, activity, pending approvals and job, then the floor list. */
  const sendWelcome = (ws: WebSocket, roomId: string, welcome: WelcomeMsg): void => {
    // A welcome is a new room or a new connection: the client forgets its wisp, so the server does too.
    d.wisps.forget();
    const f = ctx.floors.get(roomId);
    const agents = welcome.agents.map((a) => {
      const work = f?.works.get(a.agentId);
      return work ? { ...a, work } : a;
    });
    const lines = f?.activity ?? [];
    const models = ctx.models;
    send(ws, { ...welcome, agents, ...(models ? { models } : {}), ...(lines.length > 0 ? { activity: [...lines] } : {}) });
    d.economy.welcome(ws);
    d.bugs.welcome(ws);
    d.outfits.welcome(ws);
    d.progress.welcome(ws);
    d.mood.welcome(ws, roomId);
    // A reload must still show the mailbox badge and the HUD line for a plan that waits.
    for (const a of f?.approvals.values() ?? []) if (a.status === "pending") send(ws, { type: "approval", approval: a });
    d.night.welcome(ws, roomId);
    // The progress stepper of a reloaded client needs the running job.
    if (f?.currentTaskId) ctx.enqueue(() => d.jobs.sendJobUpdate(roomId));
    d.team.welcome(ws, roomId);
    d.floors.pushFloors(true);
  };

  /** Moves the user to another room (elevator, door, removed floor) and sends that room's welcome. */
  const enterRoom = async (roomId: string): Promise<void> => {
    const current = ctx.session();
    if (!current || roomId === ctx.userRoom()) return;
    const welcome = hotel.moveUser(current.userId, roomId);
    if (welcome) sendWelcome(current.ws, roomId, welcome);
  };

  /** Send simulation output of a room; `open_panel` is preceded by the panel's data, and a door enters its room. */
  const sendSim = async (roomId: string, msgs: ServerMsg[]): Promise<void> => {
    for (const m of msgs) {
      const target = ctx.session()?.ws;
      if (!target || ctx.userRoom() !== roomId) return; // the user left the room meanwhile
      if (m.type === "open_panel") {
        // The coffee machine is not a panel: arriving at it serves the coffee.
        if (m.panel === "coffee") {
          d.mood.serveCoffee(roomId);
          continue;
        }
        if (m.panel === "door") {
          const to = (m.data as { to?: unknown } | undefined)?.to;
          if (typeof to === "string" && hotel.has(to)) await enterRoom(to);
          return;
        }
        await d.panels.panelData(target, roomId, m.panel);
      }
      send(target, m);
    }
  };

  /**
   * Another floor. By the elevator only while the avatar stands in front of one; from the list view or the command
   * palette (`via: "list"`, D13) from anywhere. The user enters the floor the same way in both cases.
   */
  const goTo = (ws: WebSocket, roomId: string, via: "elevator" | "list" = "elevator"): void => {
    const current = ctx.session();
    if (!current) return;
    if (!hotel.has(roomId)) return ctx.sendError(ws, "bad_message", "unknown floor");
    if (roomId === ctx.userRoom()) return;
    if (via === "elevator" && !hotel.atElevator(current.userId)) return ctx.sendError(ws, "bad_message", "use the elevator first");
    ctx.enqueue(() => enterRoom(roomId));
  };

  /** Deferred simulation messages of the room the user is in (walk steps, timed says). */
  const tick = (): void => {
    const here = ctx.userRoom();
    for (const [roomId, sim] of hotel.entries()) {
      const msgs = sim.dueMessages();
      if (roomId === here) ctx.deliver(roomId, msgs);
    }
  };

  /** Any other client message is an intent for the room's simulation (walk, say, use, sit, emote...). */
  const intent = (msg: ClientMsg): void => {
    const current = ctx.session();
    const roomId = ctx.userRoom();
    const sim = roomId ? hotel.sim(roomId) : undefined;
    if (current && roomId && sim) ctx.deliver(roomId, sim.handleIntent(current.userId, msg));
  };

  const handlers: Handlers = {
    go_to: (msg, { ws }) => goTo(ws, msg.roomId, msg.via),
  };

  return { sendWelcome, sendSim, tick, intent, handlers };
}
