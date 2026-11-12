# Review: feat/list-mode (second review)

Spec: `.kiro/specs/list-mode` (requirements 1.1-3.1, design.md, D13 in `docs/risks-and-decisions.md`).
Commits: 8 on top of `main`. Diff: 28 files, +2791 / -41.
This review replaces the earlier one of the same branch, which asked for changes.

## Verdict: approve

Conditions: the Playwright spec `e2e/list-mode.spec.ts` was not run in this review (the command was refused by the permission prompt). Its last FAIL was a strict-mode heading race; commit `d60e3aa` changed the checks to `.first()`. Run it once before merge: `$env:E2E_CHANNEL='msedge'; pnpm --filter @agentlife/client e2e list-mode`.

## Previous blockers, status

1. `startedAt` on long timelines: fixed. `overviewOf` takes the first entry of the untrimmed timeline (`packages/world-server/src/overview.ts`), and `overview.test.ts` "keeps the start of a job whose timeline is longer than the overview carries" covers it.
2. Checks not run: `pnpm check` now passes (shared 230, world-server 178, client 527, agent-engine 646 + 7 skipped, scripts 16). The Edge e2e is still open, see the condition above.
3. Property test for `overviewOf`: present. `overview.test.ts` checks one entry per project floor, protocol validity, and that the JSON carries no paths or free text.

## Blocking

None.

## Requirements

- 1.1 to 1.3 (list view, one row per project, every hotel action from the list): code and unit tests present. `show_panel` and `go_to via "list"` are the server side; the client moves first, then runs the same panel message.
- 2.1, 2.2 (palette, fuzzy search, keyboard use, shortcut shown): code and tests present.
- 3.1 (tests): unit tests cover ranking, dispatch, rendering of every job state, and the view keys. Property tests exist for fuzzy ranking and `overviewOf`. Playwright: see the condition above.

## Boundaries and security (checked by reading the diff)

- Client talks only to the world-server; the new messages (`overview_watch`, `show_panel`, `go_to.via`) use the existing socket.
- The world-server does not call a model; `overview.ts` is a pure function over the floor state.
- `agent-engine` is not changed by this branch.
- The overview carries ids, names, states, counts, verdicts and times. Goals, report bodies, plans and paths are not in it (tested).
- `go_to via "list"` skips only the elevator check. Floor checks and the rate limit still run. This is decision D13.
- `show_panel` only opens panels the user's own floor has furniture for.
- No `innerHTML` or `insertAdjacentHTML` in the new client files; project names reach the DOM as text.
- No path or bash use in the diff (Windows portability).

## Human checks (not verifiable from the code)

- List layout and colours in a browser: long project names, many projects, 360 px width with the "List" and "Commands" buttons.
- Palette overlay: contrast, selected row, shortcut label.
- A real engine with two registered projects: start a job from the list on another floor, approve it from the palette, open the report.
- A night job scheduled for a project shows in its row (the scripted engine has no night shift).
- Recorded demo: the list says it needs the live hotel; the palette keeps "Go to" and "Toggle view" only.

## Non-blocking suggestions

1. `e2e/list-mode.spec.ts:104`: the check after "open report" asserts the heading "Mailbox" again. It does not show that the report opened. The next assertion (report body visible) does that job, so either assert the "Report" heading or drop the heading line.
2. `gateway.ts`: the `clock` option of `GatewayOptions` lost its doc comment when the debounce comment replaced it.
3. `gateway.ts`: `pushFloors` calls `scheduleOverview()` before the change check. A comment would say that the check happens later.
4. `list-view.ts` is about 280 lines. Split the row rendering from the event wiring when the next list feature lands.
5. Note in the README or `docs/kiro-usage.md` that the list needs the live hotel, because the replay transport ignores `overview_watch`.
