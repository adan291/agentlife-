// The Library: what the team of a project remembers (project-memory).
import type { WebSocket } from "ws";
import type { MemoryAction } from "@agentlife/shared";
import { errorText } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";
import type { EconomyFeature } from "./economy.ts";
import type { ProgressFeature } from "./progress.ts";

export function createLibrary(ctx: GatewayContext, deps: { economy: Pick<EconomyFeature, "grantEcto">; progress: Pick<ProgressFeature, "recordFact"> }) {
  const { engine, send, sendError } = ctx;
  const { economy, progress } = ctx.options;

  /** The memory of the project on the user's floor. `quiet` skips the error when there is nothing to show (the mailbox asks for it too). */
  const sendMemory = async (ws: WebSocket, quiet = false): Promise<void> => {
    const projectId = ctx.userProject();
    if (projectId === undefined) return quiet ? undefined : sendError(ws, "bad_message", "the Library is on a project's floor");
    if (!engine?.memory) return quiet ? undefined : sendError(ws, "engine_unavailable", "the Library needs the real engine");
    try {
      send(ws, { type: "memory", projectId, state: await engine.memory.state(projectId) });
    } catch (e) {
      if (!quiet) sendError(ws, "engine_unavailable", errorText(e, "cannot read the Library"));
    }
  };

  /** One change to the Library of the user's project, then its new state. A refusal is shown as `memory_error`. */
  const memoryAct = async (ws: WebSocket, act: MemoryAction): Promise<void> => {
    const projectId = ctx.userProject();
    if (projectId === undefined) return sendError(ws, "bad_message", "the Library is on a project's floor");
    const memory = engine?.memory;
    if (!memory) return sendError(ws, "engine_unavailable", "the Library needs the real engine");
    try {
      switch (act.action) {
        case "edit":
          await memory.edit(projectId, act.entryId, { ...(act.kind ? { kind: act.kind } : {}), ...(act.text === undefined ? {} : { text: act.text }) });
          break;
        case "delete":
          await memory.remove(projectId, act.entryId);
          break;
        case "accept": {
          // The proposal's job pays once, however many of its proposals are accepted. Read it before the engine moves it.
          let source: string | undefined;
          if (economy || progress) {
            try {
              source = (await memory.state(projectId)).proposals.find((p) => p.id === act.proposalId)?.sourceTaskId;
            } catch {
              source = undefined;
            }
          }
          await memory.accept(projectId, act.proposalId, { ...(act.kind ? { kind: act.kind } : {}), ...(act.text === undefined ? {} : { text: act.text }) });
          if (source) {
            deps.economy.grantEcto("memory_accepted", source, Date.now());
            await deps.progress.recordFact({ fact: { source: "memory_accepted", ref: source, ts: Date.now() }, roles: [] });
          }
          break;
        }
        case "dismiss":
          await memory.dismiss(projectId, act.proposalId);
          break;
        case "auto":
          await memory.setAutoRemember(projectId, act.autoRemember);
          break;
      }
    } catch (e) {
      sendError(ws, "memory_error", errorText(e, "the Library could not do that"));
    }
    await sendMemory(ws);
  };

  const handlers: Handlers = {
    memory_state: (_msg, { ws }) => void sendMemory(ws),
    memory_do: (msg, { ws }) => void memoryAct(ws, msg.act),
  };

  return { sendMemory, handlers };
}
export type LibraryFeature = ReturnType<typeof createLibrary>;
