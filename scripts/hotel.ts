// `pnpm hotel`: starts the whole hotel with one command.
// Checks what is there (.env, Docker, Ollama, free ports), picks real or scripted agents, starts the engine, waits for
// it, starts the world-server and the client, and opens the browser. Ctrl+C stops all three. See `pnpm hotel --help`.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP, HOTEL_PORTS, decideMode, parseArgs, parseEnvFile } from "./hotel-lib.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const URL_CLIENT = `http://localhost:${HOTEL_PORTS.client}/`;
const DOCKER_DESKTOP = join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe");

const say = (msg: string): void => console.log(`[hotel] ${msg}`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function accepts(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => (s.destroy(), resolve(false)));
  });
}

/** True when something accepts connections on the port, over IPv4 or IPv6 (Vite's `localhost` is often `::1` on Windows). */
async function portInUse(port: number): Promise<boolean> {
  return (await accepts(port, "127.0.0.1")) || (await accepts(port, "::1"));
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(1000);
  }
  return false;
}

/** Stops whatever listens on the port (the user asked for it with --restart). */
function freePort(port: number): void {
  if (WIN) {
    spawnSync("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`], { stdio: "ignore", windowsHide: true });
  } else {
    const r = spawnSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" });
    for (const pid of (r.stdout ?? "").split(/\s+/).filter(Boolean)) spawnSync("kill", [pid]);
  }
}

function dockerUp(): boolean {
  const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "ignore", windowsHide: true, timeout: 15_000 });
  return r.status === 0;
}

