# Human checks

The Playwright suite (`pnpm --filter @agentlife/client e2e`, see README) walks the hotel as a user does, checks layout and interface rules at 360x640, 800x600 and 1366x768, and compares screenshots with baselines. Whatever it covers is ticked at the end of this file with the test that covers it. The first part is what is left, and it needs a person.

## Needs a human

Tick an item when checked; tell Kiro about anything that fails.

### Real runs (real engine, `kiro-cli`, Docker, a real project)
- [ ] Copy a small git project into D:\AgentHotel, register it at the Reception, run one job with the real engine, approve, press "Deliver as branch": the branch `agentlife/<task>` exists in your repository and nothing else changed. (Scripted delivery is in the journeys; the real branch is not.)
- [ ] With two registered projects, start jobs on both and a third one to see the queue.
- [ ] A real job to the end: the team bar shows "Lv N" lines, a Developer and a QA go up a level, the first run starts at level 0 and old jobs give no XP or Ecto (the `since` rule), and a real "Deliver a branch" quest pays once (restart the world-server: the balance does not change).
- [ ] HR with the real engine: hire a QA, fire the first one, take the elevator (the old one leaves, the new one walks in with its name); "Suggest a team" and "Apply this team"; hire a second developer, a reviewer, a researcher and the Night intern on one project; rename, change model; the hire, rename and fire lines in the activity terminal.
- [ ] Imports: one https address in `packages/agent-engine/config/catalogue-sources.json`, import, read the persona and the review, approve, hire; change the file at the source and import again to see "Update waits for you". A real download from a listed source.
- [ ] Real `kiro-cli`: `AGENTLIFE_LIVE=1` run of the validate test for generated agent files; the import review and the HR agent with real replies; a job on a customised team (`--agent`, `--model`); the researcher and second reviewer with their agent files (read-only tier).
- [ ] Night intern: Ollama with `qwen3.5:4b` answers; with Ollama stopped `claude-haiku-5.5` answers and the report's Notes say so. The Night intern chosen as researcher fails the research step with its own message (known limit).
- [ ] Pipeline editor with a real engine: hire a Reviewer and a Researcher, add "+ Second review" and "+ Research", start a job (research notes artifact, "Second review" and "Research" in the report, a failing second review fails the job); fire the Reviewer while the pipeline uses it and see the refusal with its reason; save a pipeline while a job runs (the running job keeps the old one).
- [ ] A night shift for real, and the Library's Librarian note (Night owl and Librarian badges were tested with fake clocks).
- [ ] Furniture during a real job: move a desk and other pieces while the real engine works; the agents keep walking, and the next walk of a moved desk's agent goes to the new seat. Earn Ecto with a real delivery and see the toast (about 4 s); the first run of the real wallet starts at 0.
- [ ] Stop a `pnpm session` mid-run: the Builder ghost and its team row go idle after 10 minutes (also after a reload or a world-server restart).
- [ ] Coffee machine: buy it (Tables, 40 Ecto), place it, serve a tired agent in a live run of 60 real minutes.
- [ ] Touch screen: tap an item in the tray, then tap the floor (the suite uses a mouse). Check in a browser other than Edge too (the baselines and tests are Edge).

### Look and feel (is it clear, does it look right)
- [ ] Look once through the baseline images in `packages/client/e2e/__visuals__/win32/` (lobby, HR office, floors, shop, Menu, Actions menu, Profile, palette, list, Edit room) and say if anything looks wrong, cramped or ugly. After that the suite keeps them from changing by accident; a wrong one is fixed and rewritten with `e2e:update-visuals`.
- [ ] Art: the 25 furniture previews and the 23 outfit parts (do the cap, waistcoat, neckerchief, carnation, pumpkin hat, witch hat, bat bow tie and candle read as what they are?), on every role colour (teal, orange, purple, pink, yellow, blue), in the cheer and glum poses, and on the user's taller figure (a top covers only its upper 15 px).
- [ ] Motion that a screenshot cannot show: the level-up ring (1.6 s, and with reduced motion), the wisp blink and catch ring on a real moving wisp, the poses for sit, wave, dance and cheer (also on a project floor and the sitter's depth against a sofa and a chair), the mood face on the name tag, the parts staying in place on the user's figure while it walks and in all four directions.
- [ ] Arrange mode: the green and red overlay, the red cross, the selected outline, the standing-spot dots, a wall piece refused in the middle of the floor and turned with R on the north and west walls, how much room the "Editing" banner takes at a small height.
- [ ] A project floor with a full team (six ghosts): name tags that overlap when two stand close, the two spots beside the QA desk, the tooltip of a ghost at a spot, a hire walking in and a fired member walking out with the real engine.
- [ ] The recorded demo (public URL): elevator to the lobby and back, no Edit room button, the default look, no levels.

### Decisions for you
- [ ] hr-desk D10: the import review uses `agentlife-import-review` instead of `agentlife-security` (docs/risks-and-decisions.md). Waiting for your yes.
- [ ] Ghost skins: three slots only, so a ghost wears the neckerchief or the carnation, not both. A fourth `neck` slot is a small change.
- [ ] The HR ghost and the Builder cannot be dressed. Say if you want that.
- [ ] A hotel with the plain scripted engine and no wallet file has no wisps. Say if you expect them there.
- [ ] waiting-fun and furni-move are marked "first to cut if late".

### Could be a test, not covered yet
These are checks of behaviour that the suite does not run yet. They are listed so they are not forgotten; none needs a person's eyes.
- [ ] Restart the world-server (not only the page): placed pieces, stock, the lobby and HR office arrangements, worn outfits and the wardrobe are still there; a `data/layouts.json` written before ui-tidy is read and rewritten with `project:<id>` keys.
- [ ] Removing a project at the Reception puts its pieces back in the tray of another floor.
- [ ] A second purchase of an owned outfit part is refused and the item says "Owned". A badge part unlocks with a toast when its badge is earned (also at the next visit, also a member's badge).
- [ ] The same part on two members at once, a different top on a member who stands on the floor, None takes a part off; a fired member who wore something leaves the new hire bare and the part stays in Owned.
- [ ] The HR ghost stands at tile 7,1 of the HR office and the Builder's desk takes its seat when moved.
- [ ] Hover on a ghost or its team-bar row shows the stats (jobs, % passed, average step time). The pipeline editor's "Back to the default".
- [ ] The day after: three other quests and yesterday's gone.

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
- [x] A screen does not change by accident: `visuals.spec.ts` compares 4 rooms and 13 panels and menus at the three sizes with the baselines of this platform (see the human look at the top).
