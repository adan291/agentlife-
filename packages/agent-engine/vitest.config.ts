import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// config/agents.json uses kiro-cli; tests and CI run on FakeRuntime unless a test opts out with vi.stubEnv.
// Engines started by tests must never read the developer's data/projects.json: a file that does not exist is used
// unless a test passes its own `projectsFile`.
export default defineConfig({
  test: {
    // Tests that run git (project registry, delivery) take several seconds on Windows when all packages test in parallel.
    testTimeout: 30_000,
    env: {
      RUNTIME: "fake",
      AGENTLIFE_PROJECTS_FILE: path.join(os.tmpdir(), "agentlife-vitest-no-projects.json"),
      AGENTLIFE_TEAMS_FILE: path.join(os.tmpdir(), "agentlife-vitest-no-teams.json"),
      AGENTLIFE_PROJECT_ROOTS: "",
    },
  },
});
