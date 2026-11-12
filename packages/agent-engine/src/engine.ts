import type http from "node:http";
import path from "node:path";
import { createActivityEmitter } from "./activity.ts";
import { loadConfig, type EngineConfig } from "./config.ts";
import { installAgents, ROLES } from "./agents.ts";
import { dataPaths, PROJECT_ROOT } from "./paths.ts";
import { createEngineServer, closeServer, listen, DEFAULT_HOST, DEFAULT_PORT, type Route } from "./http/server.ts";
import { createEventsRoute } from "./http/sse.ts";
import { createExportRoute } from "./http/export.ts";
import { createCrewRelay, createCrewRoute } from "./crew.ts";
import { createBuildBoardRoutes } from "./build-board.ts";
import { JobRunner } from "./jobs/runner.ts";
import { createRuntimeSteps } from "./jobs/runtime-steps.ts";
import type { Steps } from "./jobs/steps.ts";
import { noopLogger, type Logger } from "./log.ts";
import { ProjectRegistry } from "./projects/registry.ts";
import { createBranchesRoute, createDeliverRoute, createProjectRoutes, deliverJob } from "./projects/routes.ts";
import { listBranches } from "./projects/branches.ts";
import { allowedRoots } from "./projects/roots.ts";
import { loadNightConfig } from "./night/config.ts";
import { createNightRoutes } from "./night/routes.ts";
import { NightScheduler } from "./night/scheduler.ts";
import { NightStore } from "./night/store.ts";
import { createDiscordNotifier, createMorningReporter, type NightNotifier } from "./night/morning.ts";
import { SummaryStore } from "./night/summary-store.ts";
import { isTerminal } from "./jobs/transitions.ts";
import type { NightConfig } from "@agentlife/shared";
import { FakeRuntime } from "./runtimes/fake.ts";
import { KiroCliRuntime } from "./runtimes/kiro-cli.ts";
import { createPipelineSteps } from "./steps/index.ts";
import { LlmRuntime } from "./runtimes/llm.ts";
import type { AgentRuntime, Role } from "./runtimes/types.ts";
import { Store, type StoreOptions } from "./store.ts";
import { Catalogue } from "./team/catalogue.ts";
import { createCatalogueRoute } from "./team/routes.ts";

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
  /** Allowed project roots. Default: `AGENTLIFE_PROJECT_ROOTS` or config/hotel.json. */
  projectRoots?: string[];
  /** Where registered projects are stored. Default: `AGENTLIFE_PROJECTS_FILE` or `<dataDir>/projects.json`. */
  projectsFile?: string;
  /** A ready registry (tests that build their own pipeline steps share it with the engine). */
  projects?: ProjectRegistry;
  /** The templates that can be hired. Default: `config/catalogue`. */
  catalogue?: Catalogue;
  /**
   * Night shift. The routes and the schedule file are always there; the scheduler that starts night jobs runs only when
   * `run` is true (the real process), so tests never start a job because of a schedule that sits in `data/night.json`.
   */
  night?: {
    config?: NightConfig;
    /** Default: `AGENTLIFE_NIGHT_FILE` or `<dataDir>/night.json`. */
    file?: string;
    /** Default: `AGENTLIFE_NIGHT_SUMMARIES_FILE` or `<dataDir>/night-summaries.json`. */
    summariesFile?: string;
    /** Sends the facts of the morning summary to Discord. Default (real process only): `scripts/notify.ts --overview`. Used only when `discord` is on in `config/night.json`. */
    notify?: NightNotifier;
    run?: boolean;
    tickMs?: number;
    now?: () => number;
  };
}

export interface Engine {
  store: Store;
  runner: JobRunner;
  projects: ProjectRegistry;
  night: { store: NightStore; scheduler: NightScheduler; summaries: SummaryStore };
  server: http.Server;
  config: EngineConfig;
  host: string;
  port: number;
  close(): Promise<void>;
}

/** RUNTIME=fake overrides config/agents.json: every role runs on FakeRuntime (tests, CI, demos without a key). */
function forceFake(): boolean {
  return process.env["RUNTIME"] === "fake";
}

/** True when at least one role runs on kiro-cli, so the real pipeline steps are used. */
function usesRealPipeline(config: EngineConfig): boolean {
  return !forceFake() && ROLES.some((r) => config.agents[r].runtime === "kiro-cli");
}

/** Model label per role as shown to users: "fake" under RUNTIME=fake, else the configured model (if any). */
export function roleModels(config: EngineConfig): Partial<Record<Role, string>> {
  const out: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const label = forceFake() ? "fake" : config.agents[role].model;
    if (label) out[role] = label;
  }
  return out;
}

export function buildRuntimes(config: EngineConfig, fakeDelayMs: number, kiroHome: string): Record<Role, AgentRuntime> {
  const out = {} as Record<Role, AgentRuntime>;
  const models: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const model = config.agents[role].model;
    if (model) models[role] = model;
  }
  const kiro = new KiroCliRuntime({ kiroHome, models });
  for (const role of ROLES) {
    out[role] = !forceFake() && config.agents[role].runtime === "kiro-cli" ? kiro : new FakeRuntime({ delayMs: fakeDelayMs });
  }
  return out;
}

