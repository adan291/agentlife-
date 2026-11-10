// Runs one planned Kiro session unattended with the model and effort fixed in scripts/sessions.json.
//
//   pnpm session next            run the first session not yet completed
//   pnpm session S3              run a specific session
//   pnpm session S3 --dry-run    print the command without running it
//   pnpm session S3 --review     also run the read-only reviewer afterwards
//   pnpm session list            show sessions and their status
//
// The model is never downgraded or upgraded: if the planned model is not available to the
// logged-in account, the run stops before spending anything.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Session {
  id: string;
  spec: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  prompt: string;
  interactive?: boolean;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = join(ROOT, "scripts", "sessions.json");
// Kept in git-ignored data/ so it works across feature branches and never dirties the tree.
const LOG = join(ROOT, "data", "sessions", "log.md");
const RUNS = join(ROOT, "data", "sessions");
const BUILDER = "agentlife-builder";
const REVIEWER = "agentlife-reviewer";
const REVIEWER_MODEL = "claude-haiku-5.5";

function fail(msg: string): never {
  console.error(`\n[session] ${msg}`);
  process.exit(1);
}

function loadPlan(): Session[] {
  const raw = JSON.parse(readFileSync(PLAN, "utf8")) as { sessions?: Session[] };
  if (!Array.isArray(raw.sessions)) fail("scripts/sessions.json has no sessions array");
  return raw.sessions;
}

function completedIds(): Set<string> {
  if (!existsSync(LOG)) return new Set();
  const done = new Set<string>();
  for (const line of readFileSync(LOG, "utf8").split("\n")) {
    const m = /^\| (S\d+) \|.*\| ok \|/.exec(line);
    if (m?.[1]) done.add(m[1]);
  }
  return done;
}

/** The builder records blockers in docs/STATUS.md and commit messages instead of failing (it runs
 *  unattended). Exit code 0 therefore does not mean the tasks were done. */
function blockerSince(startRef: string): string | null {
  const msgs = run("git", ["log", "--format=%s", `${startRef}..HEAD`]).out;
  // Only lines this session added to STATUS.md, so an old, already-resolved blocker does not count.
  const added = run("git", ["diff", "-U0", `${startRef}..HEAD`, "--", "docs/STATUS.md"]).out
    .split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  const line = [...msgs.split("\n"), ...added].find((l) => /\bBLOCK(ER|ED)\b|\bblocker\b|\bFAILED\b|check failed|not marked done/.test(l));
  return line ? line.trim().slice(0, 300) : null;
}

function recordRun(s: Session, status: "ok" | "failed" | "blocked", minutes: number, logFile: string): void {
  if (!existsSync(LOG)) {
    mkdirSync(dirname(LOG), { recursive: true });
    writeFileSync(LOG, "# Session log\n\nWritten by scripts/run-session.ts.\n\n| Session | Date | Model | Effort | Minutes | Status | Raw log |\n|---|---|---|---|---|---|---|\n");
  }
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const rel = logFile.slice(ROOT.length + 1).replaceAll("\\", "/");
  appendFileSync(LOG, `| ${s.id} | ${date} | ${s.model} | ${s.effort} | ${minutes.toFixed(1)} | ${status} | ${rel} |\n`);
}

function run(cmd: string, args: string[]): { code: number; out: string } {
  // pnpm is a .cmd/.ps1 shim on Windows and cannot be spawned without a shell. Args here are fixed
  // literals from this file, never user or model input, so the shell is safe.
  const shell = cmd === "pnpm" && process.platform === "win32";
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, shell });
  if (r.error) fail(`could not run ${cmd}: ${r.error.message}`);
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function availableModels(): Set<string> {
  const r = run("kiro-cli", ["chat", "--list-models", "--format", "json"]);
  const start = r.out.indexOf("{");
  if (r.code !== 0 || start < 0) fail(`kiro-cli --list-models failed:\n${r.out}`);
  const data = JSON.parse(r.out.slice(start)) as { models: { model_id: string }[] };
  return new Set(data.models.map((m) => m.model_id));
}

function preflight(s: Session, models: Set<string>): void {
  if (!models.has(s.model)) {
    fail(
      `${s.id} is planned for model "${s.model}", which this account cannot use.\n` +
        `Available: ${[...models].join(", ")}\n` +
        `Not substituting another model. Log in with the account that has the credits (kiro-cli logout; kiro-cli login) or change the plan in scripts/sessions.json.`,
    );
  }
  const status = run("git", ["status", "--porcelain"]);
  if (status.out.trim() !== "") fail("working tree has uncommitted changes; commit or stash them first.");
}

function kiroArgs(agent: string, model: string, effort: string, prompt: string, headless: boolean): string[] {
  const args = ["chat", "--v3", "--agent", agent, "--model", model];
  // "auto" picks its own model per request and offers no effort levels (kiro-cli warns and ignores it).
  if (model !== "auto") args.push("--effort", effort);
  if (headless) args.push("--no-interactive", "--output-format", "stream-json");
  args.push(prompt);
  return args;
}

