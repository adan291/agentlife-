import { PipelineResponseSchema, SavePipelineBodySchema } from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { parseBody, sendJson, type Route } from "../http/server.ts";
import type { PipelineService } from "./service.ts";

const MAX_ID_CHARS = 100;

function idOf(raw: string | undefined): string {
  let id: string;
  try {
    id = decodeURIComponent(raw ?? "");
  } catch {
    throw new NotFoundError("bad id");
  }
  if (!id || id.length > MAX_ID_CHARS) throw new NotFoundError("unknown id");
  return id;
}

/**
 * The pipeline of a project (pipeline-editor, requirements 1 and 2): read it with the team it is checked against, save a
 * new one (the fixed rules decide), or go back to the default. The rules live in `@agentlife/shared`.
 */
export function createPipelineRoutes(service: PipelineService): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/projects\/([^/]+)\/pipeline$/,
      handle: ({ res, params }) => sendJson(res, 200, PipelineResponseSchema, service.view(idOf(params[0]))),
    },
    {
      method: "PUT",
      pattern: /^\/projects\/([^/]+)\/pipeline$/,
      handle: async ({ req, res, params }) => {
        const projectId = idOf(params[0]);
        const body = await parseBody(req, SavePipelineBodySchema);
        sendJson(res, 200, PipelineResponseSchema, service.save(projectId, body.steps));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/projects\/([^/]+)\/pipeline$/,
      handle: ({ res, params }) => sendJson(res, 200, PipelineResponseSchema, service.reset(idOf(params[0]))),
    },
  ];
}
