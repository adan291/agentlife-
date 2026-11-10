import { PROTOCOL_VERSION, ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, ServerMsg } from "@agentlife/shared";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "replaced";

/** Close code the world-server uses when a newer connection takes over the session. */
export const REPLACED_CODE = 4000;

/** What the scene and panels talk to. Live (WebSocket) now; replay comes with the demo-replay spec. */
export interface Transport {
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): () => void;
  onStatus(cb: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

const BACKOFF_MS = [1000, 2000, 5000, 10000] as const;

/** Reconnect delay for the nth consecutive failed attempt (0-based): 1 s, 2 s, 5 s, then 10 s. */
export function reconnectDelay(attempt: number): number {
  const i = Math.max(0, Math.min(BACKOFF_MS.length - 1, Math.floor(attempt)));
  return BACKOFF_MS[i]!;
}

/** The subset of WebSocket that LiveTransport uses (lets tests inject a fake). */
export interface SocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface LiveTransportOptions {
  createSocket?: (url: string) => SocketLike;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const OPEN = 1;

export class LiveTransport implements Transport {
  private readonly url: string;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly messageListeners = new Set<(msg: ServerMsg) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private socket: SocketLike | null = null;
  private timer: unknown = null;
  private attempt = 0;
  private closed = false;
  private status: ConnectionStatus = "connecting";

  constructor(url: string, options: LiveTransportOptions = {}) {
    this.url = url;
    this.createSocket = options.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.connect();
  }

  send(msg: ClientMsg): void {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(msg));
  }

  onMessage(cb: (msg: ServerMsg) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  /** "Use here": connect again after another client replaced this one. */
  reconnect(): void {
    if (this.closed || this.status !== "replaced") return;
    this.attempt = 0;
    this.setStatus("connecting");
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close();
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusListeners) cb(status);
  }

  private connect(): void {
    if (this.closed) return;
    const socket = this.createSocket(this.url);
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
      socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION } satisfies ClientMsg));
    };
    socket.onmessage = (ev) => this.receive(ev.data);
    socket.onerror = () => {
      // The close event follows and schedules the reconnect.
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if ((ev as { code?: number } | null)?.code === REPLACED_CODE) {
        this.setStatus("replaced");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.setStatus("reconnecting");
    const delay = reconnectDelay(this.attempt++);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  /** Parse and validate; anything malformed is dropped. */
  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = ServerMsgSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("dropped invalid server message", parsed.error.issues[0]?.message);
      return;
    }
    for (const cb of this.messageListeners) cb(parsed.data);
  }
}
