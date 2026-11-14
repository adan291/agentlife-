# Design: regression-suite

Tests only. The one change outside `packages/client/e2e/` is a scripted delivery in the fake engine (`FAKE_DELIVER=1`), which the delivery journey needs. Bugs the journeys find are fixed in the smallest way and written down in "Bugs found" below.

## Where things live

```
packages/client/e2e/support/
  hotel.ts       starts one scratch world-server per test; scratch files; the WebSocket redirect
  fixtures.ts    `test` and `expect` with the hotel, the error watcher and the screen check built in
  rules.ts       layout and interface rules, measured in the page; `screenProblems(page)`
  allowlist.ts   every accepted exception, each with a reason
  world.ts       what a user does: tile points, elevator, palette, shop, panels
packages/client/e2e/journeys.spec.ts     requirement 1, at the three sizes
packages/client/e2e/rules.spec.ts        the rules checked against deliberately broken pages (a rule that cannot fail proves nothing)
```

The existing specs are not touched. They keep their own helpers and their shared test servers (ports 8795 to 8798).

## A hotel per test (clean state, requirement 1.2 and 4.3)

The existing specs share one world-server per spec file, so a test depends on what the previous one left. A journey creates its own hotel instead:

1. `startHotel()` makes a temp folder (`mkdtemp`) and writes a wallet with 500 Ecto, an empty inventory and wardrobe, and a quest pool that one scripted job finishes whichever three the date picks (the same pool as the progress server of `playwright.config.ts`). Layouts, outfits and progress start absent.
2. It starts `node --experimental-strip-types src/main.ts` in `packages/world-server` on a free port (`net` listen on 0, then close and reuse), with `ENGINE=fake`, `FAKE_HR=1`, `FAKE_DELIVER=1`, `AGENTLIFE_WISP_MS=300,500` and every `AGENTLIFE_*_FILE` pointing into the temp folder. It waits for the line `world-server listening`. The process never gets the user's `data/` paths, so a run cannot touch the real hotel (4.3).
3. The page connects to the Vite server of the main test server (`ws://127.0.0.1:8795` is what the client was built with). `page.routeWebSocket` takes that connection and forwards it frame by frame to the scratch world-server with Node's global `WebSocket`. The client is unchanged and needs no new Vite server. A loopback world-server accepts a client without `Origin`, so no allowed-origin setting is needed.
4. Teardown kills the process and removes the temp folder, also when the test failed. A crashed run leaves only a folder in the OS temp dir.

Wisps come every 300 to 500 ms during a job, so a journey catches one within seconds. The fake engine's step delay is its default (1.5 s).

## Errors

The fixture records every `pageerror` and every `console.error`. After the test it asserts the list is empty, except what `allowlist.ts` names (a `Failed to load resource` for `/favicon.ico` only: the dev server has none). A failed WebSocket to the real 8795 server cannot occur because the connection is routed, not attempted.

## Screens and rules (requirement 2)

`expectScreen(page, name)` runs after each screen of a journey (the lobby, each panel opened, the list, the palette, the menus) and fails with the screen name and one line per problem. It runs at 1366x768, 800x600 and 360x640, because the journeys run at all three. Everything is measured in the page with `getBoundingClientRect`, `getComputedStyle` and `elementFromPoint`, so there are no pixel comparisons here (those are task 2).

A visible element is one for which `checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })` is true and whose box is at least 1x1 px. Its visible box is its box clipped by every ancestor whose overflow is not `visible`; an element clipped away entirely (scrolled out of a list, behind a closed drawer) is skipped.

