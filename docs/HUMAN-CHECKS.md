# Human checks

The Playwright suite (`pnpm --filter @agentlife/client e2e`, see README) walks the hotel as a user does, checks layout and interface rules at 360x640, 800x600 and 1366x768, and compares screenshots with baselines. Whatever it covers is ticked at the end of this file with the test that covers it. The list below is what is left, and it needs a person. Checks that a test could do but none does yet are in `docs/regression-backlog.md`.

## Needs a human

Tick an item when checked; tell Kiro about anything that fails.

- [ ] A real job on a real project: copy a small git project into D:\AgentHotel, register it at the Reception, run a job with the real engine, approve, press "Deliver as branch". The branch `agentlife/<task>` exists in your repository and nothing else changed. XP, Ecto and the "Deliver a branch" quest are paid once (restart the world-server: the balance does not change). With two projects, start jobs on both and a third to see the queue. (The suite delivers with a scripted engine only.)
- [ ] HR and pipeline with the real engine and `kiro-cli`: hire, rename, fire, "Suggest a team", a job on a customised team, a Reviewer and a Researcher in the pipeline (second review, research notes, a refusal to fire a member the pipeline uses), imports from a real source (persona, review, "Update waits for you"), the Night intern with Ollama and without it.
- [ ] A real night shift and the Librarian's note in the Library.
- [ ] Long real runs: furniture moved during a real job, the coffee machine serving a tired agent in 60 real minutes, the Builder ghost going idle 10 minutes after a stopped `pnpm session`.
- [ ] A touch screen (tap an item in the tray, then the floor) and a browser other than Edge (the tests and baselines are Edge).
- [ ] Look once through the baseline images in `packages/client/e2e/__visuals__/win32/` (rooms and panels, 127 images) and say if anything looks wrong, cramped or ugly. A wrong baseline is fixed and rewritten with `e2e:update-visuals`; from then on the suite keeps screens from changing by accident.
- [ ] Art: the 25 furniture previews and the 23 outfit parts read as what they are, on every role colour, in the cheer and glum poses and on the user's taller figure.
- [ ] Motion a screenshot cannot show: the level-up ring, the wisp blink and catch ring, the poses (sit, wave, dance, cheer, the sitter's depth against a sofa), the mood face, the outfit parts staying in place while a figure walks in all four directions.
- [ ] Edit room look: the green and red overlay, the cross, the selected outline, the standing-spot dots, a wall piece turned on the north and west walls, the room the "Editing" banner takes at a small height.
- [ ] A floor with a full team (six ghosts): overlapping name tags, the spots beside the QA desk, a hire walking in and a fired member walking out.
- [ ] The recorded demo at the public URL: elevator to the lobby and back, no Edit room button, the default look, no levels.
- [ ] Decisions for you: hr-desk D10 (import review by `agentlife-import-review`); three outfit slots, so a ghost wears the neckerchief or the carnation, not both; the HR ghost and the Builder cannot be dressed; a hotel with the plain scripted engine and no wallet file has no wisps; waiting-fun and furni-move are "first to cut if late"; regression-suite: CI skips the visual comparisons, four bug fixes in product code (design.md "Bugs found"), and the Construction board is not compared at 360x640 (it lies outside the stage and no command opens it).

## Covered by tests (ticked)

Spec files are in `packages/client/e2e/`. A journey runs at the three sizes. A rule is checked on every screen of the journeys.

### project-registry, hotel-floors
- [x] Lobby, elevator with door transition, project floor with its name (checked by the user 2026-11-12). Also `shell.spec.ts` "the elevator takes the user to a project floor, and a reload returns there", and `journeys.spec.ts` "one run through the hotel".
- [x] A scripted delivery shows "Branch ready" before and the delivered branch after: `journeys.spec.ts` "one run through the hotel: shop, HR office, a floor, a job to its delivered branch, the Profile".

### hr-desk
- [x] The HR office draws its desk and its ghost; its elevator takes the user back: `hr.spec.ts` (two tests); the member's Look section at the HR desk: `outfits.spec.ts` "buys the flat cap, puts it on the Developer at the HR desk..." and `visuals.spec.ts` "panels on the HR office and a project floor" (`hr-desk`).

### pipeline-editor
- [x] Move a step with the arrows or by dragging, the broken rule in red, Save off until fixed, add an optional step and pick a member from the themed menu, Save sends the pipeline: `pipeline-editor.spec.ts` (six tests).

### furni-move, furni-shop, ui-tidy (arranging and shopping)
- [x] Move a piece, turn it, press on it again where it was dropped (several times, mouse and arrow keys, without a reload): `furni-move.spec.ts` "a moved piece can be grabbed, moved and turned again where it was dropped..." and `journeys.spec.ts` "lobby: edit the room, use the Menu with the keyboard, wave from the Actions menu".
- [x] A move that blocks the way is refused with the reason; Reset asks first; undo; leave and reload keeps the layout: `furni-move.spec.ts`, `edit-rooms.spec.ts` ("a move that would shut off the Reception desk says which path it blocks", "the mailbox turns in place once it is away from the wall...", "a piece moves, and the arrangement is still there after a reload").
- [x] Edit room in the lobby, the HR office and a project floor, the banner, E and Esc, Done, the elevator and doors stay: `ui-tidy.spec.ts` ("the Edit room" tests), `edit-rooms.spec.ts` ("move, turn and reset a plant, and the elevator stays").
- [x] Buy a piece, drag it from the tray onto the floor, reload, pick it up; click the item, then the floor; the lobby has no tray: `furni-place.spec.ts` (three tests) and the floor part of `journeys.spec.ts` "one run through the hotel".
- [x] The Ecto balance sits in the top bar next to the level, does not overflow, and folds into the Menu below 900 px: `furni-shop.spec.ts` ("Ecto balance" tests); nothing is cut or covered by another element at 360, 800 and 1366 px: the `viewport`, `covered` and `text-cut` rules in every journey.
- [x] The Shop has the pictures on its pages, a button the user cannot pay is disabled, a badge part reads "Locked: earn the Hotel veteran badge", Esc closes it: `furni-shop.spec.ts` ("the shop counter" tests); buying a fern and the flat cap lowers the balance by 14 and 40: `journeys.spec.ts` "one run through the hotel".
- [x] The Menu with the mouse and the keyboard (arrows, Esc, Zoom, Text larger, Help, the keys Z, ? and Ctrl+K), and below 900 px Hotel / List, Edit room and Profile come first: `ui-tidy.spec.ts` ("the Menu" tests, "every control is reachable: in the bar or in the Menu", "below 900 px the Menu starts Edit room...").
- [x] The top bar does not overflow and always has the Menu and the Elevator at the three sizes: `ui-tidy.spec.ts` "does not overflow, and the Menu and the Elevator are always there" and the rules.
- [x] The Actions menu is closed by default, opens upwards with Wave, Dance, Cheer and Sit down, the keys 1 to 4 work with it closed, it reads Stand up after sitting, it is out of the way while editing and in the list view, and the dock does not cut it: `ui-tidy.spec.ts` ("the Actions menu" tests), `waiting-fun.spec.ts` "the Actions menu sits the avatar on the sofa...".

### team-progress, waiting-fun
- [x] A scripted job raises the Developer's XP, earns a badge and completes the day's quests; after a reload they are still done: `team-progress.spec.ts` (two tests); the Profile shows level, XP, the `approver` badge and the quests of the run: `journeys.spec.ts` "one run through the hotel".
- [x] The Lv and Ecto chips and the Profile panel fit at the three sizes without being cut or covered: the rules on the Profile screens of `journeys.spec.ts`.
- [x] A wisp appears during a job and catching it adds 1 Ecto; with reduced motion it does not move and the job ends cleanly: `waiting-fun.spec.ts` (two tests) and `journeys.spec.ts` "one run through the hotel".
- [x] The user sits on the sofa, gets up again, the keys work except in a text field: `waiting-fun.spec.ts` "the Actions menu sits the avatar on the sofa of the lobby and gets it up again...".

### ghost-skins
- [x] Buy parts, put the flat cap on the Developer at the HR desk, it wears it on the floor, also after a reload and after going to another floor and back: `outfits.spec.ts` (first two tests) and `journeys.spec.ts` "one run through the hotel".
- [x] Dress the user's own figure in the Profile's Look tab: `outfits.spec.ts` "the user dresses their own figure in the Profile panel".

### list view and the palette
- [x] The hotel and the list switch with the button and with L, L does nothing in a text field, a job starts from the list, the plan is approved from the palette, the palette works with the keyboard only: `list-mode.spec.ts` (four tests), `journeys.spec.ts` "list view and the command palette".

### Layout and screens
- [x] Regions do not overlap, nothing scrolls the page, the canvas fills the stage, the side bar and the dock collapse, the dock height is remembered: `shell.spec.ts`; the job stepper has no scroll bars at its sizes: `job-insight.spec.ts`.
- [x] Every screen of the journeys at the three sizes: nothing outside the window or covered, no horizontal scroll bar, no text cut, every clickable element has a role, a name, a Tab stop, a focus ring and a pointer cursor, no console error: `journeys.spec.ts` (`expectScreen`), checked against deliberately broken pages by `rules.spec.ts`.
- [x] A screen does not change by accident: `visuals.spec.ts` compares 4 rooms and 20 panels and menus, including Help, the Reception and, for a running job, the activity lines, the plan, the job card, the mailbox with a report and the report (clock times, durations and the Ecto balance masked), at the three sizes with the baselines of this platform (see the human look at the top).
