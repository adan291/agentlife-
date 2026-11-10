import { defineConfig } from "vitest/config";

// config/agents.json uses kiro-cli; tests and CI run on FakeRuntime unless a test opts out with vi.stubEnv.
export default defineConfig({
  test: { env: { RUNTIME: "fake" } },
});
