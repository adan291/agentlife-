# Review: feat/hotel-floors (second review, after the review fixes)

Spec: `.kiro/specs/hotel-floors`, tasks 1-5 marked done.
Scope: `git diff main...HEAD` (61 files, +3557 / -283), commits `7d62582` to `7f304f3`.
This review replaces the earlier "request changes" review, whose blocker and the 1.2b failure were addressed in `7f304f3`.

## Verdict: approve

No blocking issues found. Merge after the live checks listed below.

`pnpm check` passes: shared 183 tests, world-server 95, client 349, agent-engine 290 passed and 6 skipped, scripts 14. Playwright (`e2e`, `e2e:demo`) was not run in this review; it needs Edge and the last commits have not been run through it.

## Previous findings, now checked

- Stale deferred messages on return (earlier blocker): not reproducible. `WorldSim.join()` and `leave()` drop the user's deferred messages (`packages/shared/src/world/sim.ts:99,107`). `tick()` drains every room's queue and delivers only the current room's messages (`packages/world-server/src/gateway.ts:637-641`), so messages of rooms the user left are discarded, not replayed.
- Project name on signs (1.2b): fixed. `buildSigns` (`packages/client/src/scene/door-signs.ts`) writes the name over the elevator and the board of project floors, and `world-view.ts:250` adds it on every welcome. The name is sanitised on the server (`signText`) and cut to 16 characters on the client. Lobby and HR get no sign.

## Boundaries and security

- Client talks only to the world-server; the world-server does not call a model (no model imports in `world-server/src`).
- Agent-engine uses ids and projects, not tiles; the room and sprite data stay in shared/world-server.
- Absolute project paths stay in the engine. Engine refuses a non-loopback host without `ENGINE_TOKEN`.
- Client does not use `innerHTML`; Markdown goes through DOM nodes.
- No `new URL(...).pathname` as a file path in the changed code.
- Secrets: `buildMinimalEnv` passes only PATH, SystemRoot, TEMP, TMP, KIRO_API_KEY and KIRO_HOME to kiro-cli; logs go through the redactor.

## Requirements and tasks

- 1.1 to 1.4, 2.1 to 2.4, 3.1 to 3.3, 4.1 to 4.3, 5.3: met, as shown by the tests listed in `feat-hotel-floors-verify.md`.
- 1.2c (removed project): gateway test added in `world-server/test/floors.test.ts`.
- 3.1b (two jobs at once, queue): met in `agent-engine/src/jobs/runner.ts` (`acquireSlot`, `announceQueue`) and `queue.test.ts`.

## Missing tests

- tech.md asks for fast-check property tests on the job state machine. The queue and the per-project rule have only example-based tests (`queue.test.ts`). A property test should check: never more than 2 running jobs, FIFO start order, no project with two unfinished jobs, over random start, cancel and finish sequences.
- No test clicks the "This floor / All floors" control in the terminal; only the model and the server side are tested.

## Non-blocking suggestions

1. `startJob` maps a `busy` 409 from the engine to `engine_unavailable`. Map it to `busy` so the client can show the right message.
2. `Store.scoped()` keeps plain ids silently when a project is unknown. Log it once to catch a wrong scope in the live check.
3. `task.created` clears the floor's reports and approvals from the mailbox. State this in the user-facing notes, or keep earlier reports until the next one.
4. The tick discards deferred agent messages of rooms the user is not in. This is correct today because positions come from the clock, but a future message type that is not derived from time would be lost. Document it in `sim.ts`.

## Live checks before merge (user)

- Lobby and a project floor in a browser: door transition, sign text over the elevator and board, directory and HR drawings.
- "All floors" in the terminal with two projects running.
- A third job with the real engine, to see "Queued (place n)".
- Run `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e` and `pnpm e2e:demo` once on the final commit.
