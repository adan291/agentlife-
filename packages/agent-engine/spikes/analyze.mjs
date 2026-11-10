// Throwaway: summarise stream-json records of a spike run. Usage: node analyze.mjs <dir>
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
  const kinds = {}; const tools = []; const extra = [];
  for (const line of readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean)) {
    const j = JSON.parse(line);
    const u = j.data?.update;
    const k = u ? `${j.type}/${u.sessionUpdate}` : j.type;
    kinds[k] = (kinds[k] ?? 0) + 1;
    if (u && /tool_call/.test(u.sessionUpdate)) tools.push({ k: u.sessionUpdate, title: u.title, kind: u.kind, status: u.status, raw: JSON.stringify(u.rawInput ?? "").slice(0, 120), content: JSON.stringify(u.content ?? "").slice(0, 200) });
    const s = JSON.stringify(j);
    const m = s.match(/"(credit[^"]*|usage[^"]*|tokens?[^"]*|inputTokens|outputTokens)":[^,}]+/gi);
    if (m) extra.push(...m.slice(0, 5));
    if (j.type === "runStarted") extra.push("runStarted:" + s.slice(0, 400));
  }
  console.log("==", f); console.log(kinds);
  const seen = new Set();
  for (const t of tools) { const key = JSON.stringify(t); if (!seen.has(key)) { seen.add(key); console.log(" tool", key); } }
  console.log(" extra", [...new Set(extra)].slice(0, 12));
}
