import {
  CatalogueResponseSchema,
  HireBodySchema,
  OkResponseSchema,
  TeamMemberSchema,
  TeamModelsResponseSchema,
  TeamResponseSchema,
  UpdateMemberBodySchema,
} from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { parseBody, sendJson, type Route } from "../http/server.ts";
import type { Catalogue } from "./catalogue.ts";
import type { ModelDirectory } from "./models.ts";
import type { TeamService } from "./service.ts";

const MAX_ID_CHARS = 100;

/** `GET /catalogue`: the templates that can be hired, with role, tier, default model, source and whether they are built in or imported. */
export function createCatalogueRoute(catalogue: Catalogue): Route {
  return {
    method: "GET",
    pattern: /^\/catalogue$/,
    handle: ({ res }) => sendJson(res, 200, CatalogueResponseSchema, catalogue.entries()),
  };
}

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
 * The team of a project (hr-desk, requirement 2): read it, hire, rename or change the model, fire. The rules (last
 * architect or developer, a working agent, models of the role) live in `TeamService`; this only maps HTTP to it.
 */
export function createTeamRoutes(team: TeamService, models: ModelDirectory): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/projects\/([^/]+)\/team$/,
      handle: ({ res, params }) => sendJson(res, 200, TeamResponseSchema, team.view(idOf(params[0]))),
    },
    {
      method: "POST",
      pattern: /^\/projects\/([^/]+)\/team$/,
      handle: async ({ req, res, params }) => {
        const projectId = idOf(params[0]);
        const body = await parseBody(req, HireBodySchema);
        sendJson(res, 201, TeamMemberSchema, await team.hire(projectId, body));
      },
    },
    {
      method: "PATCH",
      pattern: /^\/projects\/([^/]+)\/team\/([^/]+)$/,
      handle: async ({ req, res, params }) => {
        const projectId = idOf(params[0]);
        const memberId = idOf(params[1]);
        const body = await parseBody(req, UpdateMemberBodySchema);
        sendJson(res, 200, TeamMemberSchema, await team.update(projectId, memberId, body));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/projects\/([^/]+)\/team\/([^/]+)$/,
      handle: async ({ res, params }) => {
        await team.fire(idOf(params[0]), idOf(params[1]));
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
    {
      method: "GET",
      pattern: /^\/team\/models$/,
      handle: async ({ res }) => sendJson(res, 200, TeamModelsResponseSchema, { models: await models.all() }),
    },
  ];
}
