# Tech stack and conventions

- Node.js >= 22, pnpm workspaces, TypeScript (strict). ES modules only.
- Server packages run TypeScript directly: `node --experimental-strip-types`. Import local files with the `.ts` extension.
- Client: Vite + PixiJS v8. No UI framework; panels are plain DOM + CSS.
- Protocol and event schemas live in `@agentlife/shared` as zod schemas. Both ends validate with them; never hand-roll a message type elsewhere.
- Tests: Vitest. Use fast-check property-based tests for geometry (iso projection, depth sort, pathfinding) and for the job state machine.
- Commands: `pnpm check` (typecheck + tests), `pnpm --filter @agentlife/client dev`, `pnpm --filter @agentlife/client build`.

## Portability (we develop on Windows, CI runs Linux and Windows)
- Build file paths with `node:path` and `fileURLToPath(import.meta.url)`. Never use `new URL(...).pathname` as a file path.
- package.json scripts must not rely on bash (`&&` chains of pnpm are fine; no `trap`, `rm -rf`, `true`).

## Boundaries
- The client talks only to the world-server.
- The world-server talks to the agent-engine over HTTP (commands) and SSE (events). It never calls a model.
- The agent-engine knows nothing about tiles or sprites; it speaks semantic anchors (`desk`, `board`, `computer`, `mailbox`).
- Model providers sit behind the `AgentRuntime` interface in agent-engine. Switching model or provider must not touch client or world-server.
