import {
  CatalogueResponseSchema,
  CatalogueSourcesResponseSchema,
  HireBodySchema,
  ImportApproveBodySchema,
  ImportBodySchema,
  ImportListResponseSchema,
  ImportViewSchema,
  OkResponseSchema,
  TeamMemberSchema,
  TeamModelsResponseSchema,
  TeamResponseSchema,
  UpdateMemberBodySchema,
} from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { parseBody, sendJson, type Route } from "../http/server.ts";
import type { Catalogue } from "./catalogue.ts";
import type { ImportService } from "./imports.ts";
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
 * Trusted imports (hr-desk requirement 3). `GET /catalogue/sources` lists the addresses imports may come from;
 * `POST /catalogue/imports` fetches one of them; `approve` carries the hash of the content the user read.
 */
export function createImportRoutes(imports: ImportService): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/catalogue\/sources$/,
      handle: ({ res }) => sendJson(res, 200, CatalogueSourcesResponseSchema, { sources: imports.sources() }),
    },
    {
      method: "GET",
      pattern: /^\/catalogue\/imports$/,
      handle: ({ res }) => sendJson(res, 200, ImportListResponseSchema, imports.list()),
    },
    {
      method: "POST",
      pattern: /^\/catalogue\/imports$/,
      handle: async ({ req, res }) => {
        const body = await parseBody(req, ImportBodySchema);
        sendJson(res, 201, ImportViewSchema, await imports.importFrom(body.url));
      },
    },
    {
      method: "POST",
      pattern: /^\/catalogue\/imports\/([^/]+)\/approve$/,
      handle: async ({ req, res, params }) => {
        const body = await parseBody(req, ImportApproveBodySchema);
        sendJson(res, 200, ImportViewSchema, imports.approve(idOf(params[0]), body.hash));
      },
    },
    {
      method: "POST",
      pattern: /^\/catalogue\/imports\/([^/]+)\/reject$/,
      handle: ({ res, params }) => {
        imports.reject(idOf(params[0]));
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
  ];
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
