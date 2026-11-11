import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { buildRunnerImage, type DockerBuildExec } from "../src/steps/runner-image.ts";
import { RUNNER_IMAGE } from "../src/steps/test.ts";

/**
 * Builds the test-runner image of the built-in fixture (`agentlife-runner:1`). The build context holds only the
 * Dockerfile and the repository's package.json and package-lock.json; the same builder (`buildRunnerImage`) makes the
 * per-project images of registered projects when their first job reaches the test step.
 * argv[2] names the repo (default: the first in config/repos.json).
 */
const repos = loadConfig().repos;
const wanted = process.argv[2];
const repo = wanted ? repos.find((r) => r.id === wanted) : repos[0];
if (!repo) {
  console.error(`runner:build: unknown repo '${wanted ?? ""}'. Known: ${repos.map((r) => r.id).join(", ")}`);
  process.exit(1);
}

const source = path.resolve(PROJECT_ROOT, repo.source);
const exec: DockerBuildExec = async (args) => {
  const res = spawnSync("docker", [...args], { stdio: "inherit", windowsHide: true });
  return { code: res.status, output: "", ...(res.error ? { spawnError: res.error } : {}) };
};

console.log(`runner:build: building ${RUNNER_IMAGE} for ${repo.id}`);
try {
  await buildRunnerImage({
    tag: RUNNER_IMAGE,
    packageJson: readFileSync(path.join(source, "package.json"), "utf8"),
    lockfile: readFileSync(path.join(source, "package-lock.json"), "utf8"),
    exec,
  });
} catch (e) {
  console.error(`runner:build: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
