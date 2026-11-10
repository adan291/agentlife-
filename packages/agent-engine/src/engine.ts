import type http from "node:http";
import { loadConfig, type EngineConfig } from "./config.ts";
import { installAgents, ROLES } from "./agents.ts";
import { dataPaths } from "./paths.ts";
import { createEngineServer, closeServer, listen, DEFAULT_HOST, DEFAULT_PORT, type Route } from "./http/server.ts";
import { createEventsRoute } from "./http/sse.ts";
import { createExportRoute } from "./http/export.ts";
import { createCrewRelay, createCrewRoute } from "./crew.ts";
import { JobRunner } from "./jobs/runner.ts";
import { createRuntimeSteps } from "./jobs/runtime-steps.ts";
import type { Steps } from "./jobs/steps.ts";
import { noopLogger, type Logger } from "./log.ts";
import { FakeRuntime } from "./runtimes/fake.ts";
import { LlmRuntime } from "./runtimes/llm.ts";
import type { AgentRuntime, Role } from "./runtimes/types.ts";
import { Store, type StoreOptions } from "./store.ts";

export interface EngineOptions {
  config?: EngineConfig;
  store?: Store;
  storeOptions?: StoreOptions;
  /** Runtime data directory (kiro-home, repos, worktrees). Default: `<project>/data`. */
  dataDir?: string;
  /** Overrides the steps (tests). Default: runtime-backed steps from config/agents.json. */
  steps?: Steps;
  logger?: Logger;
  host?: string;
  /** 0 picks an ephemeral port. */
  port?: number;
  token?: string | undefined;
  /** Delay inside FakeRuntime events, in ms. */
  fakeDelayMs?: number;
  ambient?: AgentRuntime;
  reportTimeoutMs?: number;
  extraRoutes?: Route[];
  /** SSE heartbeat interval in ms (default 15000). */
  heartbeatMs?: number;
}

export interface Engine {
  store: Store;
  runner: JobRunner;
  server: http.Server;
  config: EngineConfig;
  host: string;
  port: number;
  close(): Promise<void>;
}

function buildRuntimes(config: EngineConfig, fakeDelayMs: number): Record<Role, AgentRuntime> {
  const out = {} as Record<Role, AgentRuntime>;
  const forceFake = process.env["RUNTIME"] === "fake";
  for (const role of ["architect", "developer", "qa"] as const) {
    const kind = config.agents[role].runtime;
    if (forceFake || kind === "fake") out[role] = new FakeRuntime({ delayMs: fakeDelayMs });
    else throw new Error(`config: runtime '${kind}' for ${role} is not available yet (agent-pipeline spec); use "fake"`);
  }
  return out;
}

/** Wires store, runner and HTTP server, recovers old jobs, and starts listening. */
export async function startEngine(opts: EngineOptions = {}): Promise<Engine> {
  const config = opts.config ?? loadConfig();
  const logger = opts.logger ?? noopLogger;
  const store = opts.store ?? new Store(opts.storeOptions);
  if (!opts.steps && process.env["RUNTIME"] !== "fake" && ROLES.some((r) => config.agents[r].runtime === "kiro-cli")) {
    const installed = installAgents({ kiroHome: dataPaths(opts.dataDir).kiroHome });
    logger.info("role agents installed", { dir: installed.dir, agents: installed.installed });
  }
  const steps = opts.steps ?? createRuntimeSteps({ runtimes: buildRuntimes(config, opts.fakeDelayMs ?? 0), store, logger });
  const ambient =
    opts.ambient ??
    (config.agents.ambient.runtime === "llm"
      ? new LlmRuntime({ onError: (m) => logger.warn(m) })
      : undefined);
  const runner = new JobRunner({
    store,
    steps,
    limits: config.limits,
    logger,
    ...(ambient ? { ambient } : {}),
    ...(opts.reportTimeoutMs ? { reportTimeoutMs: opts.reportTimeoutMs } : {}),
  });
  runner.recover();
  const server = createEngineServer({
    store,
    runner,
    config,
    logger,
    token: opts.token,
    extraRoutes: [
      createEventsRoute(store, opts.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }),
      createExportRoute(store),
      createCrewRoute(createCrewRelay({ append: (ev) => store.appendEvent(ev) })),
      ...(opts.extraRoutes ?? []),
    ],
  });
  const host = opts.host ?? DEFAULT_HOST;
  const port = await listen(server, host, opts.port ?? DEFAULT_PORT);
  logger.info("engine listening", { host, port });
  return {
    store,
    runner,
    server,
    config,
    host,
    port,
    close: async () => {
      await closeServer(server);
      store.close();
    },
  };
}
