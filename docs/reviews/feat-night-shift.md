# Review: feat/night-shift against main

Spec: `.kiro/specs/night-shift` (requirements, design, tasks 1-4).
Commits: 8 ahead of main, including the wip commit `f2338bd` from the interrupted session.

## Verdict: request changes

`pnpm check` passes (shared 204, world-server 127, client 418, agent-engine 473 with 6 skipped, scripts 16). Not run: the browser look and a live night with kiro-cli.

## Blocking issues

1. **The model tier is accepted and shown, but nothing uses it.**
   - `packages/agent-engine/src/night/store.ts:96` stores `tier` on the job.
   - `packages/client/src/ui/night-board.ts:138` shows "Cheap model" or "Normal model" in the job's facts line.
   - The scheduler (`scheduler.ts`, `startNext`) never passes it to `runner.start`. Every job uses the models of `config/agents.json`.
   - Why it matters: requirement 1.1 lists the tier as a scheduling input. The user picks a tier and the job ignores it. The design note admits this, but tasks.md marks task 4 done.
   - Fix: apply a per-job model override in the runtime, or remove the control from the form and the facts, and mark requirement 1.1 partly done in tasks.md.

2. **A job that waits for approval never gets its result, and the delivery request is dropped.**
   - `scheduler.ts`, `settle()`: only jobs with status `running` are looked at. A job set to `waiting` is never looked at again.
   - If the user approves the plan in the mailbox later, the engine runs the job to the end, but the night record stays `waiting`. The summary already said "waiting for you".
   - Requirement 2.3: a job the user asked to deliver as a branch must deliver when it passes. In this case nothing is delivered and nothing says so. The fail-safe direction is right (no branch without a result), but the user gets no signal.
   - Fix: keep watching `waiting` jobs whose engine job is still open, and record the final result and any delivery (or a reason it was not delivered). Add a test where the user approves after the night ended.

## Requirements claimed as done but not met

- Requirement 1.1 (tier): see blocking issue 1.
- Requirement 2.3 (delivery for a waiting job): see blocking issue 2.
- Requirement 3.3 (`audit-deps` in a sandbox): met with the offline option. The design records the choice. The `npm audit` list is limited to what the image cache holds, as documented.
- Requirement 5.1 (night look): code exists and has unit tests. Not checked in a browser; the veil sits under the labels only if the label layer is above it, which was not verified.

## Missing tests

- No test for a tier value reaching the runner (none can exist until blocking issue 1 is fixed).
- No test for a `waiting` job that is approved after the night closed (blocking issue 2).
- No test for the crash window in non-blocking item 1.

## Non-blocking suggestions

1. `scheduler.ts`, `close()`: the night is marked closed before `onClose` writes the summary. If the process stops between the two calls, the summary is never written and the night never closes again. Write the summary first, or store a "summary pending" flag.
2. `packages/shared/src/job-kinds.ts`: `audit-deps` is now in `JobKindSchema`, so `POST /tasks` and the client `start_job` accept it. The design says it is offered only in the night board. It is read-only, so the risk is low, but either allow it only for the night path or record the decision in design.md.
3. `morning.ts`, `createDiscordNotifier`: the notifier's stderr (up to 300 characters) goes into the error that is logged. `notify.ts` does not print the Discord token, so the risk is low. Keep the log text short and free of child output where possible.
4. `summary.ts`: the "Waiting for you" section and the "To do" list repeat the same jobs. Keep one.
5. A waiting night job keeps its project busy in the engine until the user decides. Later night jobs on that project are skipped as "busy". Say so in the summary or the board.
