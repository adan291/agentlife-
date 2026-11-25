// The structure rules of docs/architecture.md, checked on the source, so a change that breaks one fails `pnpm check`
// instead of quietly growing the coupling. Each rule names why it exists.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PKG = (p: string): string => path.join(ROOT, "packages", p, "src");

/** Every .ts file under a folder, as paths relative to it with forward slashes. */
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** The module specifiers a file imports or re-exports, with `type` for type-only imports. */
function importsOf(file: string): { from: string; typeOnly: boolean }[] {
  const text = readFileSync(file, "utf8");
  const out: { from: string; typeOnly: boolean }[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)"/gms;
  for (const m of text.matchAll(re)) out.push({ from: m[3]!, typeOnly: m[2] !== undefined });
  for (const m of text.matchAll(/^\s*import\s+"([^"]+)"/gm)) out.push({ from: m[1]!, typeOnly: false });
  return out;
}

/** `file: specifier` for every import of the files under `dir` (filtered by `only`) that matches `bad`. */
function offenders(dir: string, bad: (spec: string, typeOnly: boolean, file: string) => boolean, only: (file: string) => boolean = () => true): string[] {
  const found: string[] = [];
  for (const f of filesOf(dir).filter(only)) {
    for (const i of importsOf(path.join(dir, f))) if (bad(i.from, i.typeOnly, f)) found.push(`${f}: ${i.from}`);
  }
  return found;
}

describe("package boundaries", () => {
  it("shared imports none of the other packages (it is the contract both ends validate with)", () => {
    expect(offenders(PKG("shared"), (s) => /^@agentlife\/(client|world-server|agent-engine)/.test(s))).toEqual([]);
  });

  it("the client talks only to the world-server: it imports neither server package nor node", () => {
    expect(offenders(PKG("client"), (s) => /^@agentlife\/(world-server|agent-engine)/.test(s) || s.startsWith("node:"))).toEqual([]);
  });

  it("the world-server never imports the engine: they speak HTTP and SSE only", () => {
    expect(offenders(PKG("world-server"), (s) => s.startsWith("@agentlife/agent-engine") || s.includes("agent-engine/src"))).toEqual([]);
  });
});

describe("portable core (what a desktop or mobile app could reuse)", () => {
  it("shared has no node imports, except its two node-only entry points (leaks, bugs-node)", () => {
    const nodeOnly = new Set(["leaks.ts", "bugs-node.ts"]);
    expect(offenders(PKG("shared"), (s) => s.startsWith("node:"), (f) => !nodeOnly.has(f))).toEqual([]);
  });

  it("the shared index does not export the node-only entry points", () => {
    expect(offenders(PKG("shared"), (s) => /(^|\/)(leaks|bugs-node)(\.ts)?$/.test(s), (f) => f === "index.ts")).toEqual([]);
  });

  it("the client panels and state do not import PixiJS: only the scene and main.ts draw", () => {
    expect(offenders(PKG("client"), (s) => s === "pixi.js" || s.startsWith("pixi.js/") || s.startsWith("@pixi/"), (f) => !f.startsWith("scene/") && f !== "main.ts")).toEqual([]);
  });
});

describe("engine layers", () => {
  it("the job state machine is pure: no files, processes, network or HTTP (ids from node:crypto are fine)", () => {
    const io = (s: string): boolean => (s.startsWith("node:") && s !== "node:crypto") || s.includes("http/");
    expect(offenders(PKG("agent-engine"), io, (f) => f.startsWith("jobs/"))).toEqual([]);
  });

  it("only routes and the server's assembly import the HTTP adapter; domain code throws errors.ts errors", () => {
    const routeFiles = (f: string): boolean => f.startsWith("http/") || f === "engine.ts" || f.endsWith("/routes.ts") || f === "build-board.ts" || f === "crew.ts";
    expect(offenders(PKG("agent-engine"), (s) => /(^|\/)http\/[^/]+$/.test(s), (f) => !routeFiles(f))).toEqual([]);
  });
});

describe("world-server gateway features", () => {
  const gw = path.join(PKG("world-server"), "gateway");

  it("a feature uses another only through what startGateway passes it: type imports only", () => {
    expect(offenders(gw, (s, typeOnly) => s.startsWith("./") && !typeOnly, (f) => f.startsWith("features/"))).toEqual([]);
  });

  it("features never touch the socket server or the connection lifecycle", () => {
    expect(offenders(gw, (s, typeOnly) => s === "ws" && !typeOnly, (f) => f.startsWith("features/") || f === "engine-events.ts")).toEqual([]);
  });

  it("gateway.ts stays an assembly: under 250 lines", () => {
    const lines = readFileSync(path.join(PKG("world-server"), "gateway.ts"), "utf8").split("\n").length;
    expect(lines).toBeLessThan(250);
  });
});
