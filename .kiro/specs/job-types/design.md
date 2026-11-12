# Design: job-types

No design existed when the work started; these are the decisions made while implementing tasks 1 and 2 (2026-11-12).

## Kind and target

- `JobKind` = `change | review-branch | write-tests | document` (`packages/shared/src/job-kinds.ts`). An absent kind means `change`.
- `StartJobBody` gets `kind` (default `change`) and `target`. `target` is the input of the kind: a local branch (`review-branch`), a path or module (`write-tests`), a topic or path (`document`). A `change` takes none. `goal` stays required for every kind (the client writes it, for example "Review feature/x").
- The target is checked where the body is parsed (`targetProblem`): a branch name must pass `isSafeBranchName` (no leading `-`, no `..`, no `@{`, no spaces), a module path is relative with no `..`, a topic is one line. Agents only ever see the target as fenced data.
- `task.created` carries `kind` and `target` only for kinds other than `change`, so every recorded run and every `change` event is unchanged. `EngineJobView` has optional `kind` and `target`.

## Pipelines (`agent-engine/src/jobs/kinds.ts`)

The pipeline of a kind is the ordered list of states `PIPELINES[kind]`. `transitionsFor(kind)` builds the table the runner enforces: each state moves to the next one, every state before the report can fail or be cancelled, a review can go back to develop once, a report is delivered, a failure still produces a report. For `change` the table is the existing `TRANSITIONS`, untouched (a test checks the builder gives the same table).

| Kind | States |
|---|---|
| change | analyzing, awaiting_plan_approval, developing, testing, reviewing, report_ready |
| write-tests | same as change |
| document | analyzing, awaiting_plan_approval, developing, reviewing, report_ready (no test step) |
| review-branch | reviewing, testing, report_ready (no plan, no approval, nothing written) |

No new job states or step names: the research step of `document` is the `analyze` step (state `analyzing`) with another prompt, and the branch review is the `review` step. `Steps.reviewBranch` is optional; an engine whose steps lack it refuses the kind.

## Path rules

A diff is checked by `validateDiff(..., kind)` after the protected-path checks, so `package.json`, `.github` and the rest stay protected in every kind. The reason names the rule and goes to the report through the existing rejected-diff path.

- `write-tests`: `**/*.test.*`, `**/*.spec.*` at any depth; `test/**`, `tests/**`, `__tests__/**` only at the root of the project (as in the glob). A deleted file counts like any other.
- `document`: `docs/**` at the root and `*.md` at any depth (a README in a subfolder is normal and Markdown cannot execute).

## Review of a branch (`steps/review-branch.ts`)

1. The branch must be a local branch of the project (read with `git for-each-ref refs/heads` in the user's repository; the built-in project uses the engine's own repository). The base is the checked-out branch, else `main`, else `master`, never the branch itself.
2. A registered project is cloned as for any job; the branch and the base are fetched into the clone (`refs/al-review/head` and `refs/al-review/base`). Nothing is written to the user's repository.
3. The engine refuses a branch that holds a symbolic link or a reserved agent file, then checks it out detached in `data/worktrees/<taskId>`. QA reads that checkout and the test step runs on it.
4. QA gets `git diff <base>...<branch>` (cut at 200 KB) as fenced data and answers with findings by severity. The engine cuts long lists and texts, sorts by severity, and never lets a branch with a high finding pass.
5. The verdict is pass only when the review passes and the tests pass (or were skipped for lack of a test setup).

Known limit: the test image of a registered project is built from the lockfile of the base branch, so a branch that changes dependencies is tested with the base's dependencies.

## Branch picker and delivery

- `GET /projects/:id/branches` answers `{ current, branches }` (local branches only, newest first, at most 200, names the hotel cannot handle left out). `POST /tasks` with `kind: review-branch` refuses a target that is not in that list (`unknown_branch`).
- A branch review is never deliverable: it has no develop step, so the export has no `deliverable`, and `POST /tasks/:id/deliver` answers 409 `not_deliverable` for it.

## Reports

