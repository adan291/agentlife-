// The data each piece of furniture's panel needs, sent before the panel opens.
import type { WebSocket } from "ws";
import { FURNI_CATALOG, LOBBY_ROOM, projectIdOfRoom } from "@agentlife/shared";
import type { ShowablePanel } from "@agentlife/shared";
import type { GatewayContext, Handlers } from "../context.ts";
import type { createBugs } from "./bugs.ts";
import type { EconomyFeature } from "./economy.ts";
import type { FloorsFeature } from "./floors.ts";
import type { JobsFeature } from "./jobs.ts";
import type { LibraryFeature } from "./library.ts";
import type { NightFeature } from "./night.ts";
import type { OutfitsFeature } from "./outfits.ts";
import type { PipelineFeature } from "./pipeline.ts";
import type { ProjectsFeature } from "./projects.ts";
import type { TeamFeature } from "./team.ts";

export interface PanelDeps {
  projects: Pick<ProjectsFeature, "sendRepos" | "sendBranches" | "sendProjects" | "sendBuildBoard">;
  library: Pick<LibraryFeature, "sendMemory">;
  night: Pick<NightFeature, "syncSummaries" | "summariesOpened" | "sendNight">;
  floors: Pick<FloorsFeature, "pushFloors">;
  jobs: Pick<JobsFeature, "sendJobUpdate">;
  pipeline: Pick<PipelineFeature, "sendPipeline">;
  team: Pick<TeamFeature, "sendHr">;
  economy: Pick<EconomyFeature, "sendShop">;
  outfits: Pick<OutfitsFeature, "sendWardrobe">;
  bugs: Pick<ReturnType<typeof createBugs>, "sendBugs">;
}

export function createPanels(ctx: GatewayContext, d: PanelDeps) {
  const panelData = async (ws: WebSocket, roomId: string, panel: string): Promise<void> => {
    const f = ctx.floorOf(roomId);
    if (panel === "computer" || panel === "tests" || panel === "library") {
      await d.projects.sendRepos(ws, roomId);
      if (panel === "library") await d.library.sendMemory(ws, true);
    } else if (panel === "review") {
      await d.projects.sendRepos(ws, roomId);
      await d.projects.sendBranches(ws, roomId);
    } else if (panel === "reception") {
      await d.projects.sendProjects(ws);
    } else if (panel === "mailbox") {
      // The lobby's mailbox holds the morning summaries; ask the engine so a summary written a moment ago is there.
      if (roomId === LOBBY_ROOM) await d.night.syncSummaries();
      else await d.library.sendMemory(ws, true);
      for (const a of f.approvals.values()) ctx.send(ws, { type: "approval", approval: a });
      for (const r of f.reports.values()) ctx.send(ws, { type: "report", report: r, resend: true });
      if (roomId === LOBBY_ROOM) d.night.summariesOpened();
      if (f.unread) {
        f.unread = null;
        d.floors.pushFloors();
      }
    } else if (panel === "board") {
      await d.jobs.sendJobUpdate(roomId);
      if (projectIdOfRoom(roomId) !== undefined) await d.pipeline.sendPipeline(ws, true);
    } else if (panel === "elevator" || panel === "directory") {
      d.floors.pushFloors(true);
    } else if (panel === "build") {
      await d.projects.sendBuildBoard(ws);
    } else if (panel === "night") {
      // The form lists the hotel's projects, so they travel with the schedule.
      await d.projects.sendProjects(ws);
      await d.night.sendNight(ws);
    } else if (panel === "hr") {
      await d.team.sendHr(ws);
    } else if (panel === "shop") {
      d.economy.sendShop(ws);
      d.outfits.sendWardrobe(ws);
    } else if (panel === "bugs") {
      d.bugs.sendBugs(ws);
    }
  };

  /** Furniture (by interaction) that each showable panel stands for: the floor must have it. */
  const showPanel = (ws: WebSocket, panel: ShowablePanel): void => {
    const roomId = ctx.userRoom();
    const sim = roomId ? ctx.hotel.sim(roomId) : undefined;
    if (!roomId || !sim) return;
    if (!sim.room.furni.some((p) => FURNI_CATALOG[p.defId]?.interaction === panel)) {
      return ctx.sendError(ws, "bad_message", "this floor has no such desk");
    }
    // Same order as for the furniture: the data first, then the panel.
    ctx.enqueue(async () => {
      if (ctx.userRoom() !== roomId) return;
      await panelData(ws, roomId, panel);
      if (ctx.userRoom() === roomId) ctx.send(ws, { type: "open_panel", panel });
    });
  };

  const handlers: Handlers = {
    show_panel: (msg, { ws }) => showPanel(ws, msg.panel),
  };

  return { panelData, handlers };
}
export type PanelsFeature = ReturnType<typeof createPanels>;
