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
