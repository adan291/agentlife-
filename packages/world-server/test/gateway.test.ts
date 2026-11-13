import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PROTOCOL_VERSION, RoomValidationError, ServerMsgSchema } from "@agentlife/shared";
import type { RoomId, ServerMsg } from "@agentlife/shared";
import { startGateway } from "../src/gateway.ts";
import { FakeEngineLink } from "../src/fake-engine.ts";
import type { Gateway } from "../src/gateway.ts";
import { ROOMS_DIR, loadRoomFile } from "../src/load-room.ts";
import { testHotel } from "./helpers.ts";

const template = loadRoomFile(join(ROOMS_DIR, "project-template.json"));
const opened: Gateway[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of opened.splice(0)) await g.close();
});

/** The user starts on the floor of `haunted-todo` (the office with the computer, mailbox and board) unless told otherwise. */
async function setup(start: RoomId = "project:haunted-todo") {
  const hotel = testHotel({ start, projects: ["haunted-todo"] });
  const gateway = await startGateway({ hotel, port: 0, tickMs: 5 });
  opened.push(gateway);
  return gateway;
}

/** Connect and buffer every server message so none is missed. */
function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    received.push(ServerMsgSchema.parse(JSON.parse(d.toString())));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (pred: (m: ServerMsg) => boolean, timeoutMs = 2000): Promise<ServerMsg> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const i = received.findIndex(pred);
      if (i >= 0) return received.splice(i, 1)[0]!;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out waiting for message");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, left);
      });
    }
  };
  const open = new Promise<void>((r) => ws.once("open", () => r()));
  const closed = new Promise<{ code: number }>((r) => ws.once("close", (code) => r({ code })));
  return { ws, received, next, open, closed };
}

describe("gateway", () => {
  it("sends welcome on connect with the protocol version and the lobby, then the floor list", async () => {
    const g = await setup("lobby");
    const c = connect(g.port);
    const welcome = await c.next((m) => m.type === "welcome");
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.protocol).toBe(PROTOCOL_VERSION);
    expect(welcome.room.id).toBe("lobby");
    expect(welcome.roomId).toBe("lobby");
    expect(welcome.avatars).toHaveLength(2); // the user and the Builder
    expect(welcome.agents.map((a) => a.agentId)).toEqual(["builder"]);
    expect(await c.next((m) => m.type === "floors")).toMatchObject({
      floors: [
        { roomId: "lobby", kind: "lobby", status: "idle" },
        { roomId: "hr", kind: "hr", status: "idle" },
        { roomId: "project:haunted-todo", kind: "project", name: "haunted-todo", status: "idle" },
      ],
    });
  });

  it("a project floor holds the user, the project's three agents and six empty standing spots", async () => {
    const g = await setup();
    const c = connect(g.port);
    const welcome = await c.next((m) => m.type === "welcome");
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.room.id).toBe("project:haunted-todo");
    expect(welcome.avatars).toHaveLength(4 + 6);
    expect(welcome.avatars.filter((a) => typeof a.id === "string" && a.id.startsWith("guest"))).toHaveLength(6);
    expect(welcome.agents.map((a) => a.agentId)).toEqual(["architect", "developer", "qa"]);
  });

  it("includes the engine's role models in the welcome (from the second connection at the latest)", async () => {
    const hotel = testHotel({ start: "project:haunted-todo", projects: ["haunted-todo"] });
    const engine = new FakeEngineLink({ stepMs: 0 });
    const g = await startGateway({ hotel, port: 0, tickMs: 5, engine });
    opened.push(g);
    await new Promise((r) => setTimeout(r, 30));
    const c = connect(g.port);
    const welcome = await c.next((m) => m.type === "welcome");
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.models).toEqual({ architect: "fake", developer: "fake", qa: "fake" });
    engine.close();
  });

  it("replies bad_message to invalid JSON and invalid messages, and keeps working", async () => {
    const g = await setup();
    const c = connect(g.port);
    await c.open;
    c.ws.send("{not json");
    c.ws.send(JSON.stringify({ type: "move", x: "a", y: 1 }));
    c.ws.send(JSON.stringify({ type: "teleport" }));
    for (let i = 0; i < 3; i++) {
      expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
    }
    c.ws.send(JSON.stringify({ type: "move", x: 5, y: 8 }));
    expect(await c.next((m) => m.type === "walk")).toMatchObject({ type: "walk", id: 1 });
  });

  it("replies no_path for an unreachable target", async () => {
    const g = await setup();
    const c = connect(g.port);
    await c.open;
    c.ws.send(JSON.stringify({ type: "move", x: 0, y: 6 }));
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "no_path" });
  });

  it("sends open_panel after the walk to a piece of furniture ends", async () => {
    const g = await setup();
    const c = connect(g.port);
    await c.open;
    c.ws.send(JSON.stringify({ type: "use", itemId: "board_1" }));
    await c.next((m) => m.type === "walk");
    expect(await c.next((m) => m.type === "open_panel")).toMatchObject({ panel: "board" });
  });

  it("replies engine_unavailable to job_details when there is no engine", async () => {
    const g = await setup();
    const c = connect(g.port);
    await c.open;
    c.ws.send(JSON.stringify({ type: "job_details", taskId: "task-1" }));
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "engine_unavailable" });
  });

  it("closes the connection for messages over 16 KB", async () => {
    const g = await setup();
    const c = connect(g.port);
    await c.open;
    c.ws.send(JSON.stringify({ type: "start_job", repoId: "x", goal: "g".repeat(20 * 1024) }));
    expect((await c.closed).code).toBe(1009);
  });

  it("rate-limits above 20 messages per second", async () => {
    const g = await setup();
    const c = connect(g.port);
    await c.open;
    for (let i = 0; i < 60; i++) c.ws.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION }));
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "rate_limited" });
  });

  it("a second connection replaces the first", async () => {
    const g = await setup();
    const a = connect(g.port);
    await a.next((m) => m.type === "welcome");
    const b = connect(g.port);
    await b.next((m) => m.type === "welcome");
    expect((await a.closed).code).toBe(4000);
  });

  it("binds to 127.0.0.1 by default", async () => {
    const g = await setup();
    expect(g.port).toBeGreaterThan(0);
    const c = connect(g.port);
    await c.open;
    expect(c.ws.url).toContain("127.0.0.1");
  });
});

describe("loadRoomFile", () => {
  it("names the invalid field when the room is bad", () => {
    const dir = mkdtempSync(join(tmpdir(), "room-"));
    try {
      const bad = join(dir, "bad.json");
      const broken = { ...template, furni: template.furni.map((f, i) => (i === 1 ? { ...f, x: 99 } : f)) };
      writeFileSync(bad, JSON.stringify(broken));
      let err: unknown;
      try {
        loadRoomFile(bad);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RoomValidationError);
      expect((err as RoomValidationError).message).toContain("furni.1.x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
