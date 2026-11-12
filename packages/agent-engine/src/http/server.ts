import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import {
  ApprovalBodySchema,
  EngineJobViewSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  OkResponseSchema,
  PROTOCOL_VERSION,
  RepoSchema,
  RolesConfigResponseSchema,
  StartJobBodySchema,
  StartJobResponseSchema,
} from "@agentlife/shared";
import type { EngineConfig } from "../config.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import type { JobRunner } from "../jobs/runner.ts";
import { noopLogger, type Logger } from "../log.ts";
import { repoView, type ProjectRegistry } from "../projects/registry.ts";
import type { Store } from "../store.ts";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8788;
export const TOKEN_HEADER = "x-agentlife-token";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_ID_CHARS = 100;

export interface EngineServerDeps {
  store: Store;
  runner: JobRunner;
  config: EngineConfig;
  logger?: Logger;
  /** When set, every request must carry this value in `x-agentlife-token`. */
  token?: string | undefined;
  /** Extra routes (SSE, export) registered by later modules. */
  extraRoutes?: Route[];
  /** Registered projects. Without it only the repos of config/repos.json exist. */
  projects?: ProjectRegistry;
  /** Local branches of a project, for `review-branch` jobs. Without it that kind is refused. */
  branches?: (repoId: string) => Promise<string[]>;
}

export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: string[];
}
export type Route = { method: string; pattern: RegExp; handle: (ctx: RouteContext) => Promise<void> | void };

export class BadRequestError extends Error {
  readonly code: string;
  readonly issues: { path: string; message: string }[] | undefined;
  constructor(code: string, message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.name = "BadRequestError";
    this.code = code;
    this.issues = issues;
  }
}

class UnauthorizedError extends Error {
  constructor() {
    super("missing or wrong token");
    this.name = "UnauthorizedError";
  }
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

export function sendJson<S extends z.ZodType>(res: http.ServerResponse, status: number, schema: S, body: z.input<S>): void {
  const data = JSON.stringify(schema.parse(body));
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(data);
}

function issuesOf(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new BadRequestError("body_too_large", "request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text.length ? JSON.parse(text) : {};
  } catch {
    throw new BadRequestError("invalid_json", "body is not valid JSON");
  }
}

export async function parseBody<S extends z.ZodType>(req: http.IncomingMessage, schema: S): Promise<z.output<S>> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new BadRequestError("invalid_body", "invalid request body", issuesOf(parsed.error));
  return parsed.data;
}

function checkId(raw: string | undefined): string {
  if (!raw) throw new NotFoundError("missing id");
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new NotFoundError("bad id");
  }
  if (id.length > MAX_ID_CHARS) throw new NotFoundError("unknown id");
  return id;
}

