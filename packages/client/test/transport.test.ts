import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PROTOCOL_VERSION } from "@agentlife/shared";
import type { ServerMsg } from "@agentlife/shared";
import { LiveTransport, reconnectDelay } from "../src/transport.ts";
import type { ConnectionStatus, SocketLike } from "../src/transport.ts";

class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const transport = new LiveTransport("ws://test", {
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  return { transport, sockets, timers };
}

describe("reconnectDelay", () => {
  it("backs off 1s, 2s, 5s and caps at 10s", () => {
    expect([0, 1, 2, 3, 4, 50].map(reconnectDelay)).toEqual([1000, 2000, 5000, 10000, 10000, 10000]);
  });

  it("never decreases and never exceeds 10 s (property)", () => {
    fc.assert(
      fc.property(fc.nat(100), (n) => reconnectDelay(n) <= 10000 && reconnectDelay(n + 1) >= reconnectDelay(n)),
    );
  });
});

describe("LiveTransport", () => {
  it("says hello on open and reports status", () => {
    const { transport, sockets } = setup();
    const statuses: ConnectionStatus[] = [];
    transport.onStatus((s) => statuses.push(s));
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: "hello", protocol: PROTOCOL_VERSION });
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("delivers valid messages and drops malformed ones", () => {
    const { transport, sockets } = setup();
    const got: ServerMsg[] = [];
    transport.onMessage((m) => got.push(m));
    const s = sockets[0]!;
    s.open();
    s.receive(JSON.stringify({ type: "face", id: "qa", dir: 3 }));
    s.receive(JSON.stringify({ type: "face", id: "qa", dir: 99 }));
    s.receive("not json");
    s.receive(42);
    expect(got).toEqual([{ type: "face", id: "qa", dir: 3 }]);
  });

  it("only sends while open", () => {
    const { transport, sockets } = setup();
    transport.send({ type: "move", x: 1, y: 1 });
    expect(sockets[0]!.sent).toEqual([]);
    sockets[0]!.open();
    transport.send({ type: "move", x: 1, y: 1 });
    expect(sockets[0]!.sent.length).toBe(2);
  });

  it("reconnects with backoff after a drop and resets after success", () => {
    const { transport, sockets, timers } = setup();
    const statuses: ConnectionStatus[] = [];
    transport.onStatus((s) => statuses.push(s));
    sockets[0]!.open();
    sockets[0]!.drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    timers.shift()!.fn();
    expect(sockets.length).toBe(2);
    sockets[1]!.drop(); // fails before opening: next delay is longer
    expect(timers.map((t) => t.ms)).toEqual([2000]);
    timers.shift()!.fn();
    sockets[2]!.open();
    expect(statuses.at(-1)).toBe("open");
    sockets[2]!.drop();
    expect(timers.map((t) => t.ms)).toEqual([1000]);
  });

  it("does not reconnect on code 4000 and reports replaced", () => {
    const { transport, sockets, timers } = setup();
    const statuses: ConnectionStatus[] = [];
    transport.onStatus((s) => statuses.push(s));
    sockets[0]!.open();
    sockets[0]!.drop(4000);
    expect(statuses.at(-1)).toBe("replaced");
    expect(timers.length).toBe(0);
    expect(sockets.length).toBe(1);
  });

  it("reconnects after code 1006", () => {
    const { sockets, timers } = setup();
    sockets[0]!.open();
    sockets[0]!.drop(1006);
    expect(timers.map((t) => t.ms)).toEqual([1000]);
  });

  it("connects again on reconnect() only when replaced", () => {
    const { transport, sockets } = setup();
    sockets[0]!.open();
    transport.reconnect();
    expect(sockets.length).toBe(1);
    sockets[0]!.drop(4000);
    transport.reconnect();
    expect(sockets.length).toBe(2);
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!)).toEqual({ type: "hello", protocol: PROTOCOL_VERSION });
  });

  it("does not reconnect after close()", () => {
    const { transport, sockets, timers } = setup();
    sockets[0]!.open();
    transport.close();
    sockets[0]!.drop();
    expect(timers.length).toBe(0);
    expect(sockets.length).toBe(1);
  });
});