/** Best-effort Discord message via scripts/notify.ts (no Kiro credits). Never fails the session. */
function notify(text: string): void {
  if (process.env.AGENTLIFE_NOTIFY === "0") return;
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "notify.ts"), text], { cwd: ROOT, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) console.warn(`[session] Discord notification skipped: ${(r.stderr ?? "").trim()}`);
}

function quote(a: string): string {
  return /[\s"]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a;
}

/** KIRO_API_KEY from the git-ignored .env, passed only through the child environment. The agents
 *  are denied reading .env, so the key never enters a prompt, a log or a commit. */
function sessionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const file = join(ROOT, ".env");
  if (!env.KIRO_API_KEY && existsSync(file)) {
    const line = readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.startsWith("KIRO_API_KEY="));
    const key = line?.slice("KIRO_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    if (key) env.KIRO_API_KEY = key;
  }
  return env;
}

async function runHeadless(label: string, args: string[], logFile: string): Promise<number> {
  mkdirSync(RUNS, { recursive: true });
  const out = createWriteStream(logFile);
  console.log(`[session] ${label}: running (raw log: ${logFile})`);
  const env = sessionEnv();
  console.log(`[session] KIRO_API_KEY ${env.KIRO_API_KEY ? "available to the session" : "not set"}`);
  const child = spawn("kiro-cli", args, { cwd: ROOT, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => {
    out.write(chunk);
    process.stdout.write(".");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    out.write(chunk);
    process.stderr.write(chunk);
  });
  const code = await new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)));
  out.end();
  console.log(`\n[session] ${label}: exit code ${code}`);
  return code;
}

async function main(): Promise<void> {
  const [target, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  const review = flags.includes("--review");
  const plan = loadPlan();
  const done = completedIds();

  if (!target || target === "list") {
    for (const s of plan) console.log(`${done.has(s.id) ? "[x]" : "[ ]"} ${s.id.padEnd(4)} ${s.spec.padEnd(15)} ${s.model.padEnd(18)} ${s.effort.padEnd(7)} ${s.interactive ? "(interactive)" : ""}`);
    return;
  }

  const session = target === "next" ? plan.find((s) => !done.has(s.id)) : plan.find((s) => s.id.toLowerCase() === target.toLowerCase());
  if (!session) fail(target === "next" ? "all sessions are completed." : `unknown session ${target}`);

  const headless = !session.interactive;
  const args = kiroArgs(BUILDER, session.model, session.effort, session.prompt, headless);
  const effort = session.model === "auto" ? "n/a (auto)" : session.effort;
  console.log(`[session] ${session.id} | spec ${session.spec} | model ${session.model} | effort ${effort}${headless ? "" : " | interactive"}`);

  if (dryRun) {
    console.log(`kiro-cli ${args.map(quote).join(" ")}`);
    return;
  }

  preflight(session, availableModels());

  if (!headless) {
    console.log("[session] This session needs you at the keyboard. Starting an interactive chat with the planned model.");
    const r = spawnSync("kiro-cli", args, { cwd: ROOT, stdio: "inherit" });
    recordRun(session, r.status === 0 ? "ok" : "failed", 0, join(RUNS, "interactive"));
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join(RUNS, `${session.id}-${stamp}.jsonl`);
  const started = Date.now();
  const startRef = run("git", ["rev-parse", "HEAD"]).out.trim();
  const code = await runHeadless(session.id, args, logFile);

  const check = run("pnpm", ["check"]);
  const blocker = code === 0 && check.code === 0 ? blockerSince(startRef) : null;
  const ok = code === 0 && check.code === 0 && !blocker;
  recordRun(session, blocker ? "blocked" : ok ? "ok" : "failed", (Date.now() - started) / 60000, logFile);
  console.log(`[session] pnpm check: ${check.code === 0 ? "passed" : "FAILED"}`);
  const mins = ((Date.now() - started) / 60000).toFixed(0);
  notify(blocker
    ? `AGENT LIFE: ${session.id} (${session.spec}) BLOQUEADA tras ${mins} min. Motivo: ${blocker}`
    : ok
      ? `AGENT LIFE: ${session.id} (${session.spec}) terminada en ${mins} min con ${session.model}. pnpm check OK. Revisa los créditos gastados.`
      : `AGENT LIFE: ${session.id} (${session.spec}) FALLÓ tras ${mins} min (kiro-cli ${code}, pnpm check ${check.code}). No lances la siguiente; mira docs/STATUS.md.`);
  if (blocker) fail(`${session.id} is blocked: ${blocker}\nResolve it, then run: pnpm session ${session.id}`);
  if (!ok) fail(`${session.id} did not finish cleanly. Read docs/STATUS.md and ${logFile}. Do not run the next session until this is fixed.`);

  if (review) {
    const reviewLog = join(RUNS, `${session.id}-${stamp}-review.jsonl`);
    await runHeadless("review", kiroArgs(REVIEWER, REVIEWER_MODEL, "low", "Review the current branch against main.", true), reviewLog);
    console.log("[session] review written to docs/reviews/");
  }
  console.log(`[session] ${session.id} done. Check the spend in your Kiro usage panel before the next one.`);
}

await main();
