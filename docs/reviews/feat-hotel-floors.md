# Review: feat/hotel-floors

Spec: `.kiro/specs/hotel-floors` (requirements, design, tasks 1-5 all marked done).
Commits reviewed: `7d62582` to `7b85d4d` (6 commits, 56 files, +3332 / -283).

## Verdict: request changes

One correctness issue in the world-server (messages scoped to the room, requirement 1.4). Everything else reviewed is acceptable.

`pnpm check` passes: shared 182 tests, world-server 94, client 346, agent-engine 290 passed and 6 skipped, scripts 14. `pnpm --filter @agentlife/client check:demo-build` passes (no live endpoints in the demo bundle). Not run in this review: the Playwright suites (`e2e`, `e2e:demo`), which need Edge.

## Blocking issues

1. **Deferred messages of a room the user left are delivered on return.**
   `packages/world-server/src/gateway.ts:636-641` (`tick`) calls `sim.dueMessages()` only for the user's current room. The deferred queue of every other `WorldSim` is never drained while the user is away. `dueMessages()` (`packages/shared/src/world/sim.ts:205-211`) returns everything whose time has passed, so when the user comes back through `enterRoom` (`gateway.ts:309`), the old messages of that room arrive at once, in one burst, after the new welcome. They can include `open_panel` or walk messages from an earlier visit, which breaks requirement 1.4 and the panel order. Not reproduced by a test yet.
   Fix: when a room is entered, discard its deferred queue (or drain and drop it on leave), and add a world-server test: a sim with a message scheduled, user leaves, user returns, no stale message arrives.

## Requirements and tasks

- Requirement 1 (rooms, template, lobby, scoping): met. `roomForProject` sanitises the sign text and limits it to 32 characters (`packages/shared/src/world/hotel.ts`). Property test in `packages/shared/test/hotel.test.ts:81`.
- Requirement 2 (elevator, floor panel, transition, highlight): met by the client (`ui/elevator.ts`, `ui/transition.ts`, `ui/floors.ts`) and `floorStatuses()` in the gateway.
- Requirement 3.1 (two-job limit and queue): met in `packages/agent-engine/src/jobs/runner.ts` (`acquireSlot`, `releaseSlot`, `announceQueue`). Covered by `queue.test.ts` with scripted runtimes.
- Requirement 3.2 (scoped agent ids): met. `Store.scoped()` rewrites roles to `<projectId>:<role>` for known jobs; the gateway splits the id back (`roomOfEvent`).
- Requirement 3.3 (Builder in the lobby): met (`roomOfEvent` maps Builder to `LOBBY_ROOM`; test in `floors.test.ts:221`).
- Requirement 4.2 (remembered floor) and 4.3 (replay with floors): met per the design notes; replay tests in `replay-transport.test.ts`.
- Requirement 5.3 (elevator flow in a world-server test): met (`floors.test.ts:87`).

## Missing tests

- The spec's requirement 5.2 asks for scoping and the queue order. The queue tests are example-based. The state machine has no fast-check property test, although tech.md asks for one on the job state machine. A property test would check "never more than 2 jobs running, FIFO start order, a project never has two unfinished jobs" over random start, cancel and finish sequences.
- No test for the stale-message case in blocking issue 1.

## Non-blocking suggestions

1. `startJob` (`gateway.ts`, near the `engine.startJob` call) sets `f.jobActive` before the call. If the engine answers 409 `busy`, the client gets `engine_unavailable` with the engine's text. Map the 409 to `busy`.
2. `Store.scoped()` (`store.ts`) silently keeps plain ids when the project is unknown. Log it once so a wrong scope shows up in the logs during the live check.
3. `task.created` clears the floor's reports and approvals. This matches the design, but the mailbox loses earlier reports of that floor for good. State it in the user-facing notes, or keep them until the next report.
4. Run `pnpm --filter @agentlife/client e2e` and `e2e:demo` with `E2E_CHANNEL=msedge` before merging; the status says they passed earlier, but not after the last commits.
