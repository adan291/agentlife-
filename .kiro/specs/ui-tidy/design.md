# Design Document: ui-tidy

No new feature. Controls move to one obvious place each, the furniture editor becomes reachable from every floor, and two things that did not work get fixed. Everything keeps its keyboard shortcut. All user-facing text is English.

## Top bar (requirement 1)

Left to right: logo, floor name, job stepper (only while a job runs, as today), then the right group.

```
[Elevator] [Hotel|List] [Edit room] [40 Ecto][Lv 3] [Menu v]
 always     collapsible group (below 900 px it moves into the Menu)       always
```

- `.al-top-right` holds three parts in this order: the **Elevator** button, `.al-top-collapsible` (view toggle, Edit room, the chips) and the **Menu** button. Below 900 px (`BREAK_MENU_PX`, the same width at which the side bar starts collapsed) `.al-top-right[data-narrow="true"]` hides `.al-top-collapsible`; the hidden controls become items of the Menu. Nothing else collapses, so nothing overflows at 360, 800 and 1366 px.
- **Hotel / List** is one button with two words, the current view highlighted (`.al-view-toggle`, `data-view`), `aria-label` says what a click does ("Show the list of projects (L)").
- **Ecto and level chip**: the balance and the level button leave the stage corner (`.al-corner` is removed) and sit next to each other in `.al-top-collapsible`, keeping their classes (`.al-balance`, `.al-level`) and their texts. The level button still opens the Profile panel. The room took the space of the five buttons that move into the Menu (Commands, zoom, A-, A+, ?).
- **Edit room** (`.al-edit`): text "Edit room", or "Done" and `aria-pressed="true"` while editing. Enabled on a floor where the model says arranging is possible (`arrange.available`), disabled with a title in the recorded demo (no world-server to save a layout). In task 1 `available` is still "project floor"; task 2 makes it every floor (requirement 6.4), so the lobby disabled state of requirement 5.2 holds for task 1 only and the Playwright test is rewritten in task 2.
- Room for the stepper: with the new group the middle of the bar was 648 px at 1366 and the six labels need 657 (`stepperFitsLabels`). The buttons and chips of `.al-top-right` take the side padding `--al-s2` instead of `--al-s3`, which gives the stepper about 710 px, so its labels stay at 1366 (the job-insight test keeps its rule of labels from 1200 px).
- The zoom value is no longer printed in the bar, so the bar carries it as `data-zoom` (`1` or `2`) on `.al-top-right`; the e2e helpers read it from there.

## Menu (requirement 1.2)

`ui/menu-model.ts` (pure, unit tested) decides the items; `ui/menu.ts` draws them.

```ts
interface MenuState { narrow: boolean; zoom: number; view: ViewMode; editing: boolean; editable: boolean;
                      balance: number | null; level: string | null; fontMin: boolean; fontMax: boolean }
menuItems(state): MenuItem[]   // { id, label, shortcut?, disabled?, note? }
isNarrow(width): boolean       // width < BREAK_MENU_PX
```

Items, in order (the first three exist only when `narrow`, with a separator after them):

| id | label | shortcut |
|---|---|---|
| `view` | "Show the list" / "Show the hotel" | L |
| `edit` | "Edit room" / "Done editing" (disabled when not `editable`) | E |
| `profile` | "Profile: Lv 3, 40 Ecto" (hidden when there is no economy) | |
| `commands` | "Commands" | Ctrl+K |
| `zoom` | "Zoom 2x" (the note says what a choice does: "switch to 1x") | Z |
| `text-smaller` | "Text smaller" (disabled at the smallest size) | |
| `text-larger` | "Text larger" (disabled at the largest size) | |
| `help` | "Help and guide" | ? |

- The dropdown is built each time it opens, so labels are never stale. `role="menu"` with `role="menuitem"` buttons, the button has `aria-haspopup="menu"` and `aria-expanded`.
- Keyboard: Enter, Space or ArrowDown on the Menu button opens it with the first enabled item focused; ArrowUp/ArrowDown move (wrapping, skipping disabled items), Home and End jump, Enter or Space runs the item, Esc closes and returns focus to the button, Tab closes. A click outside closes. After an item runs the menu closes. Text size and zoom items run without moving focus away from the Menu button.
- `?` and `E` are new global keys (not inside text fields, not with Ctrl, Alt or Meta). `E` enters edit mode only (Esc and Done leave); it does nothing while a panel is open, as the number keys do.

