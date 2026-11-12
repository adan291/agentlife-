import {
  MemoryAcceptBodySchema,
  MemoryEntrySchema,
  MemorySettingsBodySchema,
  MemoryStateSchema,
  MemoryUpdateBodySchema,
  OkResponseSchema,
  type MemoryState,
} from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { BadRequestError, parseBody, sendJson, type Route } from "../http/server.ts";
import type { MemoryLearner } from "./learn.ts";
import { MemoryRejectedError } from "./safety.ts";
import type { MemoryStore } from "./store.ts";

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

/** A refused text is the user's mistake (400), with a message that never repeats the text. */
function refused<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MemoryRejectedError) throw new BadRequestError(`memory_${e.code}`, e.message, [{ path: "text", message: e.message }]);
    throw e;
  }
}

export interface MemoryRouteDeps {
  store: MemoryStore;
  /** Without it no job is ever "being learned". */
  learner?: MemoryLearner;
  hasProject(projectId: string): boolean;
}

/** What the Library holds for a project, and what jobs suggested. */
export function memoryState(deps: MemoryRouteDeps, projectId: string): MemoryState {
  return {
    entries: deps.store.list(projectId),
    proposals: deps.store.proposals(projectId),
    autoRemember: deps.store.autoRemember(projectId),
    learning: deps.learner?.learningOf(projectId) ?? [],
  };
}

/**
 * The Library over HTTP (project-memory requirements 2.2 and 4.1): read it, edit and delete entries, accept or dismiss
 * the proposals of finished jobs, and switch auto-remember. Every text goes through the store's checks.
 */
export function createMemoryRoutes(deps: MemoryRouteDeps): Route[] {
  const project = (raw: string | undefined): string => {
    const id = idOf(raw);
    if (!deps.hasProject(id)) throw new NotFoundError("unknown project");
    return id;
  };
  return [
    {
      method: "GET",
      pattern: /^\/projects\/([^/]+)\/memory$/,
      handle: ({ res, params }) => sendJson(res, 200, MemoryStateSchema, memoryState(deps, project(params[0]))),
    },
    {
      method: "PUT",
      pattern: /^\/projects\/([^/]+)\/memory\/settings$/,
      handle: async ({ req, res, params }) => {
        const projectId = project(params[0]);
        const body = await parseBody(req, MemorySettingsBodySchema);
        deps.store.setAutoRemember(projectId, body.autoRemember);
        sendJson(res, 200, MemoryStateSchema, memoryState(deps, projectId));
      },
    },
    {
      method: "POST",
      pattern: /^\/projects\/([^/]+)\/memory\/proposals\/([^/]+)\/accept$/,
      handle: async ({ req, res, params }) => {
        const projectId = project(params[0]);
        const body = await parseBody(req, MemoryAcceptBodySchema);
        const edit = { ...(body.kind ? { kind: body.kind } : {}), ...(body.text !== undefined ? { text: body.text } : {}) };
        sendJson(res, 201, MemoryEntrySchema, refused(() => deps.store.accept(projectId, idOf(params[1]), edit)));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/projects\/([^/]+)\/memory\/proposals\/([^/]+)$/,
      handle: ({ res, params }) => {
        deps.store.dismiss(project(params[0]), idOf(params[1]));
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
    {
      method: "PATCH",
      pattern: /^\/projects\/([^/]+)\/memory\/([^/]+)$/,
      handle: async ({ req, res, params }) => {
        const projectId = project(params[0]);
        const body = await parseBody(req, MemoryUpdateBodySchema);
        const patch = { ...(body.kind ? { kind: body.kind } : {}), ...(body.text !== undefined ? { text: body.text } : {}) };
        sendJson(res, 200, MemoryEntrySchema, refused(() => deps.store.update(projectId, idOf(params[1]), patch)));
      },
    },
    {
      method: "DELETE",
      pattern: /^\/projects\/([^/]+)\/memory\/([^/]+)$/,
      handle: ({ res, params }) => {
        deps.store.remove(project(params[0]), idOf(params[1]));
        sendJson(res, 200, OkResponseSchema, { ok: true });
      },
    },
  ];
}
