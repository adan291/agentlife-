import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import {
  ClientMsgSchema,
  MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ServerMsgSchema,
} from "@agentlife/shared";
import type { ErrorCode, ServerMsg, WorldSim } from "@agentlife/shared";

export interface GatewayOptions {
  sim: WorldSim;
  host?: string;
  /** 0 picks an ephemeral port. */
  port?: number;
  /** Milliseconds between checks for deferred sim messages. */
  tickMs?: number;
  /** Clock for the rate limiter. */
  clock?: () => number;
}

export interface Gateway {
  readonly port: number;
  close(): Promise<void>;
}

/** Token bucket: `rate` tokens per second, burst of `rate`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly rate: number,
    private readonly clock: () => number,
  ) {
    this.tokens = rate;
    this.last = clock();
  }
  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export function startGateway(options: GatewayOptions): Promise<Gateway> {
  const { sim } = options;
  const clock = options.clock ?? Date.now;
  const wss = new WebSocketServer({
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 8787,
    maxPayload: MAX_MESSAGE_BYTES,
  });

  let current: { ws: WebSocket; userId: number } | null = null;

  const send = (ws: WebSocket, msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ServerMsgSchema.parse(msg)));
  };
  const sendError = (ws: WebSocket, code: ErrorCode, message: string) => send(ws, { type: "error", code, message });
  const sendAll = (msgs: ServerMsg[]) => {
    if (current) for (const m of msgs) send(current.ws, m);
  };

  const tick = setInterval(() => sendAll(sim.dueMessages()), options.tickMs ?? 50);

  wss.on("connection", (ws) => {
    // One user session in the MVP: a second connection replaces the first.
    if (current) current.ws.close(4000, "replaced by a newer connection");
    const { you, welcome } = sim.join();
    current = { ws, userId: you };
    send(ws, welcome);

    const bucket = new TokenBucket(MAX_MESSAGES_PER_SECOND, clock);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!bucket.take()) return sendError(ws, "rate_limited", "too many messages");
      if (isBinary) return sendError(ws, "bad_message", "binary messages are not supported");
      let json: unknown;
      try {
        json = JSON.parse(rawToString(data));
      } catch {
        return sendError(ws, "bad_message", "invalid JSON");
      }
      const parsed = ClientMsgSchema.safeParse(json);
      if (!parsed.success) return sendError(ws, "bad_message", "invalid message");
      if (current?.ws !== ws) return;
      const msg = parsed.data;
      if (msg.type === "hello") {
        if (msg.protocol !== PROTOCOL_VERSION) sendError(ws, "bad_message", `protocol ${PROTOCOL_VERSION} required`);
        return;
      }
      for (const out of sim.handleIntent(current.userId, msg)) send(ws, out);
    });

    ws.on("close", () => {
      if (current?.ws === ws) current = null;
    });
    ws.on("error", () => ws.terminate());
  });

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(tick);
            for (const c of wss.clients) c.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}

function rawToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
