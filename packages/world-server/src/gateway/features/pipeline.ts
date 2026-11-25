// The pipeline of a project (pipeline-editor).
import type { WebSocket } from "ws";
import type { PipelineStep } from "@agentlife/shared";
import { errorText } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";

export function createPipeline(ctx: GatewayContext) {
  const { engine, send, sendError } = ctx;

  /** The pipeline of the project on the user's floor, with the team the rules check it against. */
  const sendPipeline = async (ws: WebSocket, quiet = false): Promise<void> => {
    const projectId = ctx.userProject();
    if (projectId === undefined) return quiet ? undefined : sendError(ws, "bad_message", "the pipeline belongs to a project's floor");
    if (!engine?.pipeline) return sendError(ws, "pipeline_error", "The pipeline editor needs the real engine.");
    try {
      send(ws, { type: "pipeline", state: await engine.pipeline.state(projectId) });
    } catch (e) {
      sendError(ws, "pipeline_error", errorText(e, "cannot read the pipeline of the project"));
    }
  };

  /** Saves or resets the pipeline of the user's project, then sends it. A refusal names the rule that broke. */
  const pipelineAct = async (ws: WebSocket, act: { save: readonly PipelineStep[] } | { reset: true }): Promise<void> => {
    const projectId = ctx.userProject();
    if (projectId === undefined) return sendError(ws, "bad_message", "the pipeline belongs to a project's floor");
    const pipeline = engine?.pipeline;
    if (!pipeline) return sendError(ws, "pipeline_error", "The pipeline editor needs the real engine.");
    try {
      const state = "save" in act ? await pipeline.save(projectId, act.save) : await pipeline.reset(projectId);
      send(ws, { type: "pipeline", state });
    } catch (e) {
      sendError(ws, "pipeline_error", errorText(e, "the pipeline could not be saved"));
      await sendPipeline(ws, true);
    }
  };

  const handlers: Handlers = {
    pipeline_state: (_msg, { ws }) => void sendPipeline(ws),
    pipeline_save: (msg, { ws }) => void pipelineAct(ws, { save: msg.steps }),
    pipeline_reset: (_msg, { ws }) => void pipelineAct(ws, { reset: true }),
  };

  return { sendPipeline, handlers };
}
export type PipelineFeature = ReturnType<typeof createPipeline>;
