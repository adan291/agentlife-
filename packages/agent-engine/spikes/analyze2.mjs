// Throwaway: print finalText and the metering/model fields. Usage: node analyze2.mjs <dir>
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const dir = process.argv[2];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
  const lines = readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const fin = lines.find((l) => l.type === "runFinished");
  console.log("==", f, fin ? JSON.stringify({ ...fin.data, finalText: fin.data.finalText?.slice(0, 300) }) : "no runFinished");
  const withCredits = lines.find((l) => JSON.stringify(l).includes('"credits"'));
  if (withCredits) {
    const s = JSON.stringify(withCredits);
    const i = s.indexOf('"credits"');
    console.log(" credits ctx:", s.slice(Math.max(0, i - 300), i + 300));
  }
  const modelHits = new Set();
  for (const l of lines) { const m = JSON.stringify(l).match(/"(?:modelId|model)":"[^"]+"/g); if (m) m.forEach((x) => modelHits.add(x)); }
  console.log(" model fields:", [...modelHits].slice(0, 6));
}
