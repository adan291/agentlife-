# Design notes (list-mode)

Decision taken before task 1 (2026-11-12, option 1 of the S26 blocker, D13 in `docs/risks-and-decisions.md`). The requirements stay as written.

## Problem
The gateway scopes everything to the floor the user stands on: the client holds job, approvals, reports and job details of that floor only, `start_job`, `approve`, `job_details` and `deliver` refuse other floors, and `go_to` needs the avatar at the elevator. The list and the palette must show every project and act on any of them without walking.

## Approach: read-only overview + move-then-act
The per-floor rules in the gateway stay. The list gets one read-only summary of all floors, and every action on another project first moves the user to that floor, then sends the same message the furniture sends.

### Protocol (`@agentlife/shared`)
- Client `overview_watch { on: boolean }`. While `on`, the server sends `overview` at once and again after any change that alters it (job update, approval, report, floors list), debounced 300 ms. A new connection starts with `on: false`; the client sends `on: true` while the list view or the palette is open.
- Server `overview { floors: OverviewFloor[] }`, one entry per project floor (not the lobby or HR):
  - `roomId`, `projectId`, `name`
  - `job?`: `taskId`, `kind` (absent = `change`), `target?`, `state`, `step` (same step names as the stepper), `who` (role of the agent working, if any), `startedAt`
  - `waiting`: number of pending approvals for the user on that floor
  - `lastReport?`: `taskId`, `verdict` (`pass` | `fail` | none), `at`
  - `steps?`: the steps of the current or last job with state and duration (what the stepper shows), and `artifacts`: ids and labels of what the report viewer can open (plan, diff, tests, review, report). Ids only, never contents.
