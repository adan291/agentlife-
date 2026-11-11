import { z } from "zod";
import { DeliveryInfoSchema, OkResponseSchema, ProjectSchema, RegisterProjectBodySchema, RegisterProjectResultSchema } from "@agentlife/shared";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { JobRunner } from "../jobs/runner.ts";
import type { Logger } from "../log.ts";
import type { DataPaths } from "../paths.ts";
import { parseBody, sendJson, type Route } from "../http/server.ts";
import type { Store } from "../store.ts";
import { deliverBranch } from "./deliver.ts";
import type { ProjectRegistry } from "./registry.ts";

const MAX_ID_CHARS = 100;

export interface DeliverRouteDeps {
  registry: ProjectRegistry;
  paths: DataPaths;
  store: Store;
  logger?: Logger;
}

/**
 * `POST /tasks/:id/deliver`: fetches the job's branch into the user's repository (see `deliverBranch`), then records
 * `delivery.done`. Only a job that has reached `report_ready` or `delivered` can be delivered.
 */
export function createDeliverRoute(deps: DeliverRouteDeps): Route {
  return {
    method: "POST",
    pattern: /^\/tasks\/([^/]+)\/deliver$/,
    handle: async ({ res, params }) => {
      let taskId: string;
      try {
        taskId = decodeURIComponent(params[0] ?? "");
      } catch {
        throw new NotFoundError("bad id");
      }
      const job = taskId.length > MAX_ID_CHARS ? undefined : deps.store.getJob(taskId);
      if (!job) throw new NotFoundError("unknown task");
      if (job.state !== "report_ready" && job.state !== "delivered") {
        throw new ConflictError("job_not_finished", `The job is ${job.state}; wait for its report.`);
      }
      const info = await deliverBranch({
        registry: deps.registry,
        paths: deps.paths,
        taskId,
        repoId: job.repoId,
        alreadyDelivered: job.delivery,
        ...(deps.logger ? { logger: deps.logger } : {}),
      });
      deps.store.appendEvent({ type: "delivery.done", taskId, branch: info.branch, commit: info.commit });
      sendJson(res, 200, DeliveryInfoSchema, info);
    },
  };
}

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
        if (!id) throw new NotFoundError("unknown project");
        if (runner.activeJobOn(id)) {
          throw new ConflictError("project_busy", "A job is running on this project. Wait for it to finish.");
        }
        registry.remove(id);
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
  ];
}