async function ollamaUp(base: string): Promise<boolean> {
  try {
    const root = base.replace(/\/v1\/?$/, "");
    const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  if (WIN) spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

const children: { name: string; child: ChildProcess }[] = [];
let stopping = false;

function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  say("stopping the hotel…");
  for (const { child } of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    if (WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}

/** Starts a process whose output is shown with a prefix; a secret value is never printed. */
function run(name: string, cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, hide: string[]): ChildProcess {
  // Only pnpm needs a shell on Windows (it is a .cmd shim); the arguments are fixed here, never user input.
  const child = spawn(cmd, args, { cwd, env, shell: WIN && cmd === "pnpm", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `[${name}]`.padEnd(9);
  const clean = (s: string): string => hide.reduce((t, h) => (h ? t.split(h).join("***") : t), s);
  const pipe = (stream: NodeJS.ReadableStream | null) => {
    let buf = "";
    stream?.on("data", (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) console.log(`${tag} ${clean(l)}`);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("exit", (code) => {
    if (stopping) return;
    say(`${name} stopped (exit ${code ?? "?"}); stopping the rest.`);
    stopAll(code ?? 1);
  });
  children.push({ name, child });
  return child;
}

async function main(): Promise<void> {
  const { options, unknown } = parseArgs(process.argv.slice(2));
  if (options.help) return void console.log(HELP);
  if (unknown.length) {
    console.error(`[hotel] unknown option: ${unknown.join(" ")}\n\n${HELP}`);
    process.exit(2);
  }

  if (!existsSync(join(ROOT, "node_modules"))) {
    say("first run: installing dependencies (pnpm install)…");
    if (spawnSync("pnpm", ["install"], { cwd: ROOT, stdio: "inherit", shell: WIN }).status !== 0) process.exit(1);
  }

  // Ports.
  for (const [name, port] of Object.entries(HOTEL_PORTS)) {
    if (!(await portInUse(port))) continue;
    if (!options.restart) {
      console.error(`[hotel] port ${port} (${name}) is already in use: the hotel may already be running at ${URL_CLIENT}\n        Run \`pnpm hotel --restart\` to stop it and start again.`);
      process.exit(1);
    }
    say(`port ${port} (${name}) is in use: stopping it (--restart)`);
    freePort(port);
    await waitFor(async () => !(await portInUse(port)), 10_000);
  }

  // Settings from .env (only the known keys) and the environment, which wins.
  const envPath = join(ROOT, ".env");
  const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
  const kiroKey = process.env["KIRO_API_KEY"] ?? fileEnv.KIRO_API_KEY ?? "";
  const engineToken = process.env["ENGINE_TOKEN"] ?? fileEnv.ENGINE_TOKEN ?? "";

  // Docker: real jobs run their tests there. On Windows start Docker Desktop if it is installed and not running.
  let docker = options.fake ? false : dockerUp();
  if (!options.fake && !docker && kiroKey && WIN && existsSync(DOCKER_DESKTOP)) {
    say("starting Docker Desktop (real jobs run their tests in Docker)…");
    spawn(DOCKER_DESKTOP, [], { stdio: "ignore", detached: true }).unref();
    docker = await waitFor(async () => dockerUp(), 120_000);
    say(docker ? "Docker is up." : "Docker did not start in 2 minutes.");
  }

  const mode = decideMode({ options, hasKiroKey: kiroKey !== "", dockerUp: docker });
  for (const n of mode.notes) say(n);

  // Ollama (optional): ambient phrases and the Library's intern.
  const llmBase = process.env["LLM_BASE_URL"] ?? fileEnv.LLM_BASE_URL ?? "http://127.0.0.1:11434/v1";
  const llmModel = process.env["LLM_MODEL"] ?? fileEnv.LLM_MODEL ?? "qwen3.5:4b";
  const ollama = await ollamaUp(llmBase);
  say(ollama ? `Ollama found (${llmModel}).` : "Ollama not found: no ambient phrases (optional, https://ollama.com).");

  // 1. Engine. Only the engine gets the Kiro key.
  const engineEnv: NodeJS.ProcessEnv = { ...process.env };
  delete engineEnv["RUNTIME"];
  if (mode.runtime === "fake") engineEnv["RUNTIME"] = "fake";
  if (kiroKey) engineEnv["KIRO_API_KEY"] = kiroKey;
  if (engineToken) engineEnv["ENGINE_TOKEN"] = engineToken;
  if (ollama) Object.assign(engineEnv, { LLM_BASE_URL: llmBase, LLM_MODEL: llmModel });
  say("starting the engine…");
  run("engine", process.execPath, ["--experimental-strip-types", "--no-warnings", "src/main.ts"], join(ROOT, "packages", "agent-engine"), engineEnv, [kiroKey, engineToken]);
  const engineUp = await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${HOTEL_PORTS.engine}/health`, { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      return false;
    }
  }, 120_000);
  if (!engineUp) {
    console.error("[hotel] the engine did not answer in 2 minutes; see the [engine] lines above.");
    return stopAll(1);
  }

  // 2. World-server, then 3. client. Neither gets the Kiro key.
  const shared: NodeJS.ProcessEnv = { ...process.env };
  delete shared["KIRO_API_KEY"];
  say("starting the world-server…");
  run("world", process.execPath, ["--experimental-strip-types", "--no-warnings", "src/main.ts"], join(ROOT, "packages", "world-server"), { ...shared, ENGINE: "http", ...(engineToken ? { ENGINE_TOKEN: engineToken } : {}) }, [engineToken]);
  await waitFor(() => portInUse(HOTEL_PORTS.world), 60_000);
  say("starting the client…");
  run("client", "pnpm", ["--filter", "@agentlife/client", "dev"], ROOT, shared, []);
  const clientUp = await waitFor(() => portInUse(HOTEL_PORTS.client), 60_000);
  if (!clientUp) {
    console.error("[hotel] the client did not start in 1 minute; see the [client] lines above.");
    return stopAll(1);
  }

  say("");
  say(`AGENT LIFE is running at ${URL_CLIENT}  (${mode.runtime === "fake" ? "scripted agents" : "real agents"})`);
  say("Ctrl+C stops everything.");
  if (options.open) openBrowser(URL_CLIENT);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
void main().catch((e: unknown) => {
  console.error(`[hotel] ${e instanceof Error ? e.message : String(e)}`);
  stopAll(1);
});