| Rule | How it is measured |
|---|---|
| `viewport` | A control or a label (a visible element with a text node of its own) whose box is not inside `[0, innerWidth] x [0, innerHeight]` (0.5 px of slack). An element inside a scrolling ancestor (`overflow: auto` or `scroll`) is checked by its visible box. Every `dialog`, `menu` and `listbox` and the four shell regions must be inside the viewport as a whole, so a panel taller than the window cannot hide its buttons inside its own scroll area. |
| `covered` | For each visible control not marked `pointer-events: none`: `elementFromPoint` at the centre of its visible box must return the control, a descendant of it, or an element in the same `label`. When a modal (`[aria-modal="true"]`) is open, controls outside it are skipped: they are behind it on purpose. A panel (`role="dialog"`) opened over the stage hides the stage's own controls (Actions, wisps) while it is open, and that is accepted; the top bar, the side bar and the dock must never be under one. |
| `page-scroll` | `documentElement` or `body` has `scrollWidth > clientWidth` or `scrollHeight > clientHeight`. |
| `text-cut` | A visible element with `overflow-x` or `overflow-y` of `hidden` or `clip` whose `scrollWidth` or `scrollHeight` is more than 1 px bigger than its client box, with text inside, and no `text-overflow: ellipsis` (a cut that shows an ellipsis is a decision, not an accident) and no `-webkit-line-clamp`. |
| `clickable-role` | An element that reacts to a click is a native `button`, `a[href]`, `input`, `select`, `textarea`, `summary`, or has a role from the list (`button`, `link`, `tab`, `menuitem`, `switch`, `checkbox`, `radio`, `slider`, `separator`, `option`, `combobox`) and is focusable. "Reacts to a click" is read from two sources. An init script wraps `EventTarget.prototype.addEventListener` and remembers the elements that got a `click`, `mousedown`, `pointerdown`, `pointerup` or `touchstart` listener (the canvas, `document`, `window`, `html` and `body` are not elements of the interface). Besides, an element whose computed `cursor` is `pointer` while its parent's is not. A descendant of a control belongs to the control. |
| `name` | Each control has an accessible name: `aria-labelledby`, `aria-label`, the text of a label, the content text with the `alt` of images and the `aria-label` of descendants, `title`, `placeholder`, in that order, trimmed and not empty. A second net: the `ariaSnapshot` of the page is read, and a line for a button, link, tab, menuitem, checkbox, radio, switch, textbox, combobox or slider without a name in quotes is a problem. Disabled controls are checked too. |
| `tab` | The page is walked with the Tab key (at most controls + 4 presses). Chromium starts the walk at the last click, so one wrap past the end of the page is allowed; the walk stops when an element repeats. Inside a modal it starts where the focus is. Every enabled control that is visible, not behind a modal and has `tabindex >= 0` must be reached; a control scrolled out of a scrolling list counts (Tab scrolls it into view). A control with `tabindex="-1"` is a problem. An element reached that the scan did not list is a problem too (a focus stop that does nothing, or a modal that lets the focus out). Items of an open `role="menu"` move with the arrow keys and Tab closes the menu, so a screen with a menu open skips the walk and the items are not Tab stops. A separator is a control only when it has a `tabindex` (the activity splitter); otherwise it is a divider line. The focus is put back where it was after the walk. |
| `focus-ring` | Each element the walk reaches matches `:focus-visible` and shows a ring: `outline-style` other than `none` with a width above 0, or a `box-shadow`. |
| `cursor` | Each enabled button, link, tab, menuitem, switch, checkbox, radio, option, summary and `[role=button]` has `cursor: pointer`. Text fields, selects, sliders and separators are exempt (their own cursor says what they do). |

The Tab walk is the slow part (one key press and one read per stop). It runs on every screen but stops as soon as an element repeats.

## Sizes and the canvas

The room is not scaled to the window (zoom is 1 or 2), so at 360x640 part of a floor lies outside the stage. `useFurniture(page, piece)` in `world.ts` clicks the piece's tile when that point is inside the stage, not under another control, and otherwise runs the command of the palette that does the same thing ("New change job in haunted-todo", "Approve plan in", "Open report of"). The route taken goes into the test's annotations (`route: computer: canvas`), so a run shows how much of the journey used the canvas at each size. At 360x640 the mailbox lies outside the stage, so that journey takes the palette route there and goes from the report the palette opens back to the list ("Back to the mailbox") to read the row. The Edit room journey and the shop counter need only tiles near the middle of the stage, which are inside at all three sizes.

## Journeys (requirement 1)

Each test starts its own hotel and has no dependency on the others. The first one is short, the second is the whole story.

