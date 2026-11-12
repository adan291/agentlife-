import { z } from "zod";
import { BranchesResponseSchema, DeliveryInfoSchema, OkResponseSchema, ProjectSchema, RegisterProjectBodySchema, RegisterProjectResultSchema, kindWritesFiles, type DeliveryInfo } from "@agentlife/shared";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { JobRunner } from "../jobs/runner.ts";
import type { Logger } from "../log.ts";
import type { DataPaths } from "../paths.ts";
import { parseBody, sendJson, type Route } from "../http/server.ts";
import type { Store } from "../store.ts";
import { listBranches } from "./branches.ts";
import { deliverBranch } from "./deliver.ts";
import { ProjectUnavailableError, type ProjectRegistry } from "./registry.ts";

const MAX_ID_CHARS = 100;

export interface DeliverRouteDeps {
  registry: ProjectRegistry;
  paths: DataPaths;
  store: Store;
  logger?: Logger;
}

/**
 * Delivers the job's branch to the user's repository (see `deliverBranch`), then records `delivery.done`. Only a job
 * that has reached `report_ready` or `delivered` can be delivered, and not a branch review. The delivery route and the
 * night shift (when the user asked for a branch) both use this.
 */
export async function deliverJob(deps: DeliverRouteDeps, taskId: string): Promise<DeliveryInfo> {
  const job = taskId.length > MAX_ID_CHARS ? undefined : deps.store.getJob(taskId);
  if (!job) throw new NotFoundError("unknown task");
  const kind = job.kind ?? "change";
  if (!kindWritesFiles(kind)) {
    throw new ConflictError("not_deliverable", kind === "review-branch" ? "A branch review changes nothing, so there is nothing to deliver." : "This kind of job changes nothing, so there is nothing to deliver.");
  }
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
  return info;
}

/** `POST /tasks/:id/deliver`: see `deliverJob`. */
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
      sendJson(res, 200, DeliveryInfoSchema, await deliverJob(deps, taskId));
    },
  };
}

/**
 * `GET /projects/:id/branches`: the local branches of a project and the checked-out one, read with git by the engine
 * (requirement 2.2 of job-types). A project that moved or left its allowed folder answers 409 `project_unavailable`.
 */
export function createBranchesRoute(deps: { registry: ProjectRegistry; paths: DataPaths }): Route {
  return {
    method: "GET",
    pattern: /^\/projects\/([^/]+)\/branches$/,
    handle: async ({ res, params }) => {
      let id: string;
      try {
        id = decodeURIComponent(params[0] ?? "");
      } catch {
        throw new NotFoundError("bad id");
      }
      if (!id || id.length > MAX_ID_CHARS) throw new NotFoundError("unknown project");
      try {
        sendJson(res, 200, BranchesResponseSchema, await listBranches({ registry: deps.registry, paths: deps.paths, repoId: id }));
      } catch (e) {
        if (e instanceof ProjectUnavailableError) throw new ConflictError("project_unavailable", e.message);
        throw e;
      }
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
