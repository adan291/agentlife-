import { startEngine } from "./engine.ts";
import { createJsonLogger } from "./log.ts";

const logger = createJsonLogger();

try {
  const token = process.env["ENGINE_TOKEN"];
  const engine = await startEngine({
    logger,
    host: process.env["HOST"] ?? "127.0.0.1",
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