`buildReport` adds the kind and target to the summary of the kinds other than `change`. `review-branch` has its own layout (verdict "READY TO MERGE" or "CHANGES REQUESTED", findings by severity, the branch diff, the tests). `write-tests` adds "Tests added" (files, an approximate count of test cases from the patch) and the coverage when the test log prints it. `document` shows "Files written" instead of "Change" and says the tests are not part of the job. A `change` report is byte for byte the same as before.

## Prompts

`prompts/` gets `architect-tests`, `architect-docs`, `developer-tests`, `developer-docs`, `qa-tests`, `qa-docs` and `qa-branch`. `templateFor(role, kind)` picks the file. They carry the same untrusted-content rule as the existing ones and state the path rule of the kind, which the engine enforces anyway.

## Furniture and forms (task 3, 2026-11-12)

- Three new furniture definitions, each with its own interaction and panel: `review_desk` (`review`), `test_lab` (`tests`), `library_shelf` (`library`). They are 1x1, stand on the north wall of `rooms/project-template.json` in the free tiles at x=2, 6 and 8, and face south. The office room (`rooms/office.json`) is not changed: floors exist now, so nothing loads it.
- Client messages: `start_job` gets optional `kind` and `target`, validated with `targetProblem` where the message is parsed (a bad target never reaches the engine). New `list_branches` (no payload, answered for the user's floor) and server message `branches` (`projectId`, `current`, `branches`).
- The gateway sends, before `open_panel`: the repository for all three panels, and the branches for the review desk. A failed or missing branch list is an `engine_unavailable` error, which the form shows instead of the picker. `open_panel` does not clear that error for these three panels (it does for the computer, as before).
- `EngineLink.startJob(repoId, goal, options?)` takes `{ kind, target }` for the kinds other than `change`; `HttpEngineLink` sends them only then, so a change request is byte for byte as before. `EngineLink.listBranches?` is optional. The scripted engine runs changes only and rejects the other kinds with a message; it has no branch list.
- `JobView` (client-facing) has optional `kind` and `target`, copied from the export. The stepper uses them: a change and test writing show the six steps, documentation shows Research, Approve, Build, Review, Report, and a branch review shows Review, Test, Report (no plan, nothing to approve). The strip sets `--al-steps` for its column count.
- The forms live in `ui/kind-forms.ts`. The user does not write a goal for a branch review or a test/doc job: the client builds a one-line goal (`Review branch x`, `Write tests for x`, `Document x`, plus optional notes) and sends the target separately. The branch picker lists only the names the engine returned; it starts on the first branch that is not the checked-out one (the base of the review).
- Demo (replay): the three panels open and say the desk is off in the recorded demo; a `start_job` with a kind other than `change` is refused with an error.

## End-to-end tests (task 4, 2026-11-12)

- `agent-engine/test/job-types-e2e.test.ts` runs the whole chain in one process: a WebSocket client, the real gateway, `HttpEngineLink` over HTTP/SSE, and the real engine with `createRuntimeSteps` over `FakeRuntime`, on a real registered project (a git repository in a temp folder with a branch `feature/login`). It imports the gateway from `world-server/src` by relative path; the engine package does not depend on the world-server otherwise.
- One job per kind, checked against the states the engine recorded: `review-branch` (branch list, no approval, no delivery, the user's repository unchanged, `/deliver` answers 409), `write-tests`, `document` (no test step) and `change` (a start without a kind). A branch the project does not have is refused with the engine's message and the floor stays free.
- The fake QA answers a branch review with a `BranchReview`; the other roles use the default fake outputs. Reports here are the generic `fallbackReport` (it prints the kind); the per-kind layouts are covered by `job-types-reports.test.ts`.

## Branch with nothing to compare with (2026-11-12, live check on DiscordIA)
- A project with only `main` let the user pick `main` at the review desk; the job failed in the review step with "there is no other branch to compare it with" and the report said CHANGES REQUESTED.
- The rule that picks the base moved to shared (`reviewBaseOf`, used by the engine as `pickBase`). The form offers only branches that have a base, labelled "<branch> (compared with <base>)"; with none it says "Nothing to review yet" and lists the project's branches. `POST /tasks` refuses such a target with 400 `nothing_to_compare` before a job exists.
