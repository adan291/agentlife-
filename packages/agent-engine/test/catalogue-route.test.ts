import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CatalogueResponseSchema, TEAM_ROLES } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";

let engine: Engine | undefined;
let dir: string | undefined;
afterEach(async () => {
  await engine?.close();
  engine = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe("GET /catalogue", () => {
  it("lists the templates with role, tier, default model, source and origin", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "al-catalogue-"));
    engine = await startEngine({ storeOptions: { dbPath: ":memory:", runsDir: path.join(dir, "runs") }, dataDir: dir, port: 0 });
    const res = await fetch(`http://127.0.0.1:${engine.port}/catalogue`);
    expect(res.status).toBe(200);
    const list = CatalogueResponseSchema.parse(await res.json());
    for (const role of TEAM_ROLES) expect(list.some((e) => e.role === role), role).toBe(true);
    expect(list.find((e) => e.id === "qa-strict")).toMatchObject({ role: "qa", tier: "read-only", origin: "built-in", source: "built-in" });
    expect(list.find((e) => e.id === "developer")).toMatchObject({ tier: "write-in-worktree" });
    // The persona is not part of the listing.
    expect(JSON.stringify(list)).not.toMatch(/persona/);
  });
});
