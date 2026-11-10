import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { PlanSchema, ReviewSchema } from "@agentlife/shared";
import { FakeRuntime } from "../src/runtimes/fake.ts";
import { killTree } from "../src/runtimes/kill-tree.ts";
import { CANNED_LINES, LlmRuntime, screenLine } from "../src/runtimes/llm.ts";
import type { AgentRuntime, Role, RuntimeEvent } from "../src/runtimes/types.ts";

async function collect(rt: AgentRuntime, role: Role, signal = new AbortController().signal): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = [];
  for await (const ev of rt.run({ role, prompt: "hello", cwd: ".", timeoutMs: 1000, signal })) out.push(ev);
  return out;
}
const outputOf = (evs: RuntimeEvent[]): string => {
  const o = evs.find((e) => e.kind === "output");
  return o && o.kind === "output" ? o.text : "";
};

async function unusedPort(): Promise<number> {
  const srv = http.createServer();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;
  await new Promise<void>((r) => srv.close(() => r()));
  return port;
}

async function withServer<T>(handler: http.RequestListener, fn: (url: string) => Promise<T>): Promise<T> {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    return await fn(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/v1`);
  } finally {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
  }
}

describe("FakeRuntime", () => {
  it("returns canned valid outputs per role", async () => {
    const rt = new FakeRuntime();
    expect(PlanSchema.safeParse(JSON.parse(outputOf(await collect(rt, "architect")))).success).toBe(true);
    expect(outputOf(await collect(rt, "developer"))).toContain("+++ b/");
    expect(ReviewSchema.safeParse(JSON.parse(outputOf(await collect(rt, "qa")))).success).toBe(true);
  });

  it("supports per-call output overrides", async () => {
    const rt = new FakeRuntime({ outputs: { qa: (n) => `call ${n}` } });
    expect(outputOf(await collect(rt, "qa"))).toBe("call 1");
    expect(outputOf(await collect(rt, "qa"))).toBe("call 2");
  });

  it("stops when the signal aborts", async () => {
    const ac = new AbortController();
    const p = collect(new FakeRuntime({ delayMs: 5000 }), "qa", ac.signal);
    setTimeout(() => ac.abort(new Error("cancelled")), 20);
    await expect(p).rejects.toThrow("cancelled");
  });
});

describe("LlmRuntime", () => {
  it("falls back to a canned line and logs when the endpoint is down", async () => {
    const port = await unusedPort();
    const errors: string[] = [];
    const rt = new LlmRuntime({ baseUrl: `http://127.0.0.1:${port}/v1`, onError: (m) => errors.push(m) });
    const text = outputOf(await collect(rt, "qa"));
    expect(CANNED_LINES.qa).toContain(text);
    expect(errors).toHaveLength(1);
  });

  it("falls back after the timeout when the endpoint hangs", async () => {
    await withServer(
      () => {
        /* never respond */
      },
      async (url) => {
        const errors: string[] = [];
        const rt = new LlmRuntime({ baseUrl: url, timeoutMs: 100, onError: (m) => errors.push(m) });
        const started = Date.now();
        const text = outputOf(await collect(rt, "developer"));
        expect(Date.now() - started).toBeLessThan(3000);
        expect(CANNED_LINES.developer).toContain(text);
        expect(errors).toHaveLength(1);
      },
    );
  });

  it("uses the model line when it passes screening and sends the key as a bearer token", async () => {
    let auth: string | undefined;
    await withServer(
      (req, res) => {
        auth = req.headers.authorization;
        req.resume();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: '  "Ship it."  ' } }] }));
      },
      async (url) => {
        const rt = new LlmRuntime({ baseUrl: url, apiKey: "sekret" });
        expect(outputOf(await collect(rt, "architect"))).toBe("Ship it.");
        expect(auth).toBe("Bearer sekret");
      },
    );
  });

  it("falls back when the model line contains a URL or is too long", async () => {
    for (const content of ["see https://evil.example/x", "visit evil.com now", "x".repeat(200)]) {
      await withServer(
        (req, res) => {
          req.resume();
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ choices: [{ message: { content } }] }));
        },
        async (url) => {
          const errors: string[] = [];
          const rt = new LlmRuntime({ baseUrl: url, onError: (m) => errors.push(m) });
          expect(CANNED_LINES.qa).toContain(outputOf(await collect(rt, "qa")));
          expect(errors).toHaveLength(1);
        },
      );
    }
  });

  it("never puts the api key in the logged error", async () => {
    await withServer(
      (req, res) => {
        req.resume();
        res.statusCode = 500;
        res.end("sekret");
      },
      async (url) => {
        const errors: string[] = [];
        const rt = new LlmRuntime({ baseUrl: url, apiKey: "sekret", onError: (m) => errors.push(m) });
        await collect(rt, "qa");
        expect(errors.join("")).not.toContain("sekret");
      },
    );
  });

  it("uses canned lines without logging when no endpoint is configured", async () => {
    const errors: string[] = [];
    const rt = new LlmRuntime({ baseUrl: "", onError: (m) => errors.push(m) });
    expect(CANNED_LINES.architect).toContain(outputOf(await collect(rt, "architect")));
    expect(errors).toEqual([]);
  });

  it("screenLine accepts plain text and rejects links", () => {
    expect(screenLine("Looks fine to me.")).toBe("Looks fine to me.");
    expect(screenLine("go to www.x.org")).toBeUndefined();
    expect(screenLine("")).toBeUndefined();
  });
});

describe("killTree", () => {
  it("kills a running child process", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true,
    });
    const exited = new Promise<void>((r) => child.once("exit", () => r()));
    await killTree(child.pid!);
    await Promise.race([exited, new Promise((_, rej) => setTimeout(() => rej(new Error("child still alive")), 5000))]);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it("ignores invalid pids", async () => {
    await expect(killTree(0)).resolves.toBeUndefined();
  });
});
