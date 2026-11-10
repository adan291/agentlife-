import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { RUNNER_IMAGE } from "../src/steps/test.ts";

/**
 * Builds the test-runner image. The build context is a temporary directory with the Dockerfile and the
 * package.json and package-lock.json of the repository named by argv[2] (default: the first in config/repos.json).
 */
const repos = loadConfig().repos;
const wanted = process.argv[2];
const repo = wanted ? repos.find((r) => r.id === wanted) : repos[0];
if (!repo) {
  console.error(`runner:build: unknown repo '${wanted ?? ""}'. Known: ${repos.map((r) => r.id).join(", ")}`);
  process.exit(1);
}

const dockerfile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "docker", "runner.Dockerfile");
const source = path.resolve(PROJECT_ROOT, repo.source);
const context = mkdtempSync(path.join(os.tmpdir(), "agentlife-runner-"));
try {
  copyFileSync(dockerfile, path.join(context, "Dockerfile"));
  for (const f of ["package.json", "package-lock.json"]) copyFileSync(path.join(source, f), path.join(context, f));
  console.log(`runner:build: building ${RUNNER_IMAGE} for ${repo.id}`);
  const res = spawnSync("docker", ["build", "--tag", RUNNER_IMAGE, context], { stdio: "inherit", windowsHide: true });
  if (res.error) {
    console.error(`runner:build: cannot start docker: ${res.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = res.status ?? 1;
  }
} finally {
  rmSync(context, { recursive: true, force: true });
}
