import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { WorldSim } from "@agentlife/shared";
import { startGateway, type Gateway } from "../src/gateway.ts";
import { loadRoomFile } from "../src/load-room.ts";
import { checkOrigin, DEFAULT_ALLOWED_ORIGINS, isLoopbackHost, normalizeOrigin, parseAllowedOrigins } from "../src/origin.ts";

describe("parseAllowedOrigins", () => {
  it("defaults to the Vite dev server on localhost and 127.0.0.1", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(DEFAULT_ALLOWED_ORIGINS.map(normalizeOrigin));
    expect(parseAllowedOrigins("")).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
    expect(parseAllowedOrigins(" , ")).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
  });

  it("replaces the defaults with the listed origins, trimmed, lower-cased, without trailing slash", () => {
    expect(parseAllowedOrigins("https://Play.Example.com/, http://localhost:3000 ")).toEqual([
      "https://play.example.com",
      "http://localhost:3000",
    ]);
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "127.1.2.3", "localhost", "::1", "[::1]", "::ffff:127.0.0.1"])("%s is loopback", (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each(["0.0.0.0", "::", "192.168.1.5", "example.com", "10.0.0.1", ""])("%s is not loopback", (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });
});

describe("checkOrigin", () => {
  const policy = { allowed: ["http://localhost:5173"], bindHost: "127.0.0.1" };

  it("accepts an allowed origin and rejects others", () => {
    expect(checkOrigin("http://localhost:5173", policy)).toBe(true);
    expect(checkOrigin("HTTP://LOCALHOST:5173/", policy)).toBe(true);
    expect(checkOrigin("http://localhost:5174", policy)).toBe(false);
    expect(checkOrigin("https://localhost:5173", policy)).toBe(false);
    expect(checkOrigin("http://evil.example", policy)).toBe(false);
    expect(checkOrigin("null", policy)).toBe(false);
  });

  it("accepts a missing origin only for a loopback bind", () => {
    expect(checkOrigin(undefined, policy)).toBe(true);
    expect(checkOrigin(undefined, { ...policy, bindHost: "0.0.0.0" })).toBe(false);
    expect(checkOrigin(undefined, { ...policy, bindHost: "192.168.1.5" })).toBe(false);
    // A listed origin still works on a public bind.
    expect(checkOrigin("http://localhost:5173", { ...policy, bindHost: "0.0.0.0" })).toBe(true);
  });
});

describe("gateway Origin check (audit M3)", () => {
  const gateways: Gateway[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    for (const g of gateways.splice(0)) await g.close();
  });

  async function start(extra: { host?: string; allowedOrigins?: string[] } = {}): Promise<Gateway> {
    const g = await startGateway({ sim: new WorldSim(loadRoomFile(), Date.now), port: 0, ...extra });
    gateways.push(g);
    return g;
  }

  /** Resolves "open" with a welcome, or the HTTP status when the upgrade is refused. */
  function attempt(port: number, origin?: string): Promise<"open" | number> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, origin === undefined ? {} : { origin });
      sockets.push(ws);
      ws.once("open", () => resolve("open"));
      ws.once("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.once("error", () => undefined);
    });
  }

  it("accepts an allowed Origin", async () => {
    const g = await start();
    expect(await attempt(g.port, "http://localhost:5173")).toBe("open");
  });

  it("answers 403 to an Origin that is not allowed", async () => {
    const g = await start();
    expect(await attempt(g.port, "http://evil.example")).toBe(403);
    expect(await attempt(g.port, "http://localhost:5174")).toBe(403);
    expect(await attempt(g.port, "null")).toBe(403);
  });

  it("uses the configured list instead of the defaults", async () => {
    const g = await start({ allowedOrigins: ["http://127.0.0.1:5199"] });
    expect(await attempt(g.port, "http://127.0.0.1:5199")).toBe("open");
    expect(await attempt(g.port, "http://localhost:5173")).toBe(403);
  });

  it("accepts a request without Origin when bound to loopback (tests and scripts)", async () => {
    const g = await start();
    expect(await attempt(g.port)).toBe("open");
  });

  it("refuses a request without Origin when bound to all interfaces", async () => {
    const g = await start({ host: "0.0.0.0" });
    expect(await attempt(g.port)).toBe(403);
    expect(await attempt(g.port, "http://localhost:5173")).toBe("open");
  });
});
