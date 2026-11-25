// The Reception (registered projects), the repositories a floor's computer offers, the review desk's branches and the
// construction board.
import type { WebSocket } from "ws";
import { LOBBY_ROOM, projectIdOfRoom } from "@agentlife/shared";
import type { RegisterProjectBody } from "@agentlife/shared";
import { errorText } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";
import type { FloorsFeature } from "./floors.ts";

export function createProjects(ctx: GatewayContext, deps: { floors: Pick<FloorsFeature, "syncProjects"> }) {
  const { engine, send, sendError } = ctx;

  /** Reception data. Project paths never get this far: the engine only returns id, name, stack and test command. */
  const sendProjects = async (ws: WebSocket): Promise<void> => {
    if (!engine?.listProjects) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      send(ws, { type: "projects", projects: await engine.listProjects() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot list projects");
    }
  };

  /** The repositories the computer of a floor can start a job on: the floor's own project. */
  const sendRepos = async (ws: WebSocket, roomId: string): Promise<void> => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      const projectId = projectIdOfRoom(roomId);
      const repos = await engine.listRepos();
      send(ws, { type: "repos", repos: projectId === undefined ? repos : repos.filter((r) => r.id === projectId) });
    } catch {
      sendError(ws, "engine_unavailable", "cannot list repositories");
    }
  };

  /** After a project was added or removed: the floors, the Reception list and the computer panel's repository list. */
  const sendProjectLists = async (ws: WebSocket): Promise<void> => {
    await deps.floors.syncProjects();
    await sendProjects(ws);
    const room = ctx.userRoom();
    if (room && engine) await sendRepos(ws, room);
  };

  /** The branches of the project on the user's floor, for the branch picker of the review desk. */
  const sendBranches = async (ws: WebSocket, roomId: string): Promise<void> => {
    const projectId = projectIdOfRoom(roomId);
    if (projectId === undefined) return sendError(ws, "bad_message", "the review desk is on a project's floor");
    if (!engine?.listBranches) return sendError(ws, "engine_unavailable", "listing branches needs the real engine");
    try {
      send(ws, { type: "branches", projectId, ...(await engine.listBranches(projectId)) });
    } catch (e) {
      sendError(ws, "engine_unavailable", errorText(e, "cannot list the branches of the project"));
    }
  };

  const registerProject = async (ws: WebSocket, body: RegisterProjectBody): Promise<void> => {
    if (!engine?.registerProject) return sendError(ws, "engine_unavailable", "no engine connected");
    if (ctx.userRoom() !== LOBBY_ROOM) return sendError(ws, "bad_message", "projects are managed at the Reception in the lobby");
    try {
      const result = await engine.registerProject(body);
      send(ws, { type: "register_result", result });
      if (result.status === "ok") await sendProjectLists(ws);
    } catch {
      sendError(ws, "project_error", "cannot register the project");
    }
  };

  const removeProject = async (ws: WebSocket, projectId: string): Promise<void> => {
    if (!engine?.removeProject) return sendError(ws, "engine_unavailable", "no engine connected");
    if (ctx.userRoom() !== LOBBY_ROOM) return sendError(ws, "bad_message", "projects are managed at the Reception in the lobby");
    try {
      await engine.removeProject(projectId);
    } catch (e) {
      return sendError(ws, "project_error", errorText(e, "cannot remove the project"));
    }
    await sendProjectLists(ws);
  };

  /** Construction board data and verify reports: read-only, from the engine. */
  const sendBuildBoard = async (ws: WebSocket): Promise<void> => {
    if (!engine?.getBuildBoard) return sendError(ws, "engine_unavailable", "the construction board needs the real engine");
    try {
      send(ws, { type: "build_board", board: await engine.getBuildBoard() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read the construction board");
    }
  };

  const sendBuildReport = async (ws: WebSocket, spec: string): Promise<void> => {
    if (!engine?.getBuildReport) return sendError(ws, "engine_unavailable", "the construction board needs the real engine");
    try {
      send(ws, { type: "build_report", report: await engine.getBuildReport(spec) });
    } catch {
      sendError(ws, "engine_unavailable", "no verification report for that spec");
    }
  };

  const handlers: Handlers = {
    register_project: (msg, { ws }) =>
      void registerProject(ws, {
        path: msg.path,
        name: msg.name,
        ...(msg.testCommand === undefined ? {} : { testCommand: msg.testCommand }),
        ...(msg.acceptFindings === undefined ? {} : { acceptFindings: msg.acceptFindings }),
      }),
    remove_project: (msg, { ws }) => void removeProject(ws, msg.projectId),
    list_branches: (_msg, { ws }) => {
      const room = ctx.userRoom();
      if (room) void sendBranches(ws, room);
    },
    build_board: (_msg, { ws }) => void sendBuildBoard(ws),
    build_report: (msg, { ws }) => void sendBuildReport(ws, msg.spec),
  };

  return { sendProjects, sendRepos, sendBranches, sendBuildBoard, handlers };
}
export type ProjectsFeature = ReturnType<typeof createProjects>;
