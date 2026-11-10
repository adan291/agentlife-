// Throwaway spike for agent-pipeline task 1. Not part of the product.
// Usage: node packages/agent-engine/spikes/kiro-cli-spike.mjs
// Never prints env values. Raw stdout/stderr per case are written to the spike temp dir.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const kiroHome = path.join(root, "data", "kiro-home");
const tmp = mkdtempSync(path.join(tmpdir(), "al-spike-"));
const repo = path.join(tmp, "repo");
const outside = path.join(tmp, "outside.txt");
mkdirSync(repo, { recursive: true });
writeFileSync(path.join(repo, "hello.txt"), "hello spike\n");
const MODEL = "claude-haiku-5.5";

const env = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE,
  APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, TEMP: process.env.TEMP, TMP: process.env.TMP,
  KIRO_HOME: kiroHome, KIRO_API_KEY: process.env.KIRO_API_KEY,
};

function run(name, agent, prompt) {
  const args = ["chat", "--no-interactive", "--output-format", "stream-json", "--trust-all-tools", "--model", MODEL, "--agent", agent, prompt];
  const t0 = Date.now();
  const r = spawnSync("kiro-cli", args, { cwd: repo, env, encoding: "utf8", timeout: 180000, windowsHide: true });
  const ms = Date.now() - t0;
  writeFileSync(path.join(tmp, `${name}.stdout.jsonl`), r.stdout ?? "");
  writeFileSync(path.join(tmp, `${name}.stderr.txt`), r.stderr ?? "");
  const types = {};
  for (const line of (r.stdout ?? "").split(/\r?\n/).filter(Boolean)) {
    try { const j = JSON.parse(line); const k = j.type ?? j.event ?? j.method ?? Object.keys(j).join(","); types[k] = (types[k] ?? 0) + 1; } catch { types["<non-json>"] = (types["<non-json>"] ?? 0) + 1; }
  }
  console.log(JSON.stringify({ name, status: r.status, signal: r.signal, ms, stdoutBytes: (r.stdout ?? "").length, stderrBytes: (r.stderr ?? "").length, types }));
}

console.log("tmp", tmp);
run("read", "spike-ro", "Read hello.txt and reply with its exact content.");
run("write-cwd", "spike-ro", "Create a file named new.txt in the current directory containing 'x'.");
run("write-outside", "spike-ro", `Create the file ${outside} containing 'x'.`);
run("shell", "spike-ro", "Run the shell command `echo shell-ran > shell.txt`.");
run("noagent", "does-not-exist", "Say hi.");
console.log("new.txt exists:", existsSync(path.join(repo, "new.txt")));
console.log("shell.txt exists:", existsSync(path.join(repo, "shell.txt")));
console.log("outside exists:", existsSync(outside));