- `go_to` gets optional `via: "elevator" | "list"` (default `"elevator"`, today's rule). With `"list"` the server moves the user without the elevator check; the avatar enters the floor the same way as after an elevator ride. Unknown floors are refused as today; the existing rate limiter applies.
- No paths, no report bodies, no diffs, no activity text in `overview`: only ids, names, states, counts, verdicts and times. Content is fetched by the existing messages after the move.

### World-server
- `gateway.ts`: `overviewOf()` builds the message from the per-floor state the gateway already keeps (job views, approvals, reports, floors). A pure function in its own file (`overview.ts`) so it is unit tested without sockets.
- `goTo(ws, roomId, via)`: skip `atElevator` only for `via: "list"`.
- Night jobs per project are not repeated in `overview`: the client already gets them from `night_state` (`NightJob.repoId`).

### Client
- `ui/actions.ts`: `act(roomId, msg)` sends `msg` at once when the user is on `roomId`; otherwise it sends `go_to { roomId, via: "list" }`, waits for the `welcome` with that `roomId` (timeout 5 s, then a toast) and sends `msg`. Hotel furniture panels, the list and the palette all build their messages with the same helpers, so "every command dispatches the same message as its hotel equivalent" is testable (requirement 3.1).
- `ui/list-view.ts`: one row per floor from `overview` plus night jobs from `night_state`; a row expands to the steps and artifact links. Actions per row: new job of any kind (opens the existing kind forms from `ui/kind-forms.ts`), approve or reject (opens the mailbox panel after the move), open report, deliver, schedule a night job (opens the night board form). The list replaces the stage area of the shell; the Pixi scene keeps running but is hidden.
- `ui/command-palette.ts` (not `palette.ts`, which is the colour palette) and `ui/fuzzy.ts` (pure): ranking exact prefix > word-start match > subsequence; ties keep the command order. Commands are built from `overview` and `floors`: "New <kind> job in <project>", "Approve plan in <project>" (only when `waiting > 0`), "Open report of <project>" (only with `lastReport`), "Go to <floor>" (every floor, lobby and HR included), "Schedule night job", "Toggle view". Arrows, Enter, Esc; the shortcut is shown on the right (`L` for Toggle view).
- Keys: `L` and `Ctrl+K` are handled in the existing `keydown` listener in `hud.ts`, which already skips INPUT and TEXTAREA. `Ctrl+K` calls `preventDefault` (browsers bind it to the address bar search).
- View choice is remembered under `agentlife-view` (`hotel` | `list`).

### Demo and scripted engine
- The scripted engine works unchanged: `overview` comes from the gateway's state, not from the engine.
- The replay transport does not answer `overview_watch`; in demo mode the list shows "The list view needs the live hotel" and the palette keeps only "Toggle view" and "Go to <floor>". Revisit when the demo is re-recorded with several floors (final-demo).

## Why not the other options
- A view of the current floor only (option 2) fails requirements 1.2, 1.3 and 2.1, and the list would not be useful for daily work, which is its reason to exist.
- An explicit `roomId` on every command (option 3) changes the per-floor model in the gateway and every handler; it would duplicate the floor checks the security review already accepted. Move-then-act keeps one code path per action.

## Tests (requirement 3.1)
- shared: schema tests for `overview`, `overview_watch`, `go_to.via`.
- world-server: `overview.ts` per state (no job, each job state, waiting, last report pass/fail), debounce and watch on/off, `go_to` with `via: "list"` away from the elevator, nothing path-shaped in `overview` (scan the JSON).
- client: `fuzzy.ts` ranking (exact prefix first), command list from an overview, `act()` sends the same message as the furniture (same floor and other floor, with the `go_to` first), list rows render every job state.
- Playwright (scripted engine): switch views with the button and `L`; start a job, then run "Approve plan" from the palette and see the job leave the approval step.

## Decisions made while implementing (task 1)

Same approach as above (D13); these details differ from the first sketch.
- **`show_panel { panel }`** (client, new). The sketch said "send the same message the furniture sends", but the furniture's message is `use`, which walks the avatar to the desk. A panel's data (repos, branches, approvals, reports, projects, night schedule) is sent by the gateway only when the sim reports an `open_panel`, so a client on another floor could not fill a panel without walking. `show_panel` asks the gateway to do what `use` does on arrival: it checks the user's floor has furniture with that interaction (`this floor has no such desk` otherwise), sends the panel's data and then `open_panel`. Allowed panels: computer, mailbox, board, review, tests, library, night (`ShowablePanelSchema`). Read-only, scoped to the user's own floor, same rate limit. The forms in the list are therefore the existing panels, not new ones; "New <kind> job" = move, `show_panel`, then the panel's own `start_job`. Approve and reject stay in the mailbox panel (`approve` message), so the plan is read before it is decided.
- **`overview` has no `step`, no `steps` and no `artifacts`.** The floor status already carries `who`. Each job carries its `timeline` (state and time only, no text) and the client derives the steps with the stepper's own `stepperFor`, so there is one definition of the steps. Artifact links in a row are "Job card" (`show_panel` board, the card lists the artifacts) and "Report". `lastReport` has `reportId`, `taskId`, `verdict`, `at` and `delivery` (`available` | `done`); "Deliver as branch" in a row opens the report, where the existing button is.
- **The gateway keeps the kind, target and state entries of the current job** (`Floor.jobKind`, `jobTarget`, `timeline`, filled from `task.created` and `task.state_changed`). They are lost on a world-server restart, like the rest of a floor's state.
- **`overview_watch` stays on for a live session.** The client sends `on: true` when the connection opens (not only while the list or palette is open), so Ctrl+K from the hotel view has its data at once. The server debounces (300 ms, `overviewDebounceMs`) and sends only when the overview changed.
- **Night jobs are in the overview (`night`, a count per project).** The first sketch left them to `night_state`, but that message answers an error when the engine has no night shift (the scripted engine), and the client shows every `engine_unavailable` as a toast and in the panels. The gateway keeps the counts of `scheduled` and `waiting` jobs from its own look at the night shift (every 60 s, on connect and whenever the night board is read) and sends the number in the overview.
- **Navigator.** `ui/actions.ts` also holds the message builders the panels use (`startJobMessage`, `approveMessage`, `deliverMessage`), so the list, the palette and the furniture panels share them. `createNavigator().act(roomId, run, ready?)` sends `go_to` with `via: "list"`, waits for the `welcome` of that floor (and for `ready()`), then runs; 5 s timeout with a toast.
- **View.** The list is a `section.al-list` in the stage; the shell root gets `data-view="list"` and the canvas is hidden with CSS (the Pixi scene keeps running). "Go to floor" in the list and "Go to <floor>" in the palette switch back to the hotel view. The door transition is skipped for moves made from the list view.
- **Known limits.** A report opened from the list is marked read on the client by the existing mailbox state, and the server's unread flag of the floor clears when `show_panel` mailbox runs (as `use` on the mailbox does). The list shows "last report ... ago" as of the last render; it re-renders when the overview changes, not on a timer (a timer would drop the focused button).

## Decisions made while implementing (task 2)
- Files: `ui/fuzzy.ts` (pure: `fuzzyScore`, `rankMatches`, `moveSelection`), `ui/commands.ts` (pure: `buildCommands` from the overview, the floor list and the list's `ListActions`), `ui/command-palette.ts` (DOM overlay on the stage, z-index above the panels and the guide). Ranking: whole text, then prefix (shorter text first), then every query word at the start of a word, then the query inside the text, then the letters in order. Ties keep the command order, which is: approvals that wait, new jobs, reports, "Go to" for every floor, "Schedule night job", "Toggle view".
- Every command calls the same `ListActions` as the buttons of the list, so the palette and the list cannot drift apart. "Approve plan in <project>" appears only for a project with a pending approval and opens the mailbox on that floor with the plan and the Approve / Reject buttons (it does not approve by itself: the plan is read first). "Open report of <project>" appears only when the floor has a report.
- Keys: `Ctrl+K` (or Cmd+K) is handled in the `keydown` listener of `hud.ts` and works from text fields; `L` and `Z` still skip text fields (`inTextField`: input, textarea, select, contenteditable). Inside the palette the input stops every key from reaching the page (so Esc does not also close a panel behind it). Arrows wrap, Enter runs, Esc or Ctrl+K closes, a click on the dim area closes; focus returns to where it was. The top bar has a "Commands" button for people who do not know the shortcut.
- Commands are built when the palette opens; an overview that arrives while it is open shows the next time.
- In the recorded demo `live` is false: the palette keeps only "Go to <floor>" and "Toggle view".
- Closing the palette blurs its field first: hiding a focused element does not move the focus at once, and a Ctrl+K pressed right after Enter went to the hidden field (found by the Playwright test).

## Decisions made while implementing (task 3)
- Tests: shared `overview-protocol.test.ts`; world-server `overview.test.ts` (27: `overviewOf` per job state, kind and target, waiting count, last report, night count, watch on/off, debounce, `go_to` via list, `show_panel`, nothing from a job's text or a path in the JSON); client `fuzzy.test.ts` (ranking, properties) and `list-mode.test.ts` (builders, panels send what the builders build, a source guard on `panels.ts`, navigator, list actions, commands and what each calls, list model and rendering of every job state, view choice and keys); Playwright `e2e/list-mode.spec.ts` (switch views with the button and `L`; start a change from the list; leave the floor with the palette; the plan arrives and the row asks for the user; "Approve plan" from the palette moves back and opens the mailbox; Approve; the row leaves the approval step; the job runs to the end and "Open report" reads it so the shared world-server is left clean).
- "A command dispatches the same message as its hotel equivalent" is tested at two levels: the panels build `start_job`, `approve` and `deliver` with the builders of `ui/actions.ts` (checked by clicking the real panel components and by a guard on the source of `panels.ts`), and every command calls the list action that sends `show_panel` after the move.
