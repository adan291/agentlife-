// Conductor: takes every spec in docs/TASKMAP.md to 100% without supervision between steps.
//
//   pnpm conduct            run the next spec in the taskmap until it is merged, then the next one
//   pnpm conduct --once     only the next spec
//   pnpm conduct --dry-run  print the plan
//
// For each spec: build sessions (scripts/run-session.ts) -> review (agentlife-reviewer) ->
// acceptance verification (agentlife-verifier) -> if FAIL, one fix session and verify again
// (max 2 rounds) -> merge into main with `pnpm check` and the leak scanner -> push only when
// AGENTLIFE_PUSH=1. Any red light stops the conductor and notifies the user.
// Specs marked `live` in the taskmap stop after the merge and wait for the human check.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Item { spec: string; sessions: string[]; live: boolean; status: string }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TASKMAP = join(ROOT, "docs", "TASKMAP.md");
const NOREPLY = "14869836+adan291@users.noreply.github.com";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "adan291", GIT_AUTHOR_EMAIL: NOREPLY, GIT_COMMITTER_NAME: "adan291", GIT_COMMITTER_EMAIL: NOREPLY };
const args = new Set(process.argv.slice(2));

function sh(cmd: string, a: string[], inherit = false): { code: number; out: string } {
  // Only pnpm needs a shell on Windows (it is a .cmd shim). kiro-cli is a real executable: through a shell its
  // multi-word prompt would be split into separate arguments (that is how review and verification got lost).
  const shell = process.platform === "win32" && cmd === "pnpm";
  const r = spawnSync(cmd, a, { cwd: ROOT, encoding: "utf8", env: GIT_ENV, shell, windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: inherit ? "inherit" : "pipe" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function say(msg: string): void {
  console.log(`[conduct] ${msg}`);
}

function notify(msg: string): void {
  sh(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "scripts", "notify.ts"), "--auto", `AGENT LIFE conductor: ${msg}`]);
}

function stop(msg: string): never {
  say(`STOP: ${msg}`);
  notify(`parado. ${msg}`);
  process.exit(1);
}

/** Rows of the taskmap table: | order | spec | sessions | live | status | ... */
function loadTaskmap(): Item[] {
  if (!existsSync(TASKMAP)) stop("docs/TASKMAP.md not found");
  const items: Item[] = [];
  for (const line of readFileSync(TASKMAP, "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || !/^\d+$/.test(cells[1] ?? "")) continue;
    const spec = (cells[2] ?? "").replace(/`/g, "");
    const sessions = (cells[3] ?? "").split(/[ ,]+/).filter((s) => /^S\d+[A-Z]?$/.test(s));
    items.push({ spec, sessions, live: /yes|sí/i.test(cells[4] ?? ""), status: (cells[5] ?? "").toLowerCase() });
  }
  return items;
}

function specDone(spec: string): boolean {
  const f = join(ROOT, ".kiro", "specs", spec, "tasks.md");
  if (!existsSync(f)) return false;
  const t = readFileSync(f, "utf8");
  const total = (t.match(/^- \[[ x]\]/gm) ?? []).length;
  return total > 0 && (t.match(/^- \[x\]/gm) ?? []).length === total;
}

function onMain(): void {
  if (sh("git", ["status", "--porcelain"]).out.trim()) stop("the working tree has uncommitted changes");
  if (sh("git", ["switch", "main"]).code !== 0) stop("could not switch to main");
}

function runSession(id: string): void {
  say(`session ${id}`);
  // The runner may switch to main and ask for a restart once.
  for (let i = 0; i < 2; i++) {
    const r = sh("pnpm", ["-s", "session", id], true);
    if (r.code === 0) return;
    if (r.code === 2) continue;
    stop(`session ${id} did not finish cleanly (see data/sessions/log.md and docs/STATUS.md)`);
  }
}

function branchOf(spec: string): string {
  return `feat/${spec}`;
}

function verify(spec: string): "PASS" | "FAIL" {
  const branch = branchOf(spec);
  if (sh("git", ["switch", branch]).code !== 0) stop(`branch ${branch} not found`);
  say(`review of ${branch}`);
  const rv = sh("kiro-cli", ["chat", "--v3", "--agent", "agentlife-reviewer", "--model", "claude-haiku-5.5", "--no-interactive", "Review the current branch against main."]);
  if (rv.code !== 0) stop(`the reviewer failed for ${spec} (exit ${rv.code})`);
  say(`acceptance verification of ${spec}`);
  const vf = sh("kiro-cli", ["chat", "--v3", "--agent", "agentlife-verifier", "--no-interactive", `Verify branch ${branch} against the ${spec} spec.`]);
  if (vf.code !== 0) stop(`the verifier failed for ${spec} (exit ${vf.code})`);
  const report = join(ROOT, "docs", "reviews", `${branch.replace(/\//g, "-")}-verify.md`);
  if (!existsSync(report)) stop(`the verifier wrote no report for ${spec}`);
  const verdict = /^VERDICT:\s*PASS/m.test(readFileSync(report, "utf8")) ? "PASS" : "FAIL";
  sh("git", ["add", "docs/reviews"]);
  sh("git", ["commit", "-q", "-m", `review: ${spec} review and verification (${verdict})`]);
  say(`${spec}: ${verdict}`);
  return verdict;
}

function fixSession(spec: string, round: number): void {
  const branch = branchOf(spec);
  const prompt = `Fix every FAIL listed in docs/reviews/${branch.replace(/\//g, "-")}-verify.md and every blocking issue in docs/reviews/${branch.replace(/\//g, "-")}.md for the ${spec} spec, on branch ${branch}. Do not start other tasks. Follow workflow.md.`;
  say(`fix round ${round} for ${spec}`);
  sh("git", ["switch", "main"]);
  const r = sh("kiro-cli", ["chat", "--v3", "--agent", "agentlife-builder", "--model", "claude-sonnet-5.5", "--no-interactive", prompt], true);
  if (r.code !== 0) stop(`fix session for ${spec} failed`);
}

function merge(spec: string): void {
  const branch = branchOf(spec);
  onMain();
  const m = sh("git", ["merge", "--no-ff", branch, "-m", `merge: ${spec}`]);
  if (m.code !== 0) {
    const conflicts = sh("git", ["diff", "--name-only", "--diff-filter=U"]).out.trim().split("\n").filter(Boolean);
    // STATUS.md is the only file both sides edit routinely: keep the branch's notes.
    if (conflicts.length === 1 && conflicts[0] === "docs/STATUS.md") {
      sh("git", ["checkout", "--theirs", "docs/STATUS.md"]);
      sh("git", ["add", "docs/STATUS.md"]);
      sh("git", ["commit", "-q", "--no-edit"]);
    } else {
      sh("git", ["merge", "--abort"]);
      stop(`merge of ${branch} has conflicts in: ${conflicts.join(", ")}`);
    }
  }
  sh("pnpm", ["install"]);
  if (sh("pnpm", ["check"]).code !== 0) stop(`pnpm check fails on main after merging ${spec}`);
  if (sh("pnpm", ["-s", "security:scan"]).code !== 0) stop(`the leak scanner has findings after merging ${spec}`);
  if (process.env.AGENTLIFE_PUSH === "1") {
    if (sh("git", ["push", "origin", "main"]).code !== 0) stop("push to GitHub failed");
    say("pushed main");
  }
  say(`${spec} merged`);
  notify(`${spec} terminado al 100 % (revisado, verificado y fusionado).`);
}

function conduct(item: Item): void {
  onMain();
  if (!specDone(item.spec)) for (const s of item.sessions) runSession(s);
  if (!specDone(item.spec)) stop(`${item.spec} still has unchecked tasks after its sessions`);
  let verdict = verify(item.spec);
  for (let round = 1; verdict === "FAIL" && round <= 2; round++) {
    fixSession(item.spec, round);
    verdict = verify(item.spec);
  }
  if (verdict === "FAIL") stop(`${item.spec} still fails verification after 2 fix rounds; see docs/reviews/`);
  merge(item.spec);
  if (item.live) stop(`${item.spec} is merged and needs the human live check listed in its verify report before the next spec`);
}

const items = loadTaskmap().filter((i) => i.status !== "done" && i.status !== "skip");
if (args.has("--dry-run")) {
  for (const i of items) console.log(`${i.spec.padEnd(18)} sessions ${i.sessions.join(",").padEnd(10)} live=${i.live} status=${i.status}`);
  process.exit(0);
}
if (items.length === 0) {
  say("nothing left in the taskmap");
  process.exit(0);
}
for (const item of args.has("--once") ? items.slice(0, 1) : items) conduct(item);
say("taskmap complete");
notify("todas las specs del taskmap están terminadas.");
