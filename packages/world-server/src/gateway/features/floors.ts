// The floor list (elevator, directory), the overview behind the list view and the command palette, and keeping the
// rooms in step with the engine's projects.
import { LOBBY_ROOM, projectIdOfRoom, projectRoomId } from "@agentlife/shared";
import type { FloorStatus, NightState, Project } from "@agentlife/shared";
import { floorStatusOf, overviewOf } from "../../overview.ts";
import type { GatewayContext, Handlers } from "../context.ts";

export function createFloors(ctx: GatewayContext) {
  const { hotel, engine, floors, send } = ctx;
  const economy = ctx.options.economy;

  let lastOverviewKey = "";
  let overviewTimer: NodeJS.Timeout | undefined;
  /** Night jobs that still wait, per project, from the last look at the engine's night shift. */
  let nightCounts = new Map<string, number>();

  const floorStatuses = (): FloorStatus[] =>
    hotel.floors().map((info) => ({ roomId: info.roomId, name: info.name, kind: info.kind, ...floorStatusOf(floors.get(info.roomId)) }));

  /** Sends the overview to a client that watches it, when it changed (or `force`). */
  const pushOverview = (force = false): void => {
    const current = ctx.session();
    if (!current?.overviewWatch) return;
    const list = overviewOf(hotel.floors(), floors, nightCounts).slice(0, 100);
    const key = JSON.stringify(list);
    if (!force && key === lastOverviewKey) return;
    lastOverviewKey = key;
    send(current.ws, { type: "overview", floors: list });
  };

  /** Many changes come in bursts (a job moves through several states); the client gets one overview for each burst. */
  const scheduleOverview = (): void => {
    if (!ctx.session()?.overviewWatch || overviewTimer) return;
    overviewTimer = setTimeout(() => {
      overviewTimer = undefined;
      pushOverview();
    }, ctx.options.overviewDebounceMs ?? 300);
    overviewTimer.unref();
  };

  const rememberNight = (state: NightState): void => {
    const next = new Map<string, number>();
    for (const j of state.jobs) if (j.status === "scheduled" || j.status === "waiting") next.set(j.repoId, (next.get(j.repoId) ?? 0) + 1);
    const changed = JSON.stringify([...next]) !== JSON.stringify([...nightCounts]);
    nightCounts = next;
    if (changed) scheduleOverview();
  };

  let lastFloorsKey = "";
  /** Sends the floor list to the user when it changed (or `force`). */
  const pushFloors = (force = false): void => {
    const list = floorStatuses().slice(0, 100);
    const key = JSON.stringify(list);
    scheduleOverview();
    if (!force && key === lastFloorsKey) return;
    lastFloorsKey = key;
    const current = ctx.session();
    if (current) send(current.ws, { type: "floors", floors: list });
  };

  /** Makes the rooms match the engine's projects: a floor for each project, none for a removed one. Never throws. */
  const syncProjects = async (): Promise<void> => {
    if (!engine?.listProjects) return;
    let projects: Project[];
    try {
      projects = await engine.listProjects();
    } catch {
      return; // keep the floors we have
    }
    const wanted = new Set(projects.map((p) => projectRoomId(p.id)));
    for (const p of projects) hotel.addProject({ id: p.id, name: p.name });
    // Bought pieces of a removed project come back to the inventory, also those of a project that was removed while the
    // world-server was off. A piece the floor could not take (the template changed) comes back too.
    let stockChanged = false;
    if (economy) {
      stockChanged = economy.returnAbsentFloors(new Set(projects.map((p) => p.id)));
      for (const p of projects) {
        const visible = new Set(hotel.sim(projectRoomId(p.id))?.room.furni.map((f) => f.itemId));
        if (economy.returnHiddenPieces(p.id, visible)) stockChanged = true;
      }
    }
    for (const info of hotel.floors()) {
      if (info.kind !== "project" || wanted.has(info.roomId)) continue;
      const moved = hotel.removeProject(projectIdOfRoom(info.roomId)!);
      floors.delete(info.roomId);
      const current = ctx.session();
      if (current) {
        for (const m of moved) if (m.userId === current.userId) ctx.wire.sendWelcome(current.ws, LOBBY_ROOM, m.welcome);
      }
    }
    const current = ctx.session();
    if (stockChanged && economy && current) send(current.ws, { type: "shop", state: economy.shop() });
    pushFloors();
  };

  const watchOverview = (on: boolean): void => {
    const current = ctx.session();
    if (!current) return;
    current.overviewWatch = on;
    if (on) pushOverview(true);
  };

  const handlers: Handlers = {
    overview_watch: (msg) => watchOverview(msg.on),
  };

  return {
    pushFloors,
    scheduleOverview,
    rememberNight,
    syncProjects,
    handlers,
    close: () => clearTimeout(overviewTimer),
  };
}
export type FloorsFeature = ReturnType<typeof createFloors>;
