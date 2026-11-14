VERDICT: FAIL

Branch `feat/regression-suite` at 0f8e3ee, spec `regression-suite`, tasks 1-3 marked `[x]`. Second verification, after the fix commit 0f8e3ee (the first report was FAIL on 3.1 and 5.1). The untracked `docs/reviews/feat-regression-suite-rereview.md` is not mine and was not used as evidence.

Commands run on this machine (Windows, Edge):
- `pnpm check`: exit 0 (client, world-server 455, engine 682 + 7 skipped, scripts 19).
- `$env:CI='1'; $env:E2E_CHANNEL='msedge'; pnpm --filter @agentlife/client exec playwright test --retries=1` (the conductor's command): 132 passed, 0 flaky, 6.1 min. No listener on ports 8787, 8788, 8795-8798, 5173, 5196-5199 before the run.
- `e2e:demo` was not rerun: nothing it covers changed since the first verification, where it passed 1/1.

## Criteria

| Requirement.criterion | Result | Evidence |
|---|---|---|
| 1.1 Lobby: Edit room, move and turn a piece twice, Done; Menu by keyboard; Actions menu Wave | PASS | `journeys.spec.ts` "lobby: edit the room, use the Menu with the keyboard, wave from the Actions menu", at 3 sizes, passed in this run. |
| 1.1 Shop: buy furniture and an outfit part; balance falls by the price | PASS | `journeys.spec.ts` "one run through the hotel": 500 -> 486 -> 446. |
| 1.1 HR office: put the bought part on a member, shows on the preview | PASS | Same test (`data-slot="hat"` = flat_cap, preview changes). |
| 1.1 Project floor: place item, start job, approve plan, catch wisp, open report from its row, deliver, "Branch ready" before and delivered branch after | PASS | Same test; scripted delivery in `fake-engine.ts` (`FAKE_DELIVER`) with `world-server/test/engine.test.ts`. |
| 1.1 Profile: XP, level, badge, quest of the run; member wears the part after a reload | PASS | Same test (`Lv`, XP, `approver` badge, 3 quests done, `looks(page)` after `page.reload()`). |
| 1.1 List view and Ctrl+K: same job visible, "Approve plan" from the palette | PASS | `journeys.spec.ts` "list view and the command palette: ...". |
| 1.2 Clean state per journey, no order dependence | PASS | `support/hotel.ts` `startHotel` (mkdtemp, scratch files, own world-server on a free port, removed in `stop`); `support/fixtures.ts` starts one per test. |
| 2.1 Viewport, covered (`elementFromPoint`), page scroll, text cut on every journey screen at 3 sizes | PASS | `support/rules.ts`, `fixtures.ts` `expectScreen`, `rules.spec.ts` (each rule fails on a broken page). Passed in this run. |
| 2.2 Role, accessible name, Tab, focus ring, pointer cursor | PASS | Rules `clickable-role`, `name`, `tab`, `focus-ring`, `cursor` in `rules.ts`; one test each in `rules.spec.ts`; exceptions with reasons in `support/allowlist.ts`. |
| 2.3 No page or console error during a journey | PASS | `fixtures.ts` asserts the error list is empty; allowlist is the favicon 404 only. |
| 3.1 Rooms (lobby, HR office, floor default, floor decorated) at 3 sizes, motion and clock frozen | PASS | `visuals.spec.ts` "rooms: ..." and "a decorated floor"; `support/visual.ts` `freezeForScreenshots`; 4 room tests x 3 sizes passed. |
| 3.1 "...and of each panel" | FAIL | 71 baselines (24 per size, `win32`). Added since the first report: Help, Reception, activity lines, plan, job card, mailbox with report, report (times, durations and balance masked via `timeMasks`; `noWisps` seed). Still not compared, as `docs/regression-backlog.md` and design.md state: night board, Library, review desk, test lab, directory, coffee machine, pipeline editor, HR imports. The requirement says "each panel" and `requirements.md` is unchanged; STATUS.md lists the narrowing as a decision still waiting for the user. Also `mailbox-empty` is skipped at 360x640 and the Profile's Quests tab is not compared (the date picks the quests). |
| 3.2 Baselines per platform; platform without them skips and says so; `e2e:update-visuals` | PASS | `playwright.config.ts` `snapshotPathTemplate` with `{platform}`; `visual.ts` `missingBaselines` -> `testInfo.skip("No visual baselines for <platform>...")`; script `e2e:update-visuals` in `packages/client/package.json`. |
| 3.3 Failing comparison keeps expected, actual and diff in the report | PASS (by config) | `reporter: html` in `playwright.config.ts`; Playwright keeps the three images on a `toHaveScreenshot` failure. Not forced by me (see Human checks). |
| 4.1 Conductor runs suite and `e2e:demo` after `pnpm check`; failure stops the merge with report path; flaky reported | PASS (by reading and by running its command) | `scripts/conduct.ts` `runBrowserTests`, `scripts/e2e-report.ts`, `scripts/test/e2e-report.test.ts` (passes in `pnpm check`). The step was not run in a real merge. |
| 4.2 CI runs on every push and PR on Linux and Windows, uploads the report on failure | PASS (by reading) | `.github/workflows/ci.yml` job `browser` (ubuntu-latest, windows-latest), artifact on `failure()`. Visual comparisons are skipped in CI (`E2E_SKIP_VISUALS=1`); the requirement names only journeys and rules. Never run on a real runner. |
| 4.3 Own ports and scratch files; stop at the end of the run | PASS | `hotel.ts` (free port, temp folder, kill and `rm` in `stop`); config servers on 8795-8798 / 5196-5199; no listener left after my run. |
| 5.1 Covered items ticked with the test name | PASS | `docs/HUMAN-CHECKS.md` "Covered by tests (ticked)" names spec files and test titles; the ones I checked match test names in this run's output. |
| 5.1 What is left is only what needs a human, in one short list | PASS | The "could be a test" items moved to `docs/regression-backlog.md`; `HUMAN-CHECKS.md` now has one list "Needs a human" of 12 items. They are long, but each needs a person (real engine, real time, touch, art, motion, decisions). |
| 5.2 STATUS.md and README say how to run the suite and update baselines | PASS | `README.md` "Tests" section; `docs/STATUS.md` regression-suite row. |

## To fix

1. **3.1, panels not compared.** Either add visual comparisons for the night board, Library, review desk, test lab, directory, coffee machine, pipeline editor and HR imports (each needs the furniture on screen and its data scripted in the fake engine; `visuals.spec.ts`), or get the user's explicit yes to narrow requirement 3.1 and edit `requirements.md` and `design.md` to match. A decision of the user, not something a session decides. Take the empty mailbox at 360x640 through a route that reaches it, or include it in the same decision.

## Human checks

- Decide on item 1 above (accept the narrowing of 3.1 or ask for the eight panels).
- First run of the `browser` job on a real GitHub runner (Linux Chromium install, Windows Edge); it has not run there.
- The conductor's `runBrowserTests` inside a real merge: confirm a forced failure stops with the report path, and a flaky test lands in `data/sessions/log.md`.
- Look once through the 71 baseline images in `packages/client/e2e/__visuals__/win32/`; a baseline fixes whatever it shows, including a wrong look.
- Force one visual failure and open `playwright-report/index.html` to confirm the expected, actual and diff images are there (3.3).
- Accept or reject the CI decision to skip visual comparisons and the four product-code bug fixes in design.md "Bugs found" (`shell.ts`, `list-actions.ts`, `command-palette.ts`, `list-view.ts`).
