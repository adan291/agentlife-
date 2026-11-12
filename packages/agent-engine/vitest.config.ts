import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// config/agents.json uses kiro-cli; tests and CI run on FakeRuntime unless a test opts out with vi.stubEnv.
// Engines started by tests must never read the developer's data files (projects, teams, imports). They get files that do
// not exist, in a folder made for this run, so a test that forgets to pass its own file cannot leave anything behind for
// the next run. A test that needs a file passes its own (`projectsFile`, `team.file`, `imports.file`).
const scratch = mkdtempSync(path.join(os.tmpdir(), "agentlife-vitest-"));

export default defineConfig({
  test: {
    // Tests that run git (project registry, delivery) take several seconds on Windows when all packages test in parallel.
    testTimeout: 30_000,
    env: {
      RUNTIME: "fake",
      AGENTLIFE_PROJECTS_FILE: path.join(scratch, "no-projects.json"),
      AGENTLIFE_TEAMS_FILE: path.join(scratch, "no-teams.json"),
      AGENTLIFE_IMPORTS_FILE: path.join(scratch, "no-imports.json"),
      AGENTLIFE_PROJECT_ROOTS: "",
    },
  },
});
