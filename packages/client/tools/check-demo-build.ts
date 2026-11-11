import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findLiveEndpoints, isScannable } from "./demo-guard.ts";
import type { Finding } from "./demo-guard.ts";

/**
 * `pnpm --filter @agentlife/client check:demo-build`: builds the client with `VITE_MODE=demo` into a temporary
 * folder and fails if the output holds any live endpoint (see demo-guard.ts). Exit code 1 on findings.
 */
const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "agentlife-demo-"));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

try {
  const vite = resolve(clientDir, "node_modules", "vite", "bin", "vite.js");
  const build = spawnSync(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir", "--base=/agentlife/"], {
    cwd: clientDir,
    env: { ...process.env, VITE_MODE: "demo" },
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error(`demo build failed (exit ${build.status})`);

  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of walk(outDir)) {
    if (!isScannable(file)) continue;
    scanned++;
    findings.push(...findLiveEndpoints(file.slice(outDir.length + 1), readFileSync(file, "utf8")));
  }
  if (scanned === 0) throw new Error("the demo build produced no files to scan");
  if (findings.length > 0) {
    for (const f of findings) console.error(`demo build: ${f.file}: ${f.rule}`);
    process.exitCode = 1;
  } else {
    console.log(`demo build clean: ${scanned} files scanned, no live endpoints`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
