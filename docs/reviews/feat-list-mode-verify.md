VERDICT: PASS

Branch `feat/list-mode`, spec `list-mode` (tasks 1-3 marked done). Second verification, after the fixes in d60e3aa.

Commands run:
- `pnpm check`: passes (shared 230, world-server 178, client 527, agent-engine 646 + 7 skipped, scripts 16).
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e list-mode`, 5 runs in a row: 4/4 passed every time (the first verification failed 2 of 3).
- Full `e2e` (Edge): 42 passed. `e2e:demo`: 1 passed. `pnpm security:scan`: clean.

| Criterion | Result | Evidence |
|---|---|---|
| 1.1 Top-bar toggle and `L` key outside text fields, no reload | PASS | `hud.ts` (View button, `isViewKey`, `inTextField` guard); `list-mode.test.ts` "L toggles outside text fields only, without modifiers", "remembers the view..."; e2e "switches between the hotel and the list with the button and with L, without reloading", "L does nothing while typing in a field" |
| 1.2 One row per project: name, job (kind, state, step, who), waiting badge, last report verdict and time, night jobs | PASS | `list-model.ts` (`jobLine`, `statusLine`, `waitingBadge`, `reportLine`, `nightCount`); `list-view.ts:133-160`; tests "renders one row per project with name, status, job, badge and last report", "shows how many night jobs a project has", "describes a job in every state" |
| 1.2 Rows expand to show steps and links to artifacts | PASS | `list-view.ts:176-220` (`aria-expanded`, `stepsOf`, "Job card", "Report", "Deliver as branch"); tests "an expanded row shows the steps with durations and the delivery state", "toggles a row's details". Links open the job card and the report, which list the artifacts (design.md, task 1) |
| 1.2 (fix since the last run) `startedAt` of a job with a long timeline | PASS | `world-server/src/overview.ts` takes `startedAt` from the untrimmed timeline; test "keeps the start of a job whose timeline is longer than the overview carries" (`overview.test.ts:94`); fast-check property test over `overviewOf` (`overview.test.ts:116`) |
| 1.3 Every hotel action available from the list (start any kind, approve/reject, open report, deliver, schedule night) | PASS | `list-actions.ts` (`newJob` for the 4 kinds, `reviewPlan`, `openReport`, `openJobCard`, `scheduleNight`); approve, reject and deliver run in the hotel panels after the move and `show_panel` (design.md, task 1). Tests "has the buttons of every action, and each calls its action with the row's floor", "on another floor the move comes first, then the same panel message"; world-server `overview.test.ts` "show_panel" and "go_to via the list". Approve, reject and deliver are not one-click buttons in the list: the row opens the mailbox or the report where the existing buttons are. Accepted as written in design.md |
| 2.1 `Ctrl+K` opens a palette with fuzzy search over the listed commands | PASS | `hud.ts` (`isPaletteKey`, `preventDefault`), `commands.ts` (Approve plan in, New <kind> job in, Open report of, Go to, Schedule night job, Toggle view), `fuzzy.ts`; tests "offers the commands of the requirement, for the projects that need them", "every command calls the matching list action", "Ctrl+K and Cmd+K open the palette; K alone does not" |
| 2.2 Keyboard only (arrows, Enter, Esc); shortcut shown | PASS | `command-palette.ts:86-134`; test "puts what waits for the user first, and shows the shortcut of Toggle view"; e2e "the palette is usable with the keyboard only"; `moveSelection` property test |
| 3.1 Fuzzy ranks exact prefixes first | PASS | `fuzzy.test.ts` "puts exact prefixes first", "property: every item that starts with the query comes before every item that does not" |
| 3.1 Every command dispatches the same message as its hotel equivalent | PASS | `list-mode.test.ts` "the hotel panels send what the builders build" (3 tests), "panels.ts builds its messages with the shared builders, not by hand", "every command calls the matching list action" |
| 3.1 The list renders all states | PASS | `list-mode.test.ts` "renders every job state without throwing, each with its job line" |
| 3.1 Playwright: switch views and run "Approve plan" from the palette | PASS | `e2e/list-mode.spec.ts:32` (switch) and `:61` (start from the list, leave the floor, "Approve plan" from the palette, Approve, row leaves the approval step). 5 of 5 runs passed; the heading checks use `.first()` (lines 71, 90, 104) |

## To fix
None.

## Human checks (UNVERIFIABLE here)
- Look at the list layout and colours in a real browser: long project names, many projects, 360 px width with the "List" and "Commands" buttons in the top bar.
- Look at the palette overlay: contrast, selected row, shortcut label.
- Run against a real engine with two registered projects: start a job from the list on a floor other than the current one, approve it from the palette, open the report. The Playwright test uses the scripted engine with one project floor.
- Check that a scheduled night job shows in the row's night count with the real night shift (the scripted engine has none).
- Recorded demo: the list says it needs the live hotel and the palette keeps only "Go to" and "Toggle view" (unit tests cover it; `e2e:demo` passes but does not open the list).

## Other notes (not failures)
- `go_to` with `via: "list"` skips the elevator check from anywhere. This is the accepted decision D13; it stays behind the existing rate limit and only accepts floors the hotel has.
- The "ago" times in a row refresh when the overview changes, not on a timer (known limit in design.md).
- `docs/reviews/feat-list-mode.md` has uncommitted changes in the working tree; they were not touched by this verification.
