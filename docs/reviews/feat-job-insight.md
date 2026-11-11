# Review: feat/job-insight against main

Spec: `.kiro/specs/job-insight` (requirements, design, tasks 1-5).
Commits: 6 spec commits (tasks 1-5) plus one STATUS commit, 68 files, +4479 / -255.

## Verdict

Approve. No blocking issues found. One should-fix item (artifact payload size) and one correctness fix (file counts) are listed below; both can follow in a small commit.

## Checks run

- `pnpm check` passes: shared 140 tests, world-server 62, client 254, agent-engine 229 (6 skipped, live tests), scripts 14. Typecheck passes.
- Not run by this review: Playwright (`pnpm --filter @agentlife/client e2e`). The stepper scrollWidth check (requirement 3.3) and the job card flow are reported as passing in STATUS.md but were not re-run here.

## Blocking issues

None.

## Should fix

1. `packages/shared/src/engine-api.ts:124-129` (`jobDetailsFromExport`): each artifact is capped at 200,000 characters and 40 artifacts are sent, so one `job_details` message can reach about 8 MB. The gateway's `MAX_MESSAGE_BYTES` (16 KB) only limits incoming messages. The spec asks for size caps on `job_details`. A local client can handle this, but a job with several large artifacts makes the reload slow. Suggested fix: cap the total characters across artifacts (for example 1 MB) and mark the rest as cut.

2. `packages/agent-engine/src/runtimes/kiro-cli.ts:179` and `:183`: a file outside the working directory becomes the string `(outside)`, and that string goes into the read/edit set in `WorkTracker`. All outside files then count as one file, so "n read / m edited" under-counts. Suggested fix: do not record a tool entry for outside paths (keep `where` for the terminal line only).

## Requirements check (tasks 1-5)

- Requirement 1 (work attribution): `agent.work` in `work.ts` with a 1 s throttle, sent at start, on change and at finish. `contextPctOf` reads `_meta.kiro.contextUsage.usagePercentage`. Tests in `work.test.ts` and `kiro-cli.test.ts`. The real context value is not confirmed in a live run (the spec says so too).
- Requirement 2 (Job card): `job-panel.ts` has goal, acceptance, repository, branch, steps table, document links and the credits line. Credits never show a number.
- Requirement 3 (stepper): claimed; Playwright check not re-run here.
- Requirement 4 (ghost visuals): `working-fx.ts`, `monitor-fx.ts`, `glow.ts`. Reduced-motion path not reviewed in detail.
- Requirement 5 (report delivery): `report.ready` carries `ts` and `verdict` (`gateway.ts`), the mailbox has NEW marks (`mailbox.ts`), the viewer is `report-viewer.ts`. Tests in `report-delivery.test.ts`.
- Requirement 6 (readability): contrast and one-repo line claimed in `visuals.test.ts`; not re-read.
- Requirement 7 (Origin check): `origin.ts` `checkOrigin`, wired in `gateway.ts` `verifyClient`. Missing Origin is accepted only on a loopback bind. `origin.test.ts` covers allowed, rejected and missing Origin.

## Boundaries and security

- Client talks only to the world-server: yes. The client gets `job_details` through the gateway, not from the engine.
- World-server does not call a model: yes.
- Engine does not mention tiles or sprites: yes.
- No `innerHTML` in the client; the Markdown and diff renderers set `textContent`. No `href` is produced from report content.
- Artifacts are redacted by the store before they are written (`store.ts` `redact`), so `job_details` returns redacted text.
- Engine export route: `/tasks/:id/export` with `encodeURIComponent` in `http-engine.ts`. Task id is validated by `TaskIdSchema` on the WebSocket side.
- Any connected client can read any job's artifacts through `job_details`. Acceptable for a single local user; it becomes a problem if the world-server is exposed on a network.
- No new Habbo assets, no new secrets in logs.
- Windows portability: no `new URL(...).pathname` in the diff.

## Missing tests

- The spec does not ask for property-based tests in this block. Still, `WorkTracker` throttling (at most one event per second, final values always sent) is a good fast-check candidate.
- No test covers the `(outside)` file count (suggestion 2).
- No test covers `job_details` total size (suggestion 1).

## Non-blocking suggestions

1. Send `agent.work` finish for the `test` and `report` steps too. Today only `start()` runs for them, which is fine for the current fields, but it is inconsistent with `runRole`.
2. `gateway.ts`: `verdicts` and `currentStep` are reset on job start. A comment on the reset order would help the next reader.
3. `job-panel.ts` `ROLE_OF_STEP` maps `test` to `qa`. Add a comment that the report step has no separate agent row.
4. Cap the `title` in the `work` message on the client side too, or document that the engine sanitises it (`sanitize` in `work.ts` already does).
5. Playwright: keep the stepper scrollWidth assertion at 800 x 600 and at 640 px (the spec's lower bound for the stepper).
