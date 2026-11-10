// Posts to the project's Discord channel without spending Kiro credits.
//
//   pnpm notify "text"     post the text as-is
//   add --dry-run to print instead of posting
//   pnpm notify --status   post a status summary: task counts and dates are computed here,
//                          the short narrative is written by local Ollama (skipped if Ollama is down)
//
// Discord credentials: DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID / DISCORD_USER_ID env vars, or the
// Kiro Crew bot (token from ~/.kiro/crew config or .env). Default target: DM to the first
// discord.allowed_user_ids entry.
// The token is only sent to discord.com and is never printed.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPECS = ["world-room", "agent-engine", "agent-pipeline", "demo-replay"];
const DEADLINE = Date.parse("2026-12-04T22:00:00Z"); // 14:00 PT
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";

function git(args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

async function discordTarget(): Promise<{ token: string; channel: string }> {
  let token = process.env.DISCORD_BOT_TOKEN ?? "";
  let channel = process.env.DISCORD_CHANNEL_ID ?? "";
  let userId = process.env.DISCORD_USER_ID ?? "";
  const crewDir = join(homedir(), ".kiro", "crew");
  const crew = join(crewDir, "config.json");
  if (existsSync(crew)) {
    const d = (JSON.parse(readFileSync(crew, "utf8")) as { discord?: { bot_token?: string; allowed_user_ids?: string[] } }).discord;
    token ||= d?.bot_token ?? "";
    userId ||= d?.allowed_user_ids?.[0] ?? "";
  }
  // Crew keeps the token in its .env when config.json leaves it blank.
  const crewEnv = join(crewDir, ".env");
  if (!token && existsSync(crewEnv)) {
    const line = readFileSync(crewEnv, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.startsWith("DISCORD_BOT_TOKEN="));
    token = line?.slice("DISCORD_BOT_TOKEN=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  }
  if (!token) throw new Error("no Discord bot token (set DISCORD_BOT_TOKEN)");
  // Default target is a DM to the Crew allowed user, the same place Crew answers by default.
  if (!channel && userId) {
    const res = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient_id: userId }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Discord DM channel: ${res.status}`);
    channel = ((await res.json()) as { id: string }).id;
  }
  if (!channel) throw new Error("no Discord channel or user (set DISCORD_CHANNEL_ID or DISCORD_USER_ID)");
  return { token, channel };
}

async function post(text: string): Promise<void> {
  const { token, channel } = await discordTarget();
  for (let i = 0; i < text.length; i += 1900) {
    const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(i, i + 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Discord answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Reads a file from the most recently committed branch that has it (work lives on feat/* branches). */
function latest(path: string, branch?: string): string | null {
  const refs = branch ? [branch] : (git(["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"]) ?? "").split("\n").filter(Boolean);
  for (const ref of refs) {
    const out = git(["show", `${ref}:${path}`]);
    if (out !== null) return out;
  }
  return null;
}

function taskCounts(): string[] {
  return SPECS.map((spec) => {
    const branch = git(["rev-parse", "--verify", "--quiet", `feat/${spec}`]) ? `feat/${spec}` : "main";
    const text = latest(`.kiro/specs/${spec}/tasks.md`, branch) ?? "";
    const done = (text.match(/^- \[x\]/gm) ?? []).length;
    const total = (text.match(/^- \[[ x]\]/gm) ?? []).length;
    return `${spec}: ${done}/${total}`;
  });
}

function nextSession(): string {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "run-session.ts"), "next", "--dry-run"], { cwd: ROOT, encoding: "utf8" });
  return /\[session\] (S\d+ \| spec [^|]+\| model \S+)/.exec(r.stdout)?.[1]?.trim() ?? "desconocida";
}

async function ollamaSummary(status: string): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        options: { temperature: 0.2, num_predict: 200 },
        messages: [
          { role: "system", content: "Resumes el estado de un proyecto de software para leerlo en el móvil. Responde en español, máximo 4 frases cortas, sin títulos, sin emojis, sin inventar nada que no esté en el texto." },
          { role: "user", content: status.slice(0, 6000) },
        ],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return text ? text : null;
  } catch {
    return null;
  }
}

async function statusMessage(): Promise<string> {
  const days = Math.ceil((DEADLINE - Date.now()) / 86400000);
  const status = latest("docs/STATUS.md") ?? "";
  const summary = await ollamaSummary(status);
  return [
    "**AGENT LIFE — estado**",
    `Tareas: ${taskCounts().join(" · ")}`,
    `Siguiente sesión: ${nextSession()}`,
    `Quedan ${days} días para la entrega (4 dic, 14:00 PT).`,
    summary ?? "_(Ollama no disponible: sin resumen)_",
  ].join("\n");
}

async function main(): Promise<void> {
  const all = process.argv.slice(2);
  const dryRun = all.includes("--dry-run");
  const args = all.filter((a) => a !== "--dry-run");
  const text = args[0] === "--status" ? await statusMessage() : args.join(" ").trim();
  if (dryRun) {
    console.log(text);
    return;
  }
  if (!text) {
    console.error('usage: pnpm notify "text" | pnpm notify --status');
    process.exit(1);
  }
  await post(text);
  console.log("[notify] sent to Discord");
}

main().catch((e: unknown) => {
  console.error(`[notify] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
