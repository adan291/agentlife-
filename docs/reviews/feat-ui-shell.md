# Review: feat/ui-shell (ui-shell tasks 1-5)

Reviewed against `main` (`git diff main...HEAD`, 6 commits, one per task plus STATUS).

## Verdict

Approve. No blocking issues found. Browser checks (real browser at the listed sizes, browser zoom, minimise/restore) are still open; the Playwright smoke test covers the layout part.

`pnpm check` passes: shared 126, client 147, world-server 34, agent-engine 215 (6 skipped), scripts 14.

## Blocking issues

None.

## Boundary and security checks

- Client talks only to the world-server: unchanged. No new network code.
- Agent-engine and world-server: not touched.
- Tiles and sprites: the shell does not know them. `world-view.ts` only receives stage sizes.
- No `innerHTML` added. The only `innerHTML` mention in `src` is a comment in `markdown.ts`.
- No `new URL(...).pathname` or bash-only scripts. The Playwright script is `playwright test`.
- No secrets, no logs added.
- `position: fixed` appears only on `.al-shell` (`ui/shell.ts`), as the theme test allows. All other components use `absolute` inside the stage.

## Requirements

Met, as far as the code and the tests show:

- Req 1.1-1.4: grid in `ui/shell.ts`; canvas sized from the stage by `ResizeObserver` (`main.ts`); `freeViewport` and `scene/viewport.ts` removed; `world-view.ts` fits to `app.screen`.
- Req 1.5: overlays are mounted in `stage` or in a shell slot. The Playwright test checks region overlap at 1366x768, 800x600, 375x667 and 360x480.
- Req 2.1-2.3: 240/52 px widths, chevron toggle with label, state kept in localStorage, ellipsis with `title`.
- Req 3.1-3.2: drag and keyboard resize within 3 lines and 50 % of the height; collapsed header with latest line and unread count.
- Req 4.1-4.2: top bar slots; toast in the banner column under the top bar.
- Req 5.1-5.3: breakpoints in `shellTemplate`, compact stepper (`compactStep`), panels full width in compact mode.
- Req 6.1-6.4: tokens in `theme.ts`, focus ring, button states, panel header/body/footer.
- Req 7.1: table tests for `shellTemplate` per breakpoint and per user choice.
- Req 7.2: Playwright smoke test exists and was run with Edge (STATUS).

## Claimed as done but not verified

- Req 5.4 (browser zoom 50-200 %, minimise/restore without reload) is marked done in `tasks.md` task 4, but no test or recorded run covers it. STATUS lists it as not looked at. Either verify it or mark it open in `tasks.md`.
- Req 3.1 says height and state are "remembered". `e2e/shell.spec.ts` checks only that `agentlife-dock-px` is set. `open()` clears localStorage on every navigation, so no test reloads the page and checks the restored height.

## Missing tests

- The Playwright suite is not part of `pnpm check`. The design allows this, but the overlap and canvas-size checks only run when someone starts the e2e command by hand.
- No browser test for the 360 px case with the connection status chip shown. The top bar then holds the status chip, the stepper and four controls (`.al-top` uses `overflow: hidden`, so controls can be clipped without overlapping other regions).

## Non-blocking suggestions

1. `ui/shell.ts:251` and `:228-230`: every pointer move while dragging the dock calls `setDockBody`, which writes localStorage and re-runs layout. Save the height on `pointerup` only, or keep it in memory during the drag.
2. `ui/shell.ts:122`: the title is hidden in compact mode with `:has(.al-status:not([hidden]))`. This is an undocumented rule that depends on the status chip. A short comment in the CSS would help the next reader.
3. `ui/team-bar.ts:183`: Req 2.1 asks for a tooltip with name and state on collapsed rows. The code sets a native `title` on the row. That is acceptable if you want it, but it is not the tooltip component used elsewhere.
4. `e2e/shell.spec.ts`: add one test that sets the dock height, reloads the page without clearing storage, and checks the height again.
