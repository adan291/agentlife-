# Review: feat/job-types against main

Spec: `.kiro/specs/job-types` (tasks 1–4, all marked done).
Reviewed commits: 369e7f1, a6de745, 826f324, ef51900, 95d60e6 (55 files, +3672 / -139).

## Verdict: approve

No blocking issues. The branch can be merged after the live check listed in STATUS.md (real kiro-cli prompts, a branch review on a real project, a browser look at the new furniture and forms).

## Blocking issues

None found.

Checked against the rules:

- Boundaries: the gateway calls the engine only over HTTP through `EngineLink`; `packages/agent-engine/src` has no tile or sprite reference in the new code; the world-server does not call a model.
- Security: `review-branch` writes nothing into a registered user repository. The only write is the clone-side `git fetch` (`steps/review-branch.ts`). Branch names are checked by `isSafeBranchName` in shared, in the route (`http/server.ts`) and in the runner, and the route refuses a branch missing from the engine's own list (`unknown_branch`). The reviewer's checkout is checked for symlinks and reserved agent files (`checkBranchTree`) and for changes after QA runs (`dirty` check). Protected paths still apply to every kind (`validateDiff` runs the protected checks before `kindPathProblem`).
- Windows: `git` is called with argument arrays, no shell; no `new URL(...).pathname` as a file path.

## Requirements claimed as done

- Task 1 (kinds, pipelines, path rules): met. `change` keeps `TRANSITIONS` unchanged, and the path rules are in `jobs/kinds.ts`.
- Task 2 (branch listing, prompts, reports, no delivery): met. `POST /deliver` returns 409 `not_deliverable` for a branch review (`projects/routes.ts`).
- Task 3 (furniture, forms): met in code. The three pieces are in `rooms/project-template.json` and `scene/recipes.ts`; the office room was left alone, as design.md says. Not looked at in a browser.
- Task 4 (end-to-end per kind): met. `agent-engine/test/job-types-e2e.test.ts` covers one job per kind, the refused branch and the 409.

## Missing tests

- The spec does not ask for property tests, but tech.md asks for fast-check on the job state machine. `buildTransitions` (per kind) and `kindPathProblem` (path rules) have only example-based tests. Property tests would be useful: every pipeline ends in `report_ready`; every state before the report can reach `failed` and `cancelled`; no path outside `docs/**` or `*.md` passes the `document` rule.
- No live run with kiro-cli, so the seven new prompts are untested against a real model (already listed in STATUS.md).

## Non-blocking suggestions

1. Add the fast-check properties listed above to `packages/agent-engine/test`.
2. `DOCS_ONLY` in `jobs/kinds.ts` accepts any file under `docs/`, not only Markdown. This matches design.md ("docs/**"), but a narrower rule (`docs/**/*.md` plus any file that is not code) would be safer if the docs folder ever gets published.
3. The gateway reports every engine refusal as `engine_unavailable`, so `unknown_branch` shows as "Engine unavailable: ...". Forward the engine code, or show the engine message in the picker.
4. `review-branch` on a registered project clones and builds the test image per job. The first job on a project is slow; a note in the UI would help.
5. `PLAN_WORDS` in `jobs/runner.ts` repeats the `change` texts for `review-branch`. Fine for now; remove the duplicate entry if the table grows.