1. **Lobby**: Edit room; select the plant, move it with an arrow and turn it with `R`, twice in a row, then click it again where it stands (the bug the user found by hand); Done. Open the Menu with the keyboard, move with the arrows, close with Esc. Open the Actions menu and run Wave (the `emote` frame is sent).
2. **One run through the hotel**: shop counter, buy a fern and the flat cap (the balance falls by 14 and 40, to 446); HR office, put the cap on the Developer (its preview changes); project floor, place the fern from the inventory tray, Done; the computer, start a job; the plan arrives, the mailbox approves it; a wisp is caught (+1 Ecto); the job ends and the mailbox row says "Branch ready"; the row opens the report; Deliver; the viewer shows the branch and the commit; the row no longer says "Branch ready". Profile: level, XP, the `approver` badge and three quests done; reload; the Developer wears the cap (`data-looks`) and the fern is still there.
3. **List and palette**: list view shows the job started from its row; the plan is approved with `Approve plan` from Ctrl+K; the row ends Done; the report opens from the palette.

`runCommand` repeats the search until the command is listed: the overview behind the palette can lag a moment behind the toast that announced the same thing.

## The rules test themselves

`e2e/rules.spec.ts` builds small pages with one deliberate fault each (a control outside the window, one under another element, a wide page, clipped text with and without an ellipsis, a div with a click listener, an `onclick` and a pointer cursor, a nameless icon button, a skipped Tab stop, a missing focus ring, a default cursor on a button, a modal with and without a Tab trap) and checks that exactly that rule reports it, and that a clean page reports nothing. It needs no hotel.

## Accepted exceptions (`support/allowlist.ts`)

| Rule | Element | Why |
|---|---|---|
| `cursor` | `.al-tray-item` | A draggable inventory item shows `grab`. |
| `clickable-role` | `.al-palette-wrap` | The dim area behind the palette closes it when clicked; Esc and Ctrl+K do it from the keyboard. |
| `viewport`, `tab` | `.al-wisp` | At small windows a wisp can lie on a tile outside the part of the room the stage shows. It is a bonus. |
| `text-cut` | `main.al-stage` | The room is wider than the stage at 360 px and the stage clips it on purpose. |
| console | `Failed to load resource` for `/favicon.ico` | The Vite dev server has no favicon. |

Known limits of the scan: accessible names are computed by a close approximation of the spec plus a second look at Chromium's `ariaSnapshot`, not by the browser for each element; contrast and the order of Tab stops are not checked.

## Visual comparisons (task 2, requirement 3)

`e2e/visuals.spec.ts` and `e2e/support/visual.ts`. Same hotel-per-test fixture as the journeys, so no state is shared. It reads no `data/` file.

### Making a screenshot repeatable

`freezeForScreenshots(page)` runs before the first load:

| What moves | How it is stopped |
|---|---|
| Motes, glow pulse, mailbox bounce, lamp and candle flicker, working signs, team bar bob, doors | `page.emulateMedia({ reducedMotion: "reduce" })`. The client reads `prefers-reduced-motion` at start for every one of these (`scene/glow.ts`, `ui/transition.ts`, the CSS). |
| Anything drawn from the time: the scene is ticked with `Date.now()` (`world.tick`), emote loops, elapsed times of the team bar, clock texts | `page.clock.setFixedTime(2030-01-01T12:00Z)`: `Date.now()` and `new Date()` never change. Timers keep running, so the page works as usual. |
| Walks, bubbles and wisps, which the server stamps with the real time | The fixed time lies years after any real stamp, so the page sees every walk finished and every bubble gone, whichever day the test runs. |
| Random numbers | None to fix: the client has no `Math.random` (the motes come from a sine hash of their index). |
| CSS transitions (panels, toasts) | `animations: "disabled"` in `toHaveScreenshot` (config), which ends them at once. |
| Text caret, hover | `caret: "hide"`; the mouse goes to the corner before each shot. |

Playwright also takes screenshots until two in a row are identical, so a repaint that is still happening fails the shot instead of being written.