export function createEngineServer(deps: EngineServerDeps): http.Server {
  const { store, runner, config } = deps;
  const log = deps.logger ?? noopLogger;
  const expected = deps.token ? digest(deps.token) : undefined;

  const routes: Route[] = [
    {
      method: "GET",
      pattern: /^\/health$/,
      handle: ({ res }) =>
        sendJson(res, 200, HealthResponseSchema, { ok: true, protocol: PROTOCOL_VERSION, lastSeq: store.lastSeq() }),
    },
    {
      method: "GET",
      pattern: /^\/repos$/,
      handle: ({ res }) =>
        sendJson(
          res,
          200,
          z.array(RepoSchema),
          deps.projects ? deps.projects.list().map(repoView) : config.repos.map((r) => ({ id: r.id, name: r.name })),
        ),
    },
    {
      method: "GET",
      pattern: /^\/config\/roles$/,
      handle: ({ res }) => {
        // RUNTIME=fake overrides the config for every role (see engine.ts), so say so.
        const fake = process.env["RUNTIME"] === "fake";
        const view = (r: { runtime: string; model?: string | undefined }) =>
          fake ? { runtime: "fake", model: "fake" } : { runtime: r.runtime, ...(r.model ? { model: r.model } : {}) };
        sendJson(res, 200, RolesConfigResponseSchema, {
          architect: view(config.agents.architect),
          developer: view(config.agents.developer),
          qa: view(config.agents.qa),
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/tasks$/,
      handle: async ({ req, res }) => {
        const body = await parseBody(req, StartJobBodySchema);
        const known = deps.projects ? deps.projects.has(body.repoId) : config.repos.some((r) => r.id === body.repoId);
        if (!known) {
          throw new BadRequestError("unknown_repo", "repository is not allowlisted", [
            { path: "repoId", message: "not in the allowlist" },
          ]);
        }
        if (body.kind === "review-branch" && body.target) {
          // Requirement 2.2: a branch is chosen from the project's local branches, never typed free.
          const names = await deps.branches?.(body.repoId).catch(() => undefined);
          if (!names || !names.includes(body.target)) {
            throw new BadRequestError("unknown_branch", "that is not a local branch of the project", [
              { path: "target", message: "not a branch of this project" },
            ]);
          }
        }
        const taskId = runner.start(body.repoId, body.goal, {
          kind: body.kind,
          ...(body.target ? { target: body.target } : {}),
        });
        sendJson(res, 201, StartJobResponseSchema, { taskId });
      },
    },
    {
      method: "GET",
      pattern: /^\/tasks\/([^/]+)$/,
      handle: ({ res, params }) => {
        const job = store.getJob(checkId(params[0]));
        if (!job) throw new NotFoundError("unknown task");
        sendJson(res, 200, EngineJobViewSchema, job);
      },
    },
    {
      method: "POST",
      pattern: /^\/approvals\/([^/]+)$/,
      handle: async ({ req, res, params }) => {
        const approvalId = checkId(params[0]);
        const body = await parseBody(req, ApprovalBodySchema);
        runner.resolveApproval(approvalId, body.decision);
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
    {
      method: "POST",
      pattern: /^\/tasks\/([^/]+)\/cancel$/,
      handle: async ({ res, params }) => {
        await runner.cancel(checkId(params[0]));
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
    ...(deps.extraRoutes ?? []),
  ];

  function fail(res: http.ServerResponse, status: number, body: z.input<typeof ErrorResponseSchema>): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, status, ErrorResponseSchema, body);
  }

  return http.createServer((req, res) => {
    void (async () => {
      try {
        if (expected) {
          const given = req.headers[TOKEN_HEADER];
          const value = Array.isArray(given) ? given[0] : given;
          if (typeof value !== "string" || !timingSafeEqual(digest(value), expected)) throw new UnauthorizedError();
        }
        const url = new URL(req.url ?? "/", "http://engine.local");
        const method = req.method ?? "GET";
        let pathMatched = false;
        for (const route of routes) {
          const m = route.pattern.exec(url.pathname);
          if (!m) continue;
          pathMatched = true;
          if (route.method !== method) continue;
          await route.handle({ req, res, url, params: m.slice(1) });
          return;
        }
        if (pathMatched) return fail(res, 405, { error: "method_not_allowed" });
        fail(res, 404, { error: "not_found" });
      } catch (e) {
        if (e instanceof UnauthorizedError) return fail(res, 401, { error: "unauthorized" });
        if (e instanceof BadRequestError) {
          return fail(res, 400, { error: e.code, message: e.message, ...(e.issues ? { issues: e.issues } : {}) });
        }
        if (e instanceof NotFoundError) return fail(res, 404, { error: "not_found", message: e.message });
        if (e instanceof ConflictError) return fail(res, 409, { error: e.code, message: e.message });
        log.error("request failed", { method: req.method ?? "", url: (req.url ?? "").slice(0, 200), error: e instanceof Error ? e.message : String(e) });
        fail(res, 500, { error: "internal" });
      }
    })();
  });
}

/** Listens and resolves with the bound port (use port 0 for an ephemeral one). */
export function listen(server: http.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

export function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}
