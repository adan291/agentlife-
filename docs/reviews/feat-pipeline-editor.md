# Review: feat/pipeline-editor

Spec: `.kiro/specs/pipeline-editor` (tasks 1-3). Compared with `main`: 40 files, +2800 / -82 lines, 4 commits.

## Verdict: approve

No blocking issues found. Merge after the browser check and the live run listed under "Not verified".

## Checks run

- `pnpm typecheck`: no errors.
- `pnpm test`: shared 246 passed, client 544 passed, world-server 185 passed, agent-engine 677 passed (7 skipped, skips were already there), scripts 16 passed.
- Not run in this review: Playwright (`e2e`, `e2e:demo`), `security:scan`, `check:demo-build`.

## Blocking issues

None.

## Requirements against the code

- 1.1 Pipeline shape and default: `shared/src/pipeline.ts` (`PipelineSchema`, `DEFAULT_PIPELINE`), stored in `agent-engine/src/pipeline/store.ts`. Met.
- 1.2 Rules: `validatePipeline` covers the start (Plan, Research first), Approval between Plan and Develop, Tests after Develop, reviews after Tests, Report last, each kind once, required kinds, and member roles. Met.
- 1.3 Generated state machine: `jobs/pipeline.ts` (`stateFlowOf`, `transitionsOfPipeline`) and `test/pipeline.test.ts` with a property test over random valid pipelines. Met for the table. Research and the second review run inside existing states, as the design says.
- 2.1 Board editor: `client/src/ui/pipeline-editor.ts`, with Playwright coverage in `e2e/pipeline-editor.spec.ts`. The UI itself is not checked in a browser by the user yet.
- 2.2 Next job only: `JobRunner.start` copies the pipeline into `Active`; a running job never reads the stored one again. Met.
- 3.1 Research: `steps/research.ts` runs the researcher's agent file (via `memberForStep` with `ctx.memberId`), the notes are fenced in `architect.md` through `{{research}}`, and stored as `research.md`. Met.
- 3.2 Second review: `steps/index.ts` reuses `reviewStep`, the runner runs both reviews in pipeline order, the job fails if either fails, and the report has its own section. The independence rule (other member, other model) is in `validatePipeline`. Met.

Spec mismatch (non-blocking): design.md names `agent-engine/src/jobs/pipeline-runner.ts`; the code is `jobs/pipeline.ts`.

## Missing tests

- `world-server/src/http-engine.ts`: the three `pipeline` methods (GET, PUT, DELETE) have no test against the engine's routes. The gateway tests use a scripted link.
- A saved pipeline that a team change breaks, then a job started: covered by the engine test at `pipeline.test.ts` (409 `pipeline_invalid`). Good.

## Non-blocking suggestions

1. `pipeline/store.ts` `set` and `delete` change the in-memory map before `save()` writes the file. If the write fails, memory and disk disagree until restart. Write first, then update memory.
2. `pipeline/service.ts` and `shared/src/pipeline.ts` default a second review to a reviewer, but the rule allows `qa` as well. The error text says "needs a reviewer on the team" even when the team has a QA. Align the message with the rule.
3. `team/service.ts` takes the team snapshot at the first step of a job, not at start. A team change between start and the first step can change members the pipeline already validated. Taking the snapshot at start would match requirement 2.2 more closely.
4. Fix `design.md` to name `jobs/pipeline.ts`, and note that the Night intern check (`assertInternStep`) refuses research at run time, as the design already says.

## Not verified

- Live run with `kiro-cli`: real researcher and second reviewer, custom pipeline on a registered project.
- Browser look at the board editor and the drag and drop with a real engine.
- Known flaky Playwright run at the first board assertion (cold Vite start), per STATUS.md.
