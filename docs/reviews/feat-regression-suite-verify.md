VERDICT: FAIL

Branch `feat/regression-suite` at 84a18d7, spec `regression-suite`, tasks 1-3 marked `[x]`. Third verification, after the fix commits 3b6a8b6 and 84a18d7. The untracked `docs/reviews/feat-regression-suite-84a18d7.md` is not mine and was not used as evidence (it says 71 vs 102 baselines and that the Playwright suite was not run; I counted 102 files and ran the suite).

Commands run on this machine (Windows, Edge):
- `pnpm check`: exit 0 (world-server 457, engine 682 + 7 skipped, scripts 19, client and shared green).
- `$env:CI='1'; $env:E2E_CHANNEL='msedge'; pnpm --filter @agentlife/client exec playwright test --retries=1` (the conductor's command): 141 passed, no flaky, 6.5 min. No listener on ports 8787, 8788, 8795-8798, 5173, 5196-5199 before the run.
- `e2e:demo` was not rerun: nothing it covers changed since the earlier verification, where it passed 1/1.

## Criteria

| Requirement.criterion | Result | Evidence |
|---|---|---|
| 1.1 Lobby: Edit room, move and turn a piece twice, Done; Menu by keyboard; Actions menu Wave | PASS | `journeys.spec.ts` "lobby: edit the room, use the Menu with the keyboard, wave from the Actions menu", 3 sizes, passed. |
| 1.1 Shop: buy furniture and an outfit part; balance falls by the price | PASS | `journeys.spec.ts` "one run through the hotel" (500 -> 486 -> 446), passed. |
| 1.1 HR office: part on a member shows on its preview | PASS | Same test (`data-slot="hat"`, preview changes). |
| 1.1 Project floor: place item, start job, approve plan, catch wisp, open report from row, deliver, "Branch ready" before and branch after | PASS | Same test; scripted delivery `FAKE_DELIVER` in `world-server/src/fake-engine.ts`, shapes in `world-server/test/engine.test.ts`. |
| 1.1 Profile: XP, level, badge, quest of the run; part worn after reload | PASS | Same test (`approver` badge, quests, `data-looks` after `page.reload()`). |
| 1.1 List view and Ctrl+K: same job visible, "Approve plan" from the palette | PASS | `journeys.spec.ts` "list view and the command palette: ...". |
| 1.2 Clean state per journey, order independent | PASS | `support/hotel.ts` `startHotel` (mkdtemp, scratch files, own world-server on a free port, removed on stop); `support/fixtures.ts` one hotel per test. |
| 2.1 Viewport, covered, page scroll, text cut at 3 sizes on each journey screen | PASS | `support/rules.ts`, `fixtures.ts` `expectScreen`; `rules.spec.ts` shows each rule fails on a broken page. Passed. |
| 2.2 Role, accessible name, Tab, focus ring, pointer cursor | PASS | Rules `clickable-role`, `name`, `tab`, `focus-ring`, `cursor` in `rules.ts`, one test each in `rules.spec.ts`; exceptions with reasons in `support/allowlist.ts`. |
| 2.3 No page or console error | PASS | `fixtures.ts` asserts an empty error list; allowlist is the favicon 404 only. |
| 3.1 Rooms (lobby, HR office, floor default, floor decorated) at 3 sizes, frozen | PASS | `visuals.spec.ts` "rooms: ..." and "a decorated floor", `support/visual.ts` `freezeForScreenshots`; all passed. Baselines: `lobby`, `hr-office`, `floor-default`, `floor-decorated` x 3 sizes. |
| 3.1 "...and each panel" | FAIL | 102 baselines (34 screens x 3). Compared now: shop (2 tabs), elevator, directory, menu, actions menu, profile badges and look, palette, list, help, reception, hr-desk, hr-imports, computer, mailbox empty (also at 360x640 now), plan, activity, job card, mailbox with report, report, review desk, test lab, library memory and docs, pipeline editor, night board and form. Not compared: (a) the Profile's Quests tab (design.md says so: the date picks the quests); (b) the Construction board (`panels.ts:173` `build`, opened by `build_board`, the Builder's panel): no baseline, no test opens it, and neither design.md nor `docs/regression-backlog.md` mention it (the scripted engine answers `build_board` with "needs the real engine", `gateway.ts:639`). `requirements.md` still says "each panel" and the user has not agreed to a narrowing. |
| 3.2 Baselines per platform; platform without them skips and says so; `e2e:update-visuals` | PASS | `playwright.config.ts` `snapshotPathTemplate` with `{platform}`; `visual.ts` `testInfo.skip("No visual baselines for <platform>...")`; script in `packages/client/package.json`. |
| 3.3 Failing comparison keeps expected, actual, diff in the report | PASS (by config) | `reporter` html in `playwright.config.ts`; Playwright keeps the three images. Not forced by me. |
| 4.1 Conductor runs suite and `e2e:demo` after `pnpm check`; failure stops with report path; flaky reported | PASS (by reading and by running its command) | `scripts/conduct.ts` `runBrowserTests`, `scripts/e2e-report.ts`, `scripts/test/e2e-report.test.ts` (passes in `pnpm check`). Not run inside a real merge. The stop decision itself has no unit test (`docs/regression-backlog.md` says so). |
| 4.2 CI on every push and PR, Linux and Windows, report uploaded on failure | PASS (by reading) | `.github/workflows/ci.yml` job `browser` (matrix ubuntu/windows, `on: push` and `pull_request`, upload-artifact on `failure()`). Visuals skipped in CI (`E2E_SKIP_VISUALS`); the requirement names journeys and rules. Never run on a real runner. |
| 4.3 Own ports and scratch files; stop at end | PASS | `hotel.ts` (free port, temp folder, kill and rm); config servers on 8795-8798 / 5196-5199; no listener left after my run. |
| 5.1 Covered items ticked with the test name | PASS | `docs/HUMAN-CHECKS.md` "Covered by tests (ticked)" names spec files and titles that exist in this run's output. |
| 5.1 What is left is one short list of what needs a human | PASS | One list "Needs a human", 12 items; the "could be a test" items are in `docs/regression-backlog.md`. |
| 5.2 STATUS.md and README say how to run the suite and update baselines | PASS | `README.md` lines 97-104; `docs/STATUS.md` regression-suite row. |

