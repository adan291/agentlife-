import { startEngine } from "./engine.ts";
import { collectSecrets, createJsonLogger, createRedactor } from "./log.ts";
import { allowedRoots, ensureRoots } from "./projects/roots.ts";

// Secrets from the environment never reach logs, events, artifacts, run logs or exports.
const redact = createRedactor(collectSecrets());
const logger = createJsonLogger({ redact });

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

try {
  const token = process.env["ENGINE_TOKEN"];
  // ENGINE_HOST, not HOST: HOST is also read by other tools and must not move the engine by accident.
  const host = process.env["ENGINE_HOST"] ?? "127.0.0.1";
  if (!LOOPBACK.has(host) && !token) {
    throw new Error(`refusing to listen on ${host} without ENGINE_TOKEN; the engine can start jobs and approve plans`);
  }
  const roots = allowedRoots();
  // The default root (D:\AgentHotel) is created empty so the user can drop projects into it. Only the real
  // process does this, never the tests.
  ensureRoots(roots);
  const engine = await startEngine({
    projectRoots: roots,
    logger,
    storeOptions: { redact },
    host,
    port: Number(process.env["PORT"] ?? 8788),
    token: token || undefined,
    fakeDelayMs: Number(process.env["FAKE_DELAY_MS"] ?? 800),
  });
  const stop = (): void => {
    void engine.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (e) {
  logger.error("engine failed to start", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
}