## Edit room (requirement 2)

- `shell.editBar` is a new grid row between the top bar and the stage (`grid-template-areas: "top top" "edit edit" "side stage" "dock dock"`, row `auto`, zero high while the element is hidden). It is part of the layout, so it never covers the room.
- The arrange tool bar (`createArrangeBar`, class `.al-arrange` kept) mounts there. Contents: the line "Editing <floor>: drag furniture, arrows to move, R to turn, Esc when done"; the selected piece and the answer of the hotel (`.al-arrange-piece`, `.al-arrange-status`, unchanged, `aria-live`); buttons **Rotate (R)**, **Undo**, **Pick up**, **Reset layout** (with its confirmation), **Inventory** (shows or hides the tray, pressed by default, only where bought pieces can stand). **Done** is no longer in the bar: the top bar button reads Done while editing.
- `.al-arrange-open` (the stage-corner button) and its CSS are removed. The tray (`.al-tray`) loses the 44 px offset that cleared that button.
- `ArrangeBar.setFloor(name)` is called with the room name from `welcome`; the model does not know names.
- Entering edit mode switches the list view to the hotel view, locks the panels and hides the actions of the stage, as arrange mode does today (furni-move design, client section).

## Wiring

`createHud` takes `(mounts, actions, font?)` with `actions` an object (`zoom`, `help`, `useHere`, `elevator`, `view`, `palette`, `edit`, `profile`) instead of ten positional callbacks. New methods: `setEdit({ enabled, active, title })` (replaces `setArrange`), `setNarrowWatch` is internal (a `resize` listener). `setBalance` and `setLevel` mount into the top bar group. The Menu lives inside the HUD because its items call the same actions.

## Arranging that works (requirement 6, task 2)

### The re-select bug (6.1)
The Playwright test was written first (`furni-move.spec.ts`, "a moved piece can be grabbed, moved and turned again where it was dropped"): three drags by mouse, each from the tile where the last drop left the plant, a fourth with the plant right behind the sofa, two turns and a move by key, then a re-select by its drawing. It failed on the old code: "Sofa: tile 5, 9" was selected and dragged instead of the plant.

**Cause.** `pickFurni` returns the front-most piece whose hit volume (its footprint raised to its full height) is under the pointer. A piece that stands next to or behind a taller one is inside that piece's volume, so the press on the tile where the user dropped it grabbed the neighbour. Nothing was wrong with the state after a move (the model, the scene and the server agree); the picking was.

**Fix.** `pickAllFurni(room, sx, sy, opts)` lists every piece under the pointer, front-most first (`pickFurni` is its first). The scene sends the whole list to the model (`ArrangeInput.down(itemIds, tile)`). `ArrangeModel.pointerDown(under, tile)` keeps the piece that is already selected when it is in the list and the pointer is on one of its own tiles; otherwise the front-most piece is selected, as before. A piece the user has just moved stays selected, so it can be grabbed again on the tile where it was dropped, however tall the piece in front of it. A piece that was deselected is selected again by pressing on its drawing above the tile, where nothing in front covers it (the test does this at the end).

Not done: picking by the drawn pixels, which would also stop the hit volume of a narrow piece (a plant) from covering what stands behind it. Recorded as a known limit.

### Wall pieces and turning (6.2)
`wall` rule of `checkMove`, replaced. A wall piece (`mount: "wall"`) is *against* the north wall when every tile of its top row has no floor behind it (`y - 1`), and against the west wall likewise (`x - 1`); a corner tile is against both.
- Against a wall it must face the room (dir 4 on the north wall, dir 2 on the west wall; a corner accepts both). Anything else is refused: "Against a wall this piece faces the room. Move it away from the wall to turn it."
- Not against any wall: any direction. A wall piece may stand free on the floor.
- Floor pieces are unchanged. A 1x1 piece turns on its own tile, because the footprint does not change with the direction. The client already tries the next three quarter turns and uses the first that fits; it shows the first reason when none does.

