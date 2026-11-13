VERDICT: PASS

Branch `feat/ui-tidy`, spec `ui-tidy`, tasks 1-3 marked `[x]`, 4 commits over main (design + one per task).

Commands run on 2026-11-13:
- `pnpm check`: shared 458, client 706, world-server 415, agent-engine 682 (7 skipped), scripts 16, all passed.
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e ui-tidy edit-rooms furni-move waiting-fun`: 35 passed (no test servers were running beforehand). The other e2e specs were not run here.

Requirement 5.2 says Edit room is "disabled in the lobby". Requirement 6.4 and the design replace that (every room is editable), so the lobby is judged against 6.4. The demo is the only disabled case.

| Criterion | Result | Evidence |
|---|---|---|
| 1.1 top bar order and fixed group | PASS | `ui-tidy.spec.ts` "every control is reachable: in the bar or in the Menu" (360, 800, 1366 px); `hud.ts` (`createHud`, `HudActions`, `setEdit`); design "Top bar" |
| 1.2 Menu items, shortcuts, Esc / outside click / after choice, keyboard | PASS | `menu-model.test.ts` "lists the five always-there items with their shortcuts", zoom note, disabled font limits; `ui-tidy.spec.ts` "opens with the keyboard, moves with the arrows and runs Zoom", "Esc closes it and gives the focus back; so does a click outside", "ArrowUp from the button opens it on the last item; Text larger and Help run", "the keys keep working: Z, ?, Ctrl+K" |
| 1.3 collapse below 900 px, no overflow at 360/800/1366 | PASS | `menu-model.ts` `BREAK_MENU_PX = 900`, `isNarrow`; `menu-model.test.ts` "when the top bar has collapsed..."; `ui-tidy.spec.ts` "top bar at 360x640 / 800x600 / 1366x768 does not overflow..." and "below 900 px the Menu starts Edit room..." |
| 2.1 Edit room on every floor, disabled only in the demo | PASS | `menu-model.ts:72-90` `editButtonState`; `menu-model.test.ts` "is disabled in the recorded demo, with the reason in its title"; `ui-tidy.spec.ts` "works in the lobby too"; `edit-rooms.spec.ts` (lobby, HR office, project floor) |
| 2.2 Done label, banner text, tool bar in banner, corner button removed | PASS | `arrange-bar.ts:65` text "Editing <floor>: drag furniture, arrows to move, R to turn, Esc when done"; `menu-model.test.ts` "reads Done and is pressed while editing"; `ui-tidy.spec.ts` "enters and leaves edit mode on a project floor, with a banner under the top bar"; no `al-arrange-open` in `packages/client/src` |
| 2.3 E key outside text fields | PASS | `menu-model.ts` `isEditKey`; `ui-tidy.spec.ts` "the E key starts editing and Esc leaves; E does nothing in a text field" |
| 3.1 Actions button and menu, keys 1-4 | PASS | `waiting-fun-ui.test.ts` `actionItems` tests (Wave 1, Dance 2, Cheer 3, Sit 4, Stand up, disabled Dance); `ui-tidy.spec.ts` "is a closed menu by default, opens with the keyboard and Wave sends the emote", "the keys 1 to 4 still work without opening it..."; `waiting-fun.spec.ts` "the Actions menu sits the avatar on the sofa..." |
| 3.2 nothing covered or cut by the dock at three widths | PASS | `ui-tidy.spec.ts` "the Actions button and its menu are inside the stage and not cut by the dock at 360x640 / 800x600 / 1366x768" (asserts bounds, no horizontal overflow, saves screenshots to `test-results/`) |
| 4.1 Builder (ghost and team row) back to idle after 10 min | PASS | `builder-watch.ts` (`BUILDER_STALE_MS = 10 * 60_000`, `expired`); `gateway.ts:382-394`, `1212`, `1622`; `builder-watch.test.ts` "goes back to idle after the stale time...", "keeps a busy Builder that goes on reporting", "an event from hours ago...". The client turns ghost and row idle on `agent_state` (`world-view.ts:298`, `team-bar.ts:102`), no test of that step for the Builder in particular |
| 5.1 unit tests of menu model and stale Builder | PASS | `menu-model.test.ts`, `builder-watch.test.ts` (both pass in `pnpm check`) |
| 5.2 Playwright: Menu by keyboard + Zoom; Edit room on/off; Actions Wave; no overflow at 3 widths; existing e2e updated | PASS | `ui-tidy.spec.ts` (all named above), `furni-move.spec.ts` "Edit room works on a project floor and in the lobby"; `furni-shop`, `furni-place`, `list-mode`, `team-progress`, `waiting-fun` specs touched in the diff and the ui-tidy, edit-rooms, furni-move and waiting-fun runs pass |
| 6.1 re-select bug fixed, move x3, turn x2, no reload | PASS | `furni-move.spec.ts` "a moved piece can be grabbed, moved and turned again where it was dropped, by mouse and by keys, without a reload"; `arrange.test.ts` pick-list and selected-piece tests; `pick.ts` `pickAllFurni` |
| 6.2 turn in place, wall pieces free, reason on refusal | PASS | `layout.test.ts` (shared) wall rows ("Against a wall this piece faces the room..."); `inventory.test.ts` "a wall piece may stand free on the floor; against a wall it faces the room"; `placing.test.ts` wall-piece test; `edit-rooms.spec.ts` "the mailbox turns in place once it is away from the wall, and a refusal names the piece in the way" |
| 6.3 fewer, explained refusals | PASS | `layout.test.ts` (shared) `taken` and `spot` messages ("taken by the agent desk", "The Architect's standing spot is on that tile."); `world-server/test/layout.test.ts` "Blocks the path to the mailbox."; `edit-rooms.spec.ts` "a move that would shut off the Reception desk says which path it blocks" |
| 6.4 every room editable, saved per room id, demo not editable | PASS | `layout.test.ts` (shared) "the lobby and the HR office are valid arrangements as they are"; `world-server/test/layout.test.ts` legacy conversion "reads a file written before every room could be arranged..." and bought-piece refusal (line 162-164); `edit-rooms.spec.ts` lobby, HR office (with reload) and project floor; `menu-model.test.ts` demo disabled |
| 6.5 Actions menu closed by default | PASS | `ui-tidy.spec.ts` "is a closed menu by default..."; `waiting-fun.spec.ts` emote spec uses the menu |

## To fix
Nothing.

Notes (not failures):
- Design records a known limit: picking is by hit volume, not by drawn pixels. An unselected piece standing behind a taller one is picked by its drawing above the tile. The 6.1 test passes with this limit.
- STATUS.md says `pnpm check` failed once under load in `fun-gateway` and `wisp-gateway`. It passed here on the first run.

## Human checks
- Look at the top bar, Menu, Edit room banner and Actions menu in a real browser (not only Edge under Playwright) at about 360, 800 and 1366 px. Check that nothing looks cramped or cut. The tests check bounds and overflow, not appearance.
- Try Edit room in the lobby and the HR office by hand: move, turn with R, reset, reload. Confirm refusal messages read clearly and the elevator and doors cannot move.
- With the real engine, stop a `pnpm session` mid-run and confirm the Builder ghost and its team row go idle after 10 minutes. Tests use short timeouts.
- Confirm the HR ghost still stands at the HR desk after the `home_hr` anchor change (design says tile 7,1).