Checked on 2026-11-14 (Windows, Edge): baselines written, then three full runs of 12 tests compared with them with zero differing pixels (no `maxDiffPixels` or threshold was needed; the config keeps Playwright's defaults). Control: with the freeze left out all 12 tests fail ("Failed to take two consecutive stable screenshots"), so the freeze is what makes the run repeatable, and a failure keeps `-expected`, `-actual` and `-diff` images in `test-results/` and in the HTML report (`reporter: [["list"], ["html", { open: "never" }]]`, `playwright-report/`, git-ignored).

Content that is not the same every day is not compared: the quests of the Profile (the date picks three of the pool) are left out; nothing else shown depends on the date (a clean hotel has level 0, no ledger and no reports).

### Screens

Each at 360x640, 800x600 and 1366x768, named `<screen>-<phone|laptop|desktop>.png`:

- Rooms: `lobby`, `hr-office`, `floor-default`, `floor-decorated`. The decorated floor has nine bought pieces (plants, lights, seats, a table, a rug, a poster) seeded into the scratch inventory (`hotelSeed`, `support/hotel.ts`); the test checks that the inventory file still holds all nine, because a piece the room cannot take goes back to the stock and the shot would show a bare floor.
- Panels and menus: `shop-furniture`, `shop-outfits`, `elevator`, `menu`, `actions-menu`, `profile-badges`, `profile-look`, `lobby-editing` (the Edit room bar), `palette`, `list`, `help`, `reception`, `hr-desk`, `computer`, `mailbox-empty`. The mailbox is clicked on the floor, so at 360 px, where it lies outside the stage, that one screen is not taken and the test says so in its annotations (no palette command opens an empty mailbox; the mailbox with a plan is compared at all three sizes as `plan`).
- Panels of a running job, from the test "panels of a job" (a hotel with no wisps, `hotelSeed: { noWisps: true }`, because the canvas draws them at moments that differ between runs): `activity-lines` (the job stopped at its plan), `plan` (the mailbox with the plan), `job-card` (opened from the progress strip once the job is done), `mailbox-report` and `report`. What the server stamps with the real time or the date is masked with `timeMasks` (`support/visual.ts`): the clock times of the activity lines, the report rows and the timeline, the durations of the steps table and the progress strip, and the Ecto balance (the quests the date picks pay different amounts). Everything else on those panels is compared. Checked on 2026-11-14: baselines written, then three repeats at the three sizes with zero differing pixels. A first version without `noWisps` failed at 800 and 1366 px because two wisps were drawn at other places each run.

Not compared yet: the panels of the night board, the Library, the review desk, the test lab, the directory, the coffee machine, the pipeline editor and the HR imports. Their furniture or data is not part of the scripted hotel's lobby and floor as the journeys use them, and each needs its own setup; they are listed in `docs/regression-backlog.md`. The journeys' rules (layout and interface) do not reach them either.

### Baselines per platform

`snapshotPathTemplate: "{testDir}/__visuals__/{platform}/{arg}{ext}"`: `e2e/__visuals__/win32/` is committed (2 MB). Edge and Playwright's Chromium on the same OS can differ in text, so baselines are made with the browser the platform's runs use (Edge through `E2E_CHANNEL=msedge` on Windows; Chromium on Linux in CI). A platform with no folder skips all of `visuals.spec.ts`: an auto fixture (`baselines`) calls `testInfo.skip` with "No visual baselines for <platform>..." before the hotel starts, and the skipped tests and that reason are in the report. While updating (`updateSnapshots` is `all` or `changed`) the gate is open.

`pnpm --filter @agentlife/client e2e:update-visuals` runs `playwright test visuals.spec.ts --update-snapshots=all`: it rewrites every baseline of this platform on purpose, and the diff of the PNGs is what a person reviews in the commit. Linux baselines do not exist yet; CI only skips them (see Wiring below).

## Wiring (task 3, requirements 4 and 5)

**Conductor** (`scripts/conduct.ts`, `runBrowserTests`). After `pnpm check` on main and before the leak scanner, it runs `pnpm --filter @agentlife/client exec playwright test --retries=1`, then `e2e:demo`. Environment: `CI=1` (Playwright starts its own test servers and refuses to reuse one already running on ports 8795 to 8798 and 5196 to 5199, so a stale server with its own state fails the run instead of skewing it; the hotel's own ports 8787 and 8788 are never used), `PLAYWRIGHT_HTML_OPEN=never`, `PLAYWRIGHT_JSON_OUTPUT_NAME` in the temp folder (the config adds the `json` reporter when it is set; a `--reporter=list,html,json` argument does not survive `cmd.exe`), and `E2E_CHANNEL=msedge` on Windows unless already set. `scripts/e2e-report.ts` (`summarizeE2e`, with a unit test) reads the JSON report: a test with status `flaky` (failed, passed on the one retry) goes to the conductor output and to `data/sessions/log.md` as `FLAKY <file> > <title>` and does not stop the merge; a failed test, a non-zero exit or a missing report stops it with the first failing names and `packages/client/playwright-report/index.html`. The browser tests run after the merge, like `pnpm check` does: a stop leaves the merge commit on local main, unpushed, as a failing check does.

**CI** (`.github/workflows/ci.yml`, job `browser`). Runs `pnpm --filter @agentlife/client e2e` on `ubuntu-latest` (Playwright's Chromium) and `windows-latest` (the installed Edge) on every push and pull request (the `main`-only filter on `push` is gone). The report and `test-results` are uploaded as an artifact when the job fails. `E2E_SKIP_VISUALS=1` leaves `visuals.spec.ts` out in CI (`testIgnore` of `playwright.config.ts`). Decision: Linux baselines are not committed and not written by CI (a baseline written by the run it judges proves nothing), and the Windows ones are not compared on the runner, whose Edge build and fonts can differ from this machine's. The visual comparisons run in the conductor, on the machine that made the baselines. Comparing them in CI later means committing baselines made on a runner (a workflow with `e2e:update-visuals` and an artifact), a separate decision. Not run on a real runner yet: the first push shows whether the Linux job passes.

**Manual list** (`docs/HUMAN-CHECKS.md`). Rewritten: what needs a human first (real runs, look and feel, decisions for the user, and a short group of checks that could be tests but are not covered yet), then every covered item ticked with its test. An item covered only in part is split: the covered part is ticked, the rest stays above.

## Bugs found

Each entry: what the test showed, the cause, the smallest fix, the test that now holds it.

1. **The Menu list was cut to its first item.** The viewport rule reported "control cut by an ancestor with overflow hidden" for the items of the Menu, and a screenshot showed only "Commands" under the top bar. `.al-top` had `overflow: hidden` and the list is positioned inside it. Fix: remove `overflow: hidden` from `.al-top` (`ui/shell.ts`); the strip and the middle group clip their own content. Held by: every `menu` screen of the lobby journey, at the three sizes.
2. **Open report from the palette or the list opened the mailbox on its list, not on the report.** When the client held the report already, the viewer opened at once and the floor's `open_panel` (an answer to the `show_panel` the action sent) came after and reset it. Fix: the action opens the viewer once the mailbox panel is open on this floor (`mailboxOpen` dependency in `list-actions.ts`); the `show_panel` is still sent, because it is what tells the floor the user saw the report. Held by: `list-mode.test.ts` (two tests) and the list journey ("report from the palette").
3. **The command palette let the focus out.** It is a modal (`aria-modal`) with one stop, but Tab moved the focus to the activity filters and the splitter behind the dim area. Fix: Tab is swallowed in the field (`ui/command-palette.ts`). Held by: the "palette" screen of the list journey and the modal test of `rules.spec.ts`.
4. **A toast or a wisp covered the list.** In the list view at 360 and 800 px the "plan ready" toast sat over the "night board" button of the list, and wisps floated over its rows. Fix: the list view hides `.al-turn` and `.al-wisp` (`ui/list-view.ts`); the rows show the same things ("Your turn", Review plan). Held by: the "list, plan waiting" screen.

Not changed, and written down: the toast for a report opened with its button (`panels.openReport`) does not tell the floor that the user saw it, so the floor's overview keeps saying "Report ready" until the mailbox is opened with the furniture or the palette. Not touched by this spec.