### Clearer refusals (6.3)
- `taken` names the piece in the way: "That tile is taken by the potted plant." (the catalogue name in lower case).
- `spot` says which spot: "The tile in front of the elevator must stay free." for the door tile; "The Architect's standing spot is on that tile." (also Developer, QA, Builder, HR agent) and "A standing spot of the team is on that tile." for the guests' spots.
- `blocks_path` already names the target that becomes unreachable ("Blocks the path to the mailbox."; "Nobody could reach the computer desk from there." when it is the moved piece itself). The label of a standing spot is now "a standing spot of the team".
- Pieces may touch each other and any wall; no rule beyond the ones above.

### Every room editable (6.4)
- The Hotel keeps a base room (`bases`) for the lobby and the HR office too. `moveFurniture` and `resetLayout` work on any room; `NOT_EDITABLE` stays for an unknown room. Bought pieces (`placeFurniture`, `pickUpFurniture`) stay on project floors only: the inventory is kept per project (`data/inventory.json`) and the lobby and the HR office are not projects. The Inventory button and the tray are hidden there, and the server answers `layout_error` "Bought furniture can only stand on project floors." to a `furni_place` or `furni_pickup` for them.
- The same rules apply (`layoutProblem` must hold for the lobby and `hr.json` as they are; a test checks both). The elevator and the doors are pinned (`isPinned`). Reachability targets already cover the Reception, the shop counter, the directory and the HR desk (every interactive piece), plus every anchor.
- `lobby.json`: the `desk` anchor of the Builder gets `follows: "desk_builder"` (same rule as the project desks). `hr.json` gets an anchor `home_hr` at the tile of the HR ghost (7,1), a standing spot no solid piece may cover; the client puts the HR ghost on that anchor instead of the constant `HR_GHOST_TILE`. `home_hr` joins `AnchorNameSchema`; it is not required of any room.
- Layout storage is keyed by **room id** (`lobby`, `hr`, `project:<id>`), through `LayoutsFileSchema` (a transform that turns a bare project id into `project:<id>`, `roomKeyOf`). `LayoutStore.get(roomId)`, `set(roomId, layout)`. A file written before this change has bare project ids as keys; they are read as `project:<id>` and the file is rewritten in the new form on the next save. A project whose id is literally `lobby` or `hr` would have its old arrangement read as the room's (applied only where it fits, `applyLayout` never throws); accepted, nobody has one.
- `Hotel` option `layoutOf(roomId)` (was `layoutOf(projectId)`), applied to the lobby and the HR office at construction and to a project floor in `addProject`.
- The gateway's `arrange` passes the room id to `LayoutStore.set`; `projectId` is `undefined` outside project floors and only matters for bought pieces (`furni_place` and `furni_pickup` answer `layout_error` there; a `furni_move` of a bought piece needs the project).
- Client: `ArrangeModel.available` is true once the model knows a room. `room_layout` already carries the room id. The scene (`applyRoomLayout`) already rebuilds only the furniture. The HR ghost stands on the room's `home_hr` anchor (fallback (7,1) for an older room file). The demo stays read-only: Edit room is disabled when there is no live transport (`editButtonState`).

## Tests
- Unit (Vitest): `menu-model` (items, shortcuts, narrow rule, disabled states), Edit room button state, `taken`, `spot`, `wall` rules and their reasons, the lobby and the HR office pass `layoutProblem`, layout store keys and legacy conversion, Hotel arranging the lobby and the HR office, bought pieces refused there, the pick list and the selected-piece rule.
- Playwright: Menu by keyboard runs Zoom; Edit room enters and leaves on a project floor and in the lobby (task 1 had it disabled in the lobby; task 2 turned it on); no overflow of the top bar at 360, 800, 1366 px; the re-select test of task 2; lobby, HR office and project-floor editing (`edit-rooms.spec.ts`); the other arrange specs follow the new places.
