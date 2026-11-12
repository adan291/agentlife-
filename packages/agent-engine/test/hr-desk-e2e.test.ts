import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, ServerMsg } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
// The HR office end to end, in one process: client socket -> world-server gateway -> HTTP -> engine (scripted runtime).
import { startGateway } from "../../world-server/src/gateway.ts";
import type { Gateway } from "../../world-server/src/gateway.ts";
import { HttpEngineLink } from "../../world-server/src/http-engine.ts";
import { testHotel } from "../../world-server/test/helpers.ts";

let tmp: string;
let engine: Engine | undefined;
let gateway: Gateway | undefined;
let socket: WebSocket | undefined;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-hr-e2e-"));
});
afterEach(async () => {
  socket?.close();
  await gateway?.close();
  await engine?.close();
  engine = undefined;
  gateway = undefined;
  socket = undefined;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function open() {
  engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") },
    dataDir: tmp,
    port: 0,
    team: { file: path.join(tmp, "teams.json") },
    imports: { sources: [], file: path.join(tmp, "catalogue-imports.json") },
  });
  const link = new HttpEngineLink({ baseUrl: `http://127.0.0.1:${engine.port}`, reconnectMs: 20 });
  gateway = await startGateway({ hotel: testHotel({ start: "hr", projects: ["haunted-todo"] }), engine: link, port: 0, tickMs: 5 });
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`);
  socket = ws;
  const received: ServerMsg[] = [];
  ws.addEventListener("message", (ev) => received.push(ServerMsgSchema.parse(JSON.parse(String(ev.data)))));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("cannot connect")), { once: true });
  });
  const until = async (what: string, pred: () => boolean, ms = 8000): Promise<void> => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; got: ${received.map((m) => m.type).join(", ")}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  const lastHr = () => received.findLast((m) => m.type === "hr");
  await until("the welcome", () => received.some((m) => m.type === "welcome"));
  return { received, until, send, lastHr };
}

describe("HR office end to end", () => {
  it("shows the catalogue and the default team, hires, and puts the new person on the bench", async () => {
    const c = await open();
    c.send({ type: "hr_state" });
    await c.until("the desk", () => c.lastHr() !== undefined);
    const first = c.lastHr()!;
    if (first.type !== "hr") throw new Error("unreachable");
    expect(first.state.catalogue.map((e) => e.id)).toEqual(expect.arrayContaining(["architect", "developer", "qa", "qa-strict", "qa-fast", "reviewer", "researcher"]));
    expect(first.state.teams).toHaveLength(1);
    expect(first.state.teams[0]).toMatchObject({ projectId: "haunted-todo", customised: false });
    expect(first.state.teams[0]!.members.map((m) => m.role)).toEqual(["architect", "developer", "qa"]);
    expect(first.state.sources).toEqual([]);

    c.send({ type: "hr_do", act: { action: "hire", projectId: "haunted-todo", templateId: "qa-strict", displayName: "Vera" } });
    await c.until("the new team", () => {
      const m = c.lastHr();
      return m?.type === "hr" && m.state.teams[0]!.members.length === 4;
    });
    const hired = c.lastHr();
    if (hired?.type !== "hr") throw new Error("unreachable");
    expect(hired.state.teams[0]).toMatchObject({ customised: true });
    expect(hired.state.teams[0]!.members.at(-1)).toMatchObject({ displayName: "Vera", role: "qa", templateId: "qa-strict" });
  });

  it("refuses to fire the last architect and says why", async () => {
    const c = await open();
    c.send({ type: "hr_do", act: { action: "fire", projectId: "haunted-todo", memberId: "architect" } });
    await c.until("the refusal", () => c.received.some((m) => m.type === "error" && m.code === "hr_error"));
    const err = c.received.find((m) => m.type === "error" && m.code === "hr_error");
    expect(err?.type === "error" && err.message).toContain("only architect");
    await c.until("the desk", () => c.lastHr() !== undefined);
  });

  it("asks for a proposal, then applies it: hire the pick, let the replaced member go", async () => {
    const c = await open();
    c.send({ type: "hr_do", act: { action: "suggest", projectId: "haunted-todo" } });
    await c.until("the proposal", () => c.received.some((m) => m.type === "hr_suggestion"));
    const s = c.received.find((m) => m.type === "hr_suggestion");
    if (s?.type !== "hr_suggestion") throw new Error("unreachable");
    expect(s.suggestion).toMatchObject({ projectId: "haunted-todo", by: "rules" });
    expect(s.suggestion.picks).toHaveLength(1);
    const pick = s.suggestion.picks[0]!;
    expect(pick).toMatchObject({ templateId: "qa-fast", role: "qa", replacesId: "qa" });
    // Asking changed nothing.
    expect(c.lastHr()).toBeUndefined();

    c.send({
      type: "hr_do",
      act: { action: "apply", projectId: "haunted-todo", picks: [{ templateId: pick.templateId, displayName: pick.displayName, model: pick.model, replacesId: pick.replacesId! }] },
    });
    await c.until("the new team", () => c.lastHr() !== undefined);
    const after = c.lastHr();
    if (after?.type !== "hr") throw new Error("unreachable");
    expect(after.state.teams[0]!.members.map((m) => [m.role, m.templateId])).toEqual([
      ["architect", "architect"],
      ["developer", "developer"],
      ["qa", "qa-fast"],
    ]);
  });
});
