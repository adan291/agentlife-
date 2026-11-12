VERDICT: PASS

Branch `feat/pipeline-editor` (4 commits over main: bb2c7cc, 0532c48, 0e14af6, 656637d). Spec: `.kiro/specs/pipeline-editor`, tasks 1-3 marked done.

Commands run:
- `pnpm check`: exit 0 (shared 246 tests, world-server 185, client 544, agent-engine 677 passed and 7 skipped, scripts 16).
- `pnpm --filter @agentlife/client e2e e2e/pipeline-editor.spec.ts` with Edge (`E2E_CHANNEL=msedge`): 6 of 6 passed.

## Criteria

| Requirement.criterion | Result | Evidence |
|---|---|---|
| 1.1 Pipeline is an ordered list of `{ kind, memberId? }` with the eight kinds | PASS | `packages/shared/src/pipeline.ts` `PipelineStepSchema` (strict), `PIPELINE_STEP_KINDS`; test `pipeline schemas > accepts the default and refuses unknown kinds, extra fields and a bad member id` (`shared/test/pipeline.test.ts`) |
| 1.1 Stored per project in `data/pipelines.json` | PASS | `engine.ts` builds `PipelineStore` with `AGENTLIFE_PIPELINES_FILE` or `<data root>/pipelines.json`; `agent-engine/test/pipeline.test.ts` "saves a valid pipeline, writes it to the file, and goes back to the default" reads the file back; `PipelineStore moves an unreadable file aside` |
| 1.1 Default equals today's flow | PASS | `DEFAULT_PIPELINE` in `shared/src/pipeline.ts`; test "is exactly today's table for the default pipeline" (`stateFlowOf(DEFAULT_PIPELINE)` equals `PIPELINES.change`, transitions equal `TRANSITIONS`); route test shows `customised: false` with the default steps |
| 1.2 Starts with `plan`, optionally preceded by `research` | PASS | `validatePipeline` (`pipeline.ts` "The start" block); test `starts with the plan, which only research may precede` |
| 1.2 `approve` after `plan` and before `develop` | PASS | `validatePipeline` approve checks; tests `does not let develop run before the approval`, route test "refuses a pipeline that breaks a rule" (400 `invalid_pipeline`, issue at `steps.2`) |
| 1.2 `test` after `develop`; every `review` (and second review) after `test` | PASS | `validatePipeline` test/review checks; test `does not let a review run before the tests` |
| 1.2 Ends with `report` | PASS | `validatePipeline` report check; test `ends with the report` |
| 1.2 Each step's member has the role the step needs | PASS | `PIPELINE_STEP_ROLES` and member block in `validatePipeline`; tests `refuses a member of the wrong role, a stranger, and a member on a step without one` and `asks for a researcher and a reviewer on the team when those steps have none named` |
| 1.2 Engine validates and rejects with a reason | PASS | `PipelineService.save` throws `BadRequestError("invalid_pipeline", reason, issues)`; route test above checks message and issue path; `forJob` re-validates at job start (409 `pipeline_invalid`), test "refuses to start a job whose saved pipeline no longer fits the team, and starts it again once fixed" |
| 1.3 State machine generated from the validated pipeline | PASS | `agent-engine/src/jobs/pipeline.ts` `stateFlowOf`, `transitionsOfPipeline` (via `buildTransitions`); `runner.ts` stores `table` in `Active` at start and `canMove` uses it for every transition |
| 1.3 Property test: no run reaches `develop` without approval, no review before tests | PASS | `agent-engine/test/pipeline.test.ts` "never reaches develop without the approval, nor a review without the tests (property)" (200 runs, reachability on the generated table) and "runs the steps of any valid pipeline in its order, and never develops before the approval (property)" (40 runs on the real `JobRunner`, checks event order); also `shared/test/pipeline.test.ts` "a valid pipeline always keeps the safety order" |
| 2.1 Row of cards (step, member, model) | PASS | `client/src/ui/pipeline-editor.ts` `card()` renders the name, a member select and "Model: ..."; test `shows the default pipeline as cards in order`. The "member ghost" is shown as the member's name and role in the select, not as a drawn ghost sprite (see human checks) |
| 2.1 Add, remove, reorder by drag and drop or buttons | PASS | `addStep`, `removeStep`, `moveStep`, pointer drag in `startDrag`, arrow buttons; e2e `drags a card with the pointer to another place`, `moves a step with the arrows...`, `adds an optional step...`; unit tests on the helpers |
| 2.1 Invalid positions in red with the blocking rule | PASS | `data-invalid` plus `al-pipe-problem` paragraphs; test `marks a step that breaks a rule in red with the rule, and keeps Save off`; e2e `moves a step with the arrows, marks the broken rule in red...` |
| 2.1 Save disabled until valid | PASS | `save.disabled = !check.ok || !changed`; unit test above and e2e assert it |
| 2.2 Changes apply to the next job; a running job keeps its pipeline | PASS | `JobRunner.start` takes `pipelines.forJob` once into `Active.pipeline`; test "keeps the pipeline it started with when the project's pipeline changes" (pipeline changed during develop, first job has no research, second does) |
| 3.1 Read-only researcher reads the repository and writes notes | PASS | `steps/research.ts` `researchStep` on a fresh clone via `prepareProjectDir`, runs `runRole` with the researcher's agent; test "runs the named researcher read-only in the project with the goal fenced, and returns its notes" (`pipeline-steps.test.ts`) |
| 3.1 Architect receives the notes in its prompt | PASS | `prompts/architect.md` `{{research}}`, `analyze.ts` `research: fence(ctx.research)`, runner passes `research` to the analyze step; tests `carries the research notes as fenced data, and says (none) without them` and "runs the research before the plan and hands the notes to it" |
| 3.2 Second review by another member on a different model | PASS | `validatePipeline` independence block; test `wants the second review done by someone else, on another model` (shared) and `runs the named reviewer with their model, on a prompt that holds no earlier review` (engine) |
| 3.2 Report shows both verdicts | PASS | `steps/report.ts` "## Second review" section; tests `the report > shows both verdicts and the research` and the fake-runtime route test (report contains "## Second review" and "## Research") |
| 3.2 Job fails if either review fails | PASS | `runner.ts`: `verdict = review.verdict === "pass" && second?.verdict !== "fail" && checked.passed`; test "fails the job when either review fails, and gives the developer both sets of notes"; "passes only when both reviews pass" |

## To fix

Nothing blocks the verdict.

## Human checks

- Open the board in a real browser (Edge or Chrome) against a real engine and a registered project. Confirm the editor sits above the job card, the cards and red rules are readable, and the drag with a real mouse feels right. The Playwright test plays the server for `pipeline_*` messages, so the engine and the gateway were not exercised together in a browser.
- Decide whether "member ghost" in requirement 2.1 needs a drawn ghost on each card. The code shows the member's name, role and model only.
- Run a live job with `kiro-cli` on a project whose pipeline has Research and a Second review (hire a Reviewer on another model and a Researcher at the HR desk first). Check that the researcher's notes reach the Architect, that the second reviewer runs with its own model, and that the report shows both verdicts. Only the fake runtime and scripted runtimes were run.
- The agent files for a hired researcher and reviewer were validated before (hr-desk), but not used by a real research or second-review step. Confirm the researcher cannot write.
- Known limits in design.md, not criteria: no `agent.work` card for Research, the Night intern can be chosen as researcher but fails that step, and firing a pipeline member is not blocked (the next job is refused with the reason).
