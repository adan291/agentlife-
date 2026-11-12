# Review: feat/hr-desk against main

Reviewed: 2026-11-12, HEAD 9eb425a (requirement 4.3 fix, option A, on top of 3ea56d9). Spec: `.kiro/specs/hr-desk`.

## Verdict: request changes (re-verification needed)

1. Requirement 4.3 is now implemented as option A: every hired member is on the floor. The fix (`packages/agent-engine` is unchanged; `packages/world-server/src/gateway.ts`, `seatsOf`, `refreshTeam`, `walkIn`, `startSwap`) reads correctly, but the last verification report (`docs/reviews/feat-hr-desk-verify.md`) still says FAIL for 4.3. A new verification must confirm it.
2. D10 (`docs/risks-and-decisions.md`): the import review uses `agentlife-import-review` (read-only tier) instead of `agentlife-security`. The user has not ratified it.
3. `pnpm check` was not run in this pass (the command was denied by the permission system twice). The last recorded run (3ea56d9) passed. 9eb425a changes the world-server gateway and the client, so `pnpm check` must be run again before merge.

## Blocking

None found in the code of 9eb425a.

## Requirements not met as written

| Requirement | State | Where |
|---|---|---|
| 4.3 every hired agent appears on its floor | Implemented as option A (standing spots `guest1`..`guest6`, D12). Needs the re-verification | `world-server/src/gateway.ts` (`seatsOf`, `refreshTeam`), `client/src/scene/floor-people.ts` |
| 3.3 review by `agentlife-security` | Replaced by `agentlife-import-review` (D10); requirement text updated, user not yet agreed | `team/service-agents.ts`, `team/import-review.ts` |
| 6.1 intern runtime is `LlmRuntime` | Replaced by `OllamaRuntime` plus `InternRuntime` (fallback), explained in design.md task 5 | `src/runtimes/ollama.ts`, `src/team/intern.ts` |
| 6.3 fallback to claude-haiku-5.5 with report notice | Met at unit level. Notes are lost on engine restart (documented) | `src/steps/deps.ts`, `src/steps/report.ts` |

## Checked in 9eb425a

- Slots: a desk is always present in `Seats`; a spot exists only while somebody stands there. `seatsOf` keeps a spot for the same member (`previous`), and a team of at most 8 always has a free spot (two desk roles plus six spots).
- `refreshTeam`: the guest branch covers same member, replaced member, new member and let-go member. The `absent` check stops a second walk-in for a ghost that is still leaving, and the swap timer reads the newest team before it walks in.
- `pushTeamView` now runs through `enqueue`, so the team view arrives after the walks queued before it.
- Boundaries: the world-server still never calls a model and the engine still has no tile or sprite terms.

## Missing tests and checks

- `pnpm check`, `pnpm security:scan`, Edge `e2e` and `e2e:demo` must run again on 9eb425a.
- No browser check of six extra ghosts on a project floor (name tags can overlap; the two spots beside the QA desk). Listed in HUMAN-CHECKS.md.
- No live run: real `kiro-cli` review and HR agent, Ollama with `qwen3.5:4b`, the fallback with a real `kiro-cli`.
- The walks in and out with a real engine are covered only by messages in tests.

## Non-blocking suggestions

1. `team/service.ts` `syncAgents` builds a regex from project ids without escaping. Ids are limited to `[a-z0-9-]`, so this is safe today. Escape the id anyway.
2. `team/service.ts` `commit` writes agent files one by one. If a later write fails, earlier files already hold the new content while the stored team is unchanged. Stage all files first, then move them.
3. The service agents `agentlife-import-review` and `agentlife-hr` have `fs_read` for `**`. A hostile imported persona could ask the reviewer to read files elsewhere on disk. The answer returns as flags (max 8, 200 characters each) shown to the user. Check whether kiro-cli can confine `fs_read`, or record the risk in D10.
4. `team/import.ts` `checkTemplateText` only reports flags and the import stays queued. Show the flags as a warning on the approve button.
5. `steps/notes.ts`: the fallback note lives in memory only. Say so in the report of a failed job.