/** Wires store, runner and HTTP server, recovers old jobs, and starts listening. */
export async function startEngine(opts: EngineOptions = {}): Promise<Engine> {
  const config = opts.config ?? loadConfig();
  const logger = opts.logger ?? noopLogger;
  const paths = dataPaths(opts.dataDir);
  // With a custom dataDir the run logs (store) and the raw logs (steps) must land in the same place.
  const store =
    opts.store ?? new Store({ ...(opts.dataDir ? { runsDir: paths.runs } : {}), ...opts.storeOptions });
  let steps = opts.steps;
  const projects =
    opts.projects ??
    new ProjectRegistry({
      file: opts.projectsFile ?? process.env["AGENTLIFE_PROJECTS_FILE"] ?? path.join(paths.root, "projects.json"),
      roots: opts.projectRoots ?? allowedRoots(),
      builtin: config.repos,
      reposDir: paths.repos,
      agentlifeRoot: PROJECT_ROOT,
    });
  const activity = createActivityEmitter({ append: (ev) => store.appendEvent(ev) });
  if (!steps) {
    const real = usesRealPipeline(config);
    if (real) {
      const installed = installAgents({ kiroHome: paths.kiroHome });
      logger.info("role agents installed", { dir: installed.dir, agents: installed.installed });
    }
    const runtimes = buildRuntimes(config, opts.fakeDelayMs ?? 0, paths.kiroHome);
    const models = roleModels(config);
    steps = real
      ? createPipelineSteps({ runtimes, store, paths, repos: config.repos, projects, limits: config.limits, logger, activity, models })
      : createRuntimeSteps({ runtimes, store, logger, activity, models });
  }
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
    activity,
    ...(ambient ? { ambient } : {}),
    ...(opts.reportTimeoutMs ? { reportTimeoutMs: opts.reportTimeoutMs } : {}),
  });
  runner.recover();
  const crewRelay = createCrewRelay({ append: (ev) => store.appendEvent(ev) });
  const deliverDeps = { registry: projects, paths, store, logger };
  const catalogue = opts.catalogue ?? new Catalogue();
  const nightConfig = opts.night?.config ?? loadNightConfig();
  const nightStore = new NightStore({
    file: opts.night?.file ?? process.env["AGENTLIFE_NIGHT_FILE"] ?? path.join(paths.root, "night.json"),
    logger,
    ...(opts.night?.now ? { now: opts.night.now } : {}),
  });
  const nightSummaries = new SummaryStore({
    file: opts.night?.summariesFile ?? process.env["AGENTLIFE_NIGHT_SUMMARIES_FILE"] ?? path.join(paths.root, "night-summaries.json"),
    logger,
    ...(opts.night?.now ? { now: opts.night.now } : {}),
  });
  const nightScheduler = new NightScheduler({
    store: nightStore,
    config: nightConfig,
    logger,
    ...(opts.night?.now ? { now: opts.night.now } : {}),
    onClose: createMorningReporter({
      summaries: nightSummaries,
      discord: nightConfig.discord === true,
      // A test passes its own notifier; the real process runs `scripts/notify.ts`.
      notify:
        opts.night?.notify ??
        (opts.night?.run ? createDiscordNotifier({ root: PROJECT_ROOT, scriptPath: path.join(PROJECT_ROOT, "scripts", "notify.ts") }) : undefined),
      logger,
      ...(opts.night?.now ? { now: opts.night.now } : {}),
    }),
    port: {
      hasProject: (id) => projects.has(id),
      start: (repoId, goal, startOpts) => runner.start(repoId, goal, startOpts),
      cancel: (taskId) => runner.cancel(taskId),
      job: (taskId) => store.getJob(taskId),
      openJobs: () => store.listJobs().filter((j) => !isTerminal(j.state)),
      deliver: (taskId) => deliverJob(deliverDeps, taskId),
    },
  });
  if (opts.night?.run) nightScheduler.start(opts.night.tickMs);
  const server = createEngineServer({
    store,
    runner,
    config,
    logger,
    token: opts.token,
    projects,
    branches: async (repoId) => (await listBranches({ registry: projects, paths, repoId })).branches,
    extraRoutes: [
      createEventsRoute(store, opts.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }),
      createExportRoute(store, { isRegisteredProject: (id) => projects.get(id)?.builtin === false }),
      createCrewRoute(crewRelay),
      ...createBuildBoardRoutes({ root: PROJECT_ROOT, phase: () => crewRelay.phase() }),
      ...createProjectRoutes(projects, runner, store),
      createDeliverRoute(deliverDeps),
      createBranchesRoute({ registry: projects, paths }),
      createCatalogueRoute(catalogue),
      ...createNightRoutes({ store: nightStore, config: nightConfig, summaries: nightSummaries, hasProject: (id) => projects.has(id), ...(opts.night?.now ? { now: opts.night.now } : {}) }),
      ...(opts.extraRoutes ?? []),
    ],
  });
  const host = opts.host ?? DEFAULT_HOST;
  const port = await listen(server, host, opts.port ?? DEFAULT_PORT);
  logger.info("engine listening", { host, port });
  return {
    store,
    runner,
    projects,
    night: { store: nightStore, scheduler: nightScheduler, summaries: nightSummaries },
    server,
    config,
    host,
    port,
    close: async () => {
      nightScheduler.stop();
      await closeServer(server);
      store.close();
    },
  };
}
