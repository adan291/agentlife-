import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, MorningSummary, ServerMsg } from "@agentlife/shared";
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

function summary(key: string, writtenAt: number): MorningSummary {
  return {
    nightKey: key,
    writtenAt,
    counts: { total: 1, done: 1, failed: 0, waiting: 0, timedOut: 0, cancelled: 0, skipped: 0, delivered: 0 },
    jobs: [{ id: "n1", repoId: "demo", kind: "audit-deps", goal: "Audit dependencies", status: "done", verdict: "pass", minutes: 3 }],
    markdown: `# Morning summary ${key}\n\n1 job: 1 done.\n`,
  };
}

function engine(list: () => MorningSummary[]): EngineLink {
  const queue = new EventQueue<AgentEvent>();
  return {
    listRepos: () => Promise.resolve([]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    getNightSummaries: () => Promise.resolve(list()),
    events: () => queue,
    close: () => queue.close(),
  };
}

async function connect(gateway: Gateway) {
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
  return { received, waitFor, send, ws };
}

async function gatewayFor(link: EngineLink): Promise<Gateway> {
  const g = await startGateway({ hotel: testHotel(), engine: link, port: 0, tickMs: 5, nightPollMs: 20 });
  gateways.push(g);
  return g;
}

const reports = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "report" ? [m] : []));

describe("morning summary in the lobby mailbox", () => {
  it("announces a recent summary like a delivered report", async () => {
    const g = await gatewayFor(engine(() => [summary("2026-11-12", Date.now() - 60_000)]));
    const c = await connect(g);
    await c.waitFor(() => reports(c.received).length > 0);
    const msg = reports(c.received)[0]!;
    expect(msg.resend).toBeUndefined();
    expect(msg.report).toMatchObject({ reportId: "night-2026-11-12", kind: "night", title: "Morning summary 2026-11-12" });
    expect(msg.report.markdown).toContain("1 job: 1 done.");
    expect(msg.report.verdict).toBeUndefined();
  });

  it("lists the summaries when the user opens the lobby mailbox, and stops announcing them afterwards", async () => {
    const link = engine(() => [summary("2026-11-12", Date.now() - 60_000), summary("2026-11-01", Date.now() - 12 * 86_400_000)]);
    const g = await gatewayFor(link);
    const c = await connect(g);
    await c.waitFor(() => reports(c.received).length > 0);
    c.send({ type: "use", itemId: "mailbox_lobby" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    expect(c.received.find((m) => m.type === "open_panel")).toMatchObject({ panel: "mailbox" });
    const resent = reports(c.received).filter((m) => m.resend === true);
    expect(resent.map((m) => m.report.reportId).sort()).toEqual(["night-2026-11-01", "night-2026-11-12"]);

    // Opened: a client that arrives later gets no announcement for it.
    const later = await connect(g);
    await new Promise((r) => setTimeout(r, 80));
    expect(reports(later.received)).toEqual([]);
  });

  it("does not announce a summary that is a day old or more", async () => {
    const g = await gatewayFor(engine(() => [summary("2026-11-01", Date.now() - 3 * 86_400_000)]));
    const c = await connect(g);
    await new Promise((r) => setTimeout(r, 80));
    expect(reports(c.received)).toEqual([]);
  });

  it("picks up a summary written while the user is connected", async () => {
    let list: MorningSummary[] = [];
    const g = await gatewayFor(engine(() => list));
    const c = await connect(g);
    await new Promise((r) => setTimeout(r, 60));
    expect(reports(c.received)).toEqual([]);
    list = [summary("2026-11-13", Date.now())];
    await c.waitFor(() => reports(c.received).length > 0);
    expect(reports(c.received)[0]?.report.reportId).toBe("night-2026-11-13");
  });

  it("keeps working when the engine cannot give summaries", async () => {
    const link = engine(() => []);
    link.getNightSummaries = () => Promise.reject(new Error("down"));
    const g = await gatewayFor(link);
    const c = await connect(g);
    c.send({ type: "use", itemId: "mailbox_lobby" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    expect(reports(c.received)).toEqual([]);
  });
});
