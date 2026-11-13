import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// Vitest compiles TypeScript itself, so it accepts syntax that the real processes refuse: the engine and the
// world-server run with `node --experimental-strip-types`, which rejects parameter properties, enums and namespaces.
// Loading their module graphs with the real flag catches that before a restart does (seen 2026-11-13).
const here = path.dirname(fileURLToPath(import.meta.url));
const entries = [
  path.join(here, "..", "src", "engine.ts"),
  path.join(here, "..", "..", "world-server", "src", "gateway.ts"),
];

describe("modules load under --experimental-strip-types", () => {
  it.each(entries)("%s", (entry) => {
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(entry).href)});`], {
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.stderr).not.toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|SyntaxError/);
    expect(r.status).toBe(0);
  }, 70_000);
});
