// Throwaway spike for agent-pipeline tasks 4-5: does `kiro-cli chat --v3 --no-interactive` read the prompt from stdin,
// and does the architect agent answer with one json block?
// Usage: node --env-file=.env --experimental-strip-types --no-warnings packages/agent-engine/spikes/stdin-spike.mjs
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installAgents } from "../src/agents.ts";
import { loadPromptTemplate, renderPrompt, fence } from "../src/prompts.ts";
import { materialise } from "../src/steps/materialise.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const kiroHome = path.join(root, "data", "kiro-home");
installAgents({ kiroHome });
const repo = await materialise({ repo: { id: "haunted-todo", source: "fixtures/repos/haunted-todo" } });

const prompt = renderPrompt(loadPromptTemplate("architect"), { goal: fence("Fix the known bug and add validation.") });
const env = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA,
  KIRO_HOME: kiroHome, KIRO_API_KEY: process.env.KIRO_API_KEY,
};
const args = ["chat", "--v3", "--no-interactive", "--output-format", "stream-json", "--model", "claude-haiku-5.5", "--agent", "agentlife-architect"];
const t0 = Date.now();
const child = spawn("kiro-cli", args, { cwd: repo.dir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
let out = "";
let err = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (err += d));
child.stdin.end(prompt);
child.on("close", (code) => {
  const lines = out.split("\n").filter(Boolean);
  const types = {};
  for (const l of lines) {
    try { const t = JSON.parse(l).type; types[t] = (types[t] ?? 0) + 1; } catch { types.invalid = (types.invalid ?? 0) + 1; }
  }
  const fin = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((r) => r?.type === "runFinished");
  console.log(JSON.stringify({ code, ms: Date.now() - t0, lines: lines.length, types, stderrTail: err.trim().split("\n").slice(-5) }));
  console.log("finalText:", fin?.data?.finalText?.slice(-1500));
  console.log("runError:", lines.filter((l) => l.includes('"runError"')).join("\n").slice(0, 600));
});
