# Implementation Plan

- [x] 1. Engine API schemas in shared
  - `shared/src/engine-api.ts`: Repo, StartJobBody, ApprovalBody, JobView, Plan, Review, RunExport
  - Tests for valid and invalid samples
  - _Requirements: 1.2, 2.4_

- [ ] 2. Config loading
  - `agent-engine/config/{agents,repos,limits}.json` with zod validation and clear startup errors; paths resolved with `fileURLToPath`
  - Placeholder repo entry `haunted-todo` (source filled in agent-pipeline)
  - _Requirements: 4.2, 6.1_

- [ ] 3. Store and event log
  - better-sqlite3 schema, `appendEvent`, artifact write/read under `data/runs/<taskId>/`, `foldJob`
  - Property test: fold of random event sequences equals incremental view
  - _Requirements: 2.1, 2.3, 7.2_

- [ ] 4. Transition table
  - `jobs/transitions.ts` with `assertTransition`; unit tests for every allowed and a sample of forbidden transitions
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 5. Runtime interface, FakeRuntime and LlmRuntime
  - `runtimes/types.ts`, `fake.ts`, `llm.ts` (timeout, screening, canned fallback), `kill-tree.ts`
  - Tests: LlmRuntime falls back when endpoint is down (use an unused local port)
  - _Requirements: 4.1, 4.3, 4.4_

- [ ] 6. JobRunner
  - Injected `Steps`, visual script (anchors and states), approval wait, QA retry once, timeouts, cancellation, one active job, restart recovery
  - fast-check property test of requirement 3.6
  - _Requirements: 3.4, 3.5, 3.6, 5.1, 5.2, 5.3_

- [ ] 7. HTTP server and routes
  - node:http router, zod validation, 400/404/409, token header, bind 127.0.0.1:8788
  - Route tests on an ephemeral port
  - _Requirements: 1.1, 1.3, 1.4, 6.2, 6.3_

- [ ] 8. SSE events endpoint
  - Replay + live without gaps, `Last-Event-ID`, heartbeat
  - Reconnection test from requirement 2.2
  - _Requirements: 2.2_

- [ ] 9. Export and observability
  - `GET /tasks/:id/export`, JSON-lines logger, per-step metrics, secret redaction test
  - _Requirements: 2.4, 7.1, 7.3, 7.4_

- [ ] 10. HttpEngineLink in world-server
  - `world-server/src/http-engine.ts` implementing EngineLink over the API + SSE (with reconnect using last seq); `ENGINE=http` selects it
  - Manual check: client + world-server + engine with RUNTIME=fake complete a job end to end
  - _Requirements: 1.1, 2.2_
