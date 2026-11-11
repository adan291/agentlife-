import { describe, expect, it } from "vitest";
import { findLiveEndpoints, isScannable } from "../tools/demo-guard.ts";

describe("demo guard", () => {
  it("accepts a bundle without live code", () => {
    expect(findLiveEndpoints("a.js", "const x = fetch('/agentlife/demo/run-001.json');")).toEqual([]);
  });

  it("flags each kind of live endpoint", () => {
    const text = 'new WebSocket(u); const a = "ws://127.0.0.1:8787"; class LiveTransport {}; const b = import.meta.env.VITE_WORLD_URL; "localhost"';
    const rules = findLiveEndpoints("a.js", text).map((f) => f.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        "WebSocket URL (ws:// or wss://)",
        "world-server default port 8787",
        "loopback address 127.0.0.1",
        "localhost address",
        "VITE_WORLD_URL setting",
        "LiveTransport class",
        "new WebSocket(...) call",
      ]),
    );
  });

  it("flags wss:// and the engine port", () => {
    expect(findLiveEndpoints("a.js", "wss://example.org/x 8788").map((f) => f.rule)).toEqual([
      "WebSocket URL (ws:// or wss://)",
      "engine port 8788",
    ]);
  });

  it("does not match port numbers inside longer numbers", () => {
    expect(findLiveEndpoints("a.js", "const n = 187879;")).toEqual([]);
  });

  it("scans text files only", () => {
    expect(isScannable("assets/index-abc.js")).toBe(true);
    expect(isScannable("demo/run-001.json")).toBe(true);
    expect(isScannable("assets/font.woff2")).toBe(false);
    expect(isScannable("a.png")).toBe(false);
  });
});
