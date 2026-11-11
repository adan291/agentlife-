import { defineConfig } from "vitest/config";

export default defineConfig({
  // `e2e/` holds Playwright specs (run with `pnpm e2e`), not Vitest tests.
  test: { include: ["test/**/*.test.ts"] },
});