## To fix

1. **3.1, panels not compared.** Two panels remain: 
   - The Construction board (and its report view). Either give the scripted engine fixed `getBuildBoard` data under `FAKE_PANELS=1` (`world-server/src/fake-panels.ts`) and add `construction-board` to `visuals.spec.ts` at 3 sizes, or get the user's yes to leave it out and write that in `requirements.md` and `design.md`.
   - The Profile's Quests tab. Either make the quests deterministic in the test (scratch quest pool with one fixed quest, or a fixed seed for the day) and compare it, or get the same yes.
   Both need the user's decision to narrow the requirement; a session cannot decide it.
2. Small, not a FAIL by itself: `docs/HUMAN-CHECKS.md` line 20 still says "the empty mailbox is not compared at 360x640"; it is compared since 3b6a8b6. And `docs/STATUS.md` regression-suite row still says "71 images" and "3.1 says 'each panel': your yes needed to narrow it" while there are 102 images; design.md says "nothing of the kind is left out any more" next to the Quests exception.

## Human checks

- Decide on item 1 (ask for the two panels or accept the narrowing).
- First run of the `browser` job on a real GitHub runner (Linux Chromium install, Windows Edge).
- The conductor's `runBrowserTests` inside a real merge: confirm a forced failure stops with the report path and a flaky test lands in `data/sessions/log.md`.
- Look once through the 102 baseline images in `packages/client/e2e/__visuals__/win32/`; a baseline fixes whatever it shows, including a wrong look.
- Force one visual failure and open `playwright-report/index.html` to see expected, actual and diff (3.3).
- Accept or reject the CI decision to skip visual comparisons and the four product-code bug fixes in design.md "Bugs found" (`shell.ts`, `list-actions.ts`, `command-palette.ts`, `list-view.ts`).
