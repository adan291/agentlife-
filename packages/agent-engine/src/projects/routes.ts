import { z } from "zod";
import { OkResponseSchema, ProjectSchema, RegisterProjectBodySchema, RegisterProjectResultSchema } from "@agentlife/shared";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { JobRunner } from "../jobs/runner.ts";
import { parseBody, sendJson, type Route } from "../http/server.ts";
import type { Store } from "../store.ts";
import type { ProjectRegistry } from "./registry.ts";

const MAX_ID_CHARS = 100;

/**
 * `GET/POST /projects` and `DELETE /projects/:id`. Responses carry id, name, stack and test command; the path of a
 * project never leaves the registry (requirement 2).
 */
export function createProjectRoutes(registry: ProjectRegistry, runner: JobRunner, store: Store): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/projects$/,
      handle: ({ res }) => sendJson(res, 200, z.array(ProjectSchema), registry.list()),
    },
    {
      method: "POST",
      pattern: /^\/projects$/,
      handle: async ({ req, res }) => {
        const body = await parseBody(req, RegisterProjectBodySchema);
        const result = await registry.register(body);
        sendJson(res, result.status === "ok" ? 201 : result.status === "error" ? 400 : 200, RegisterProjectResultSchema, result);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/projects\/([^/]+)$/,
      handle: ({ res, params }) => {
        let id: string;
        try {
          id = decodeURIComponent(params[0] ?? "");
        } catch {
          throw new NotFoundError("bad id");
        }
        if (id.length > MAX_ID_CHARS) throw new NotFoundError("unknown project");
        const active = runner.activeJobId();
        if (active && store.getJob(active)?.repoId === id) {
          throw new ConflictError("project_busy", "A job is running on this project. Wait for it to finish.");
        }
        registry.remove(id);
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
  ];
}
