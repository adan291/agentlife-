import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BUG_MESSAGE_MAX, BUG_RATE_PER_MINUTE, BUG_REPORT_BYTES, ClientMsgSchema } from "@agentlife/shared";
import type { BugReportFields } from "@agentlife/shared";
import { BUG_DUPLICATE_MS, BUG_PENDING_MAX, BugGrabber, consoleText } from "../src/bugs/grabber.ts";
import type { GrabberConsole, GrabberOptions } from "../src/bugs/grabber.ts";

type Listener = (ev: unknown) => void;

/** A page that can be told things went wrong. */
function setup(over: Partial<GrabberOptions> = {}) {
  const sent: BugReportFields[] = [];
  const listeners = new Map<string, { fn: Listener; capture: boolean }[]>();
  const target = {
    addEventListener: (type: string, fn: unknown, capture?: boolean | AddEventListenerOptions) => {
      const list = listeners.get(type) ?? [];
      list.push({ fn: fn as Listener, capture: capture === true });
      listeners.set(type, list);
    },
    removeEventListener: (type: string, fn: unknown) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l.fn !== fn));
    },
  };
  const logged: unknown[][] = [];
  const con: GrabberConsole = { error: (...a) => void logged.push(a) };
  let now = 1_000_000;
  const grabber = new BugGrabber({ send: (r) => void sent.push(r), now: () => now, target, console: con, ...over });
  const fire = (type: string, ev: unknown) => {
    for (const l of listeners.get(type) ?? []) l.fn(ev);
  };
  return { grabber, sent, fire, listeners, con, logged, tick: (ms: number) => void (now += ms), clock: () => now };
}

describe("what the page catches", () => {
  it("an uncaught error becomes a report with its stack", () => {
    const t = setup();
    t.grabber.install();
    const error = new TypeError("Cannot read properties of undefined (reading 'x')");
    t.fire("error", { message: error.message, error });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({ kind: "uncaught", message: "TypeError: Cannot read properties of undefined (reading 'x')", clientTime: t.clock() });
    expect(t.sent[0]?.stack).toContain("TypeError");
  });

  it("an error with no Error object still has its message", () => {
    const t = setup();
    t.grabber.install();
    t.fire("error", { message: "Script error." });
    expect(t.sent[0]).toMatchObject({ kind: "uncaught", message: "Script error." });
  });

  it("a rejection becomes a report, whatever was rejected", () => {
    const t = setup();
    t.grabber.install();
    t.fire("unhandledrejection", { reason: new RangeError("too deep") });
    t.fire("unhandledrejection", { reason: "plain text reason" });
    t.fire("unhandledrejection", { reason: { code: 7 } });
    t.fire("unhandledrejection", { reason: undefined });
    expect(t.sent.map((r) => r.kind)).toEqual(["unhandled-rejection", "unhandled-rejection", "unhandled-rejection", "unhandled-rejection"]);
    expect(t.sent.map((r) => r.message)).toEqual(["RangeError: too deep", "plain text reason", '{"code":7}', "undefined"]);
  });

  it("a rejection that says a file could not be fetched is an asset failure", () => {
    const t = setup();
    t.grabber.install();
    t.fire("unhandledrejection", { reason: new TypeError("Failed to fetch") });
    expect(t.sent[0]).toMatchObject({ kind: "asset-load" });
  });

  it("an image or a script that does not load is an asset failure, named by its path and not its query", () => {
    const t = setup();
    t.grabber.install();
    t.fire("error", { target: { tagName: "IMG", src: "http://127.0.0.1:5173/assets/ghost.png?token=abc123" } });
    expect(t.sent[0]).toEqual(expect.objectContaining({ kind: "asset-load", message: "Failed to load img /assets/ghost.png" }));
  });

  it("an error from Pixi is a pixi error, in the message or in the stack", () => {
    const t = setup();
    t.grabber.install();
    t.fire("error", { message: "x", error: Object.assign(new Error("Cannot read properties of null"), { stack: "Error: x\n    at Graphics.fill (pixi.js:123:4)" }) });
    t.fire("unhandledrejection", { reason: new Error("PixiJS could not create a texture") });
    expect(t.sent.map((r) => r.kind)).toEqual(["pixi", "pixi"]);
  });

  it("console.error is reported and still printed as before; putting it back stops the reports", () => {
    const t = setup();
    const original = t.con.error;
    const stop = t.grabber.install();
    expect(t.con.error).not.toBe(original);
    t.con.error("could not draw", new Error("boom"), { id: 3 });
    expect(t.logged).toHaveLength(1);
    expect(t.logged[0]?.[0]).toBe("could not draw");
    expect(t.sent[0]).toMatchObject({ kind: "console-error", message: 'could not draw boom {"id":3}' });
    expect(t.sent[0]?.stack).toContain("Error: boom");
    stop();
    expect(t.con.error).toBe(original);
    expect(t.listeners.get("error")).toEqual([]);
    expect(t.listeners.get("unhandledrejection")).toEqual([]);
    t.con.error("after");
    expect(t.sent).toHaveLength(1);
  });

  it("a failed schema check on a server message is a protocol error", () => {
    const t = setup();
    t.grabber.protocol("welcome: Invalid input");
    expect(t.sent[0]).toMatchObject({ kind: "protocol" });
    expect(t.sent[0]?.message).toContain("welcome: Invalid input");
  });

  it("listens for a failed image on the way down, because it does not bubble", () => {
    const t = setup();
    t.grabber.install();
    expect(t.listeners.get("error")?.[0]?.capture).toBe(true);
  });

  it("tells where the user was: the floor, the panel and the view", () => {
    const t = setup({ where: () => ({ floor: "project:alpha", panel: "board", view: "hotel" }) });
    t.grabber.report("uncaught", "boom");
    expect(t.sent[0]).toMatchObject({ floor: "project:alpha", panel: "board", view: "hotel" });
  });

  it("a page that cannot say where it is (an error while it starts) still reports", () => {
    const t = setup({ where: () => { throw new ReferenceError("not initialised"); } });
    t.grabber.report("uncaught", "boom");
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.floor).toBeUndefined();
  });
});

