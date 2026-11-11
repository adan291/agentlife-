import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, BuildBoard, ClientMsg, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const BOARD: BuildBoard = {
  phase: { text: "review", spec: "build-board", at: 1 },
  rows: [{ number: 3, spec: "build-board", sessions: ["S15B"], live: false, status: "verifying", purpose: "Board" }],
  specs: [{ spec: "build-board", tasks: [{ number: "1", title: "Engine", done: true }], done: 1, total: 1, verdict: "PASS" }],
  sessions: [],
};

function engine(withBoard: boolean): EngineLink {
  const queue = new EventQueue<AgentEvent>();
  return {
    listRepos: () => Promise.resolve([]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    ...(withBoard
      ? {
          getBuildBoard: () => Promise.resolve(BOARD),
          getBuildReport: (spec: string) => (spec === "build-board" ? Promise.resolve({ spec, content: "VERDICT: PASS\n\n# Report" }) : Promise.reject(new Error("none"))),
        }
      : {}),
    events: () => queue,
    close: () => queue.close(),
  };
}

async function connect(link: EngineLink) {
  const gateway = await startGateway({ hotel: testHotel(), engine: link, port: 0, tickMs: 5 });
  gateways.push(gateway);
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    received.push(ServerMsgSchema.parse(JSON.parse(d.toString())));
    waiters.splice(0).forEach((w) => w());
  });
  const waitFor = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, left);
      });
    }
  };
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  await waitFor(() => received.some((m) => m.type === "welcome"));
  return { received, waitFor, send };
}

describe("construction board through the gateway", () => {
  it("sends the board before it opens the panel when the user uses the construction board", async () => {
    const c = await connect(engine(true));
    c.send({ type: "use", itemId: "construction_board_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("build_board")).toBeGreaterThan(-1);
    expect(types.indexOf("build_board")).toBeLessThan(types.indexOf("open_panel"));
    expect(c.received.find((m) => m.type === "open_panel")).toMatchObject({ panel: "build" });
  });

  it("answers a refresh and a report request, and rejects a spec name that is a path trick", async () => {
    const c = await connect(engine(true));
    c.send({ type: "build_board" });
    await c.waitFor(() => c.received.some((m) => m.type === "build_board"));
    c.send({ type: "build_report", spec: "build-board" });
    await c.waitFor(() => c.received.some((m) => m.type === "build_report"));
    expect(c.received.find((m) => m.type === "build_report")).toMatchObject({ report: { spec: "build-board" } });
    c.send({ type: "build_report", spec: "../secret" } as unknown as ClientMsg);
    await c.waitFor(() => c.received.some((m) => m.type === "error" && m.code === "bad_message"));
  });

  it("says so when the engine has no construction board", async () => {
    const c = await connect(engine(false));
    c.send({ type: "build_board" });
    await c.waitFor(() => c.received.some((m) => m.type === "error" && m.code === "engine_unavailable"));
  });
});
