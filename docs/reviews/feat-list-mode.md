# Review: feat/list-mode

Spec: `.kiro/specs/list-mode` (requirements 1.1-3.1, design.md, D13 in `docs/risks-and-decisions.md`).
Commits: 6 on top of `main` (c5e463d .. b465864). Diff: 26 files, +2662 / -42.

## Verdict: request changes

Reason: `pnpm check` could not be run during this review (the permission prompt for the command was not answered, so the call did not run). The result below is from reading the code only. Also one data bug (below).

## Blocking

1. **Job start time is wrong when the timeline is trimmed.** `packages/world-server/src/overview.ts`, `overviewOf`: `startedAt: timeline[0]!.ts` takes the first entry of the slice `timeline.slice(-OVERVIEW_TIMELINE_MAX)`, not the job's first entry. Once a job has more states than `OVERVIEW_TIMELINE_MAX`, the row shows the time of a later state as the start. Fix: keep `startedAt` on the floor (set on `task.created` in `gateway.ts`) or take the first entry of the untrimmed timeline. Add a test with a long timeline.

2. **Checks not run.** `pnpm check`, the Edge Playwright `e2e` and `e2e:demo` are reported as passing in `docs/STATUS.md`, but this review could not reproduce them. The reviewer must run them before a verdict of approve.

## Requirements

- 1.1, 1.2, 1.3 (list view, rows for every project, actions without walking): code present (`ui/list-view.ts`, `ui/list-model.ts`, `ui/actions.ts`, `goTo(..., "list")`, `showPanel`). Not verified in a browser or against a real engine with two projects (STATUS says so).
- 2.1, 2.2 (palette, fuzzy, commands mapped to existing messages): code present (`ui/command-palette.ts`, `ui/commands.ts`, `ui/fuzzy.ts`).
- 3.1 (tests): unit tests exist (`client/test/list-mode.test.ts`, `fuzzy.test.ts`, `world-server/test/overview.test.ts`, `shared/test/overview-protocol.test.ts`) and `e2e/list-mode.spec.ts`. The fast-check property tests asked for by tech.md are not in the list: `fuzzy.test.ts` has properties, but the overview has none. Add one for `overviewOf` (no paths, no text in JSON; one entry per project floor).

## Boundaries and security (checked)

- Client talks only to the world-server: new messages `overview_watch`, `show_panel`, `go_to.via` all go through the existing socket.
- World-server does not call a model: `overview.ts` is pure over the floor state.
- Engine vocabulary: no change in `agent-engine`.
- Overview content: no paths, report bodies, goals or activity text (`overviewOf` builds from ids, names, states, counts, verdicts, times). Matches design.md.
- `go_to via "list"` only skips the elevator check. Floor checks (`hotel.has`, own-floor rule) still run.
- `show_panel` is limited to the user's floor and to panels that the floor has furniture for. It goes through the same token bucket as every message (`gateway.ts`, the bucket is checked before parsing).
- No `innerHTML` / `insertAdjacentHTML` in the new client files (grep). Project names reach the DOM through text nodes.
- Windows portability: no path or bash use in the diff.

## Missing or weak tests

- No property-based test for `overviewOf` (see requirement 3.1 above).
- No test for `startedAt` on a long job (blocking item 1).
- The Playwright list test uses the scripted engine with one floor; no run with two registered projects.

## Non-blocking suggestions

1. `gateway.ts`, `pushFloors` calls `scheduleOverview()` before the change check; harmless, but a comment would say why.
2. `rememberNight` runs on every night clock poll and on every night read; it only matters when the counts change, which the code already checks.
3. The `timeline` on the floor is unbounded in memory. It resets on each `task.created`, so the size stays small; a cap in the gateway would make that explicit.
4. `list-view.ts` is 283 lines. Split the row rendering from the event wiring when the next list feature lands.
5. Document in `docs/kiro-usage.md` or the README that the list needs the live hotel (the replay transport ignores `overview_watch`).