describe("limits", () => {
  it("an identical report inside 10 seconds is counted, not sent; after that it is sent again", () => {
    const t = setup();
    t.grabber.report("uncaught", "boom");
    t.tick(BUG_DUPLICATE_MS - 1);
    t.grabber.report("uncaught", "boom");
    expect(t.sent).toHaveLength(1);
    expect(t.grabber.skipped).toBe(1);
    t.tick(1);
    t.grabber.report("uncaught", "boom");
    expect(t.sent).toHaveLength(2);
  });

  it("the same error with other numbers and line numbers is the same report (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 1, max: 999 }), (a, b, line) => {
        const t = setup();
        t.grabber.report("uncaught", `Bad tile ${a},${b}`, `Error: x\n    at draw (http://localhost/assets/index-AbC123de.js:${line}:5)`);
        t.grabber.report("uncaught", `Bad tile ${b},${a}`, `Error: x\n    at draw (http://localhost/assets/index-AbC123de.js:${line + 1}:9)`);
        expect(t.sent).toHaveLength(1);
      }),
    );
  });

  it("another kind or another message is not a duplicate", () => {
    const t = setup();
    t.grabber.report("uncaught", "boom");
    t.grabber.report("console-error", "boom");
    t.grabber.report("uncaught", "bang");
    expect(t.sent).toHaveLength(3);
  });

  it("sends at most 20 reports a minute, and again when the minute is over", () => {
    const t = setup();
    for (let i = 0; i < BUG_RATE_PER_MINUTE + 5; i++) {
      t.grabber.report("uncaught", `failure of kind ${String.fromCharCode(97 + i)}`);
      t.tick(100);
    }
    expect(t.sent).toHaveLength(BUG_RATE_PER_MINUTE);
    expect(t.grabber.skipped).toBe(5);
    t.tick(60_000);
    t.grabber.report("uncaught", "a new failure after the minute");
    expect(t.sent).toHaveLength(BUG_RATE_PER_MINUTE + 1);
  });

  it("cuts a long message and a long stack, and no report is over 8 KB (property)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 6000 }), fc.string({ maxLength: 20000 }), (message, stack) => {
        const t = setup();
        t.grabber.report("uncaught", message, stack);
        for (const r of t.sent) {
          expect(r.message.length).toBeLessThanOrEqual(BUG_MESSAGE_MAX);
          const wire = JSON.stringify({ type: "bug_report", ...r });
          expect(new TextEncoder().encode(wire).length).toBeLessThanOrEqual(BUG_REPORT_BYTES);
          expect(ClientMsgSchema.safeParse({ type: "bug_report", ...r }).success).toBe(true);
        }
      }),
    );
  });

  it("an empty message still makes a report, named by its kind", () => {
    const t = setup();
    t.grabber.report("console-error", "   ");
    expect(t.sent[0]?.message).toBe("console-error");
  });
});

describe("a grabber never makes things worse", () => {
  it("a send that throws is swallowed", () => {
    const t = setup({ send: () => { throw new Error("socket is gone"); } });
    expect(() => t.grabber.report("uncaught", "boom")).not.toThrow();
  });

  it("an error logged while a report is being sent does not start another report", () => {
    const sent: BugReportFields[] = [];
    const con: GrabberConsole = { error: () => undefined };
    const g = new BugGrabber({ send: (r) => { sent.push(r); con.error("logged inside send"); }, console: con, target: { addEventListener: () => undefined, removeEventListener: () => undefined } });
    g.install();
    con.error("first");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toBe("first");
  });
});

describe("before the connection is open", () => {
  it("keeps the reports and sends them when the connection opens", () => {
    let ready = false;
    const t = setup({ ready: () => ready });
    t.grabber.report("uncaught", "while the page starts");
    t.grabber.report("uncaught", "a second one");
    expect(t.sent).toEqual([]);
    ready = true;
    t.grabber.flush();
    expect(t.sent.map((r) => r.message)).toEqual(["while the page starts", "a second one"]);
    t.grabber.flush();
    expect(t.sent).toHaveLength(2);
  });

  it("keeps at most 20, the first ones", () => {
    let ready = false;
    const t = setup({ ready: () => ready });
    for (let i = 0; i < BUG_PENDING_MAX + 10; i++) t.grabber.report("uncaught", `early failure ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);
    ready = true;
    t.grabber.flush();
    expect(t.sent).toHaveLength(BUG_PENDING_MAX);
    expect(t.sent[0]?.message).toBe("early failure aa");
  });

  it("does not send while the connection is still closed when flush is called", () => {
    const t = setup({ ready: () => false });
    t.grabber.report("uncaught", "x");
    t.grabber.flush();
    expect(t.sent).toEqual([]);
  });
});

describe("consoleText", () => {
  it("joins what was logged and takes the first stack", () => {
    const e = new Error("boom");
    expect(consoleText(["a", 3, e, { x: 1 }, null])).toEqual({ message: "a 3 boom {\"x\":1} null", stack: e.stack });
  });

  it("survives a value that cannot be turned into text", () => {
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    expect(consoleText([loop]).message).toBe("[object Object]");
  });
});
