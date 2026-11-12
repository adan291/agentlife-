import { MorningSummariesSchema, NightJobInputSchema, NightJobSchema, NightMoveBodySchema, NightStateSchema, OkResponseSchema, type NightConfig } from "@agentlife/shared";
import { BadRequestError, parseBody, sendJson, type Route } from "../http/server.ts";
import { NotFoundError } from "../errors.ts";
import type { NightStore } from "./store.ts";
import type { SummaryStore } from "./summary-store.ts";
import { windowAt } from "./window.ts";

const MAX_ID_CHARS = 100;

function idOf(raw: string | undefined): string {
  if (!raw) throw new NotFoundError("unknown night job");
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new NotFoundError("unknown night job");
  }
  if (id.length > MAX_ID_CHARS) throw new NotFoundError("unknown night job");
  return id;
}

export interface NightRouteDeps {
  store: NightStore;
  config: NightConfig;
  /** The morning summaries. Without it `GET /night/summaries` answers an empty list. */
  summaries?: SummaryStore;
  hasProject(repoId: string): boolean;
  now?: () => number;
}

/**
 * `GET /night`, `POST /night/jobs`, `DELETE /night/jobs/:id` and `POST /night/jobs/:id/move` (requirement 1.1), and
 * `GET /night/summaries` (requirement 4.1). The window and the limits come from `config/night.json` and are shown, not
 * edited, here.
 */
export function createNightRoutes(deps: NightRouteDeps): Route[] {
  const now = deps.now ?? Date.now;
  return [
    {
      method: "GET",
      pattern: /^\/night\/summaries$/,
      handle: ({ res }) => {
        sendJson(res, 200, MorningSummariesSchema, { summaries: deps.summaries?.all() ?? [] });
      },
    },
    {
      method: "GET",
      pattern: /^\/night$/,
      handle: ({ res }) => {
        const night = deps.store.night();
        sendJson(res, 200, NightStateSchema, {
          config: deps.config,
          open: windowAt(now(), deps.config) !== undefined,
          ...(night ? { night } : {}),
          jobs: [...deps.store.jobs()],
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/night\/jobs$/,
      handle: async ({ req, res }) => {
        const body = await parseBody(req, NightJobInputSchema);
        if (!deps.hasProject(body.repoId)) {
          throw new BadRequestError("unknown_repo", "repository is not allowlisted", [{ path: "repoId", message: "not in the allowlist" }]);
        }
        sendJson(res, 201, NightJobSchema, deps.store.add(body));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/night\/jobs\/([^/]+)$/,
      handle: ({ res, params }) => {
        deps.store.remove(idOf(params[0]));
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/night\/jobs\/([^/]+)\/move$/,
      handle: async ({ req, res, params }) => {
        const body = await parseBody(req, NightMoveBodySchema);
        deps.store.move(idOf(params[0]), body.direction);
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
  ];
}
