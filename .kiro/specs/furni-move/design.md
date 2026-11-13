# Design Document: furni-move

> Changed by ui-tidy (2026-11-13): every room can be arranged (not only project floors), layouts are stored per room id, a wall piece may stand free and faces the room only against a wall, refusals name the piece or the spot, and the Arrange button is now "Edit room" in the top bar with its tool bar in a banner under it. See `.kiro/specs/ui-tidy/design.md`; where the two differ, that file wins.

Pure rules live in `@agentlife/shared` (`layout.ts`), the world-server stores and applies them, the client (task 3) only draws and sends messages. The agent-engine does not change.

## Vocabulary
- **Piece**: a `PlacedFurni` of a room. A **placement** is `{ x, y, dir }` (dir 0, 2, 4 or 6).
- **Layout**: the pieces of one project floor that differ from the template, `{ [itemId]: Placement }`. The template is the default.
- **Template room**: `rooms/project-template.json` filled with the project's id and name (`roomForProject`). It never changes at run time.

## Layout rules (`shared/src/layout.ts`)
`checkMove(room, itemId, to, { occupied })` places one piece and returns `{ ok: true, room }` or `{ ok: false, code, reason }`. The first rule that fails answers, in this order:

| Code | Rule | Reason shown |
|---|---|---|
| `unknown_item` | the room has no such piece | "That piece is not in this room." |
| `pinned` | the piece is the elevator (a piece whose interaction is `elevator` or `door`) | "The elevator stays where it is." |
| `outside` | a footprint tile has no floor | "That is outside the room." |
| `taken` | a footprint tile is covered by another piece (any two pieces, walkable or not, never share a tile) | "That tile is taken." |
| `wall` | a wall piece (`mount: "wall"` in the catalogue) must hug a wall: dir 4 on the north wall (every tile behind the footprint has no floor), dir 2 on the west wall | "This piece goes on a wall." |
| `spot` | a solid piece covers a fixed anchor (the elevator door tile, the `home_*` and guest standing spots) | "A standing spot of the team is on that tile." |
| `occupied` | someone stands on, or is walking over, a footprint tile (`occupied` comes from the sim) | "Someone is standing there." |
| `blocks_path` | after the move, a target is not reachable from the elevator | "Blocks the path to the mailbox." / "Nobody could reach the computer from there." |

- Reachability uses the room's own path grid (`buildPathGrid`) and `canStep` (8 neighbours, no corner cutting), flood-filled from the `door` tile. Targets: every anchor of the room (desks, computer, mailbox, board, door, homes, guest spots) and the use tile of every interactive piece. The label names the first unreachable target (interactive pieces first). When the unreachable target belongs to the moved piece itself, the reason says nobody could reach it from there.
- The same checks, applied to every piece of a room, are `layoutProblem(room)` (used to validate a whole saved layout and by the property test).
- Moves are checked one at a time, and every accepted move leaves a valid room, so a sequence of accepted moves can only end in a valid room (requirement 4.1).
- Rotation is a move with a new `dir`; the footprint keeps its `x, y` corner and swaps width and length for dir 2 and 6 (`footprintTiles`). The client picks the next `dir`; the server only checks the result.
- Catalogue: `FurniDef.mount` (`"wall"` or absent = floor). Wall pieces: `board`, `mailbox`, `library_shelf`, `review_desk`, `test_lab`. Nothing else in the catalogue changes.

## Where anchors live
Anchors stay in the room JSON (`anchors`), as today. A new optional field `Anchor.follows` (an `itemId`) says the anchor is the use tile of that piece:

- `x, y` = `useTile(piece)`, `dir` = opposite of the piece's `dir` (the avatar faces the piece).
- Which anchors follow: `computer` (`computer_desk_1`), `mailbox` (`mailbox_1`), `board` (`board_1`) and each agent's `desk` (`desk_architect`, `desk_developer`, `desk_qa`). `checkRoom` rejects a room where a followed anchor is not on the use tile of its piece, so the template cannot drift from its own rules.
- `home_*` and `home_guestN` anchors do not follow anything. They are fixed tiles that no solid piece may cover (`spot`). The user can see why a tile is refused because arrange mode (task 3) draws the spots. Requirement 3.3 said standing spots follow their furniture; this is the narrower reading chosen here: a spot that moved with a plant would lose its meaning (where a ghost waits), and the desks already carry the agent's seat (requirement 2.4). Requirement 3.3 is reworded.
- `applyPlacements(room, placements)` moves pieces and recomputes every followed anchor in one pass. It is the only place that knows the rule, used by `checkMove`, `applyLayout` and the world-server.
- The agent-engine still sends `desk`, `computer`, `mailbox`, `board`, `home`, `door`; `resolveAnchor` finds them in the (new) room. A walk in progress to the old tile finishes there; the next `agent.goto` goes to the new one.

## Default layout (`rooms/project-template.json`)
12 × 10 floor, the elevator in the south-west corner of the west wall (pinned, `elevator_1`). Item ids do not change.

- West wall, close to the elevator: `board_1` (0,3), `mailbox_1` (0,6). Computer desk `computer_desk_1` on the floor at (3,7), use tile (4,7).
- North wall (three wall pieces, at most five): `review_desk_1` (4,0), `test_lab_1` (7,0), `library_shelf_1` (10,0). Decor: cobweb (0,0), plant (1,0), lamp (3,0), plant (11,0).
- Desks on the floor with free tiles in front: Architect (4,2), Developer (4,5), QA (10,4) facing west. Standing spots between and around them.
- South half: sofa (6,9), pumpkin lamp (11,8), a plant, the chair at the computer.
- A test checks the template: every rule above holds, at most five wall pieces on the north wall, everything reachable from the elevator, no two pieces on a tile.

Existing floors without a saved layout get the new template because a floor is always built from the template plus its layout (requirement 1.3). Nothing is migrated.

## Saved layout and applying it
- `applyLayout(templateRoom, layout)` returns `{ room, skipped }`. It first tries the whole layout at once (`applyPlacements`, then `layoutProblem`). If that fails (the template changed under the layout), it applies the entries one by one with `checkMove`, repeating while at least one more entry fits, and every entry that never fits is skipped, so that piece stays at its template position. Entries for unknown or pinned pieces are skipped too. Applying never throws.
- `layoutOf(templateRoom, room)` is the other direction: the pieces whose placement differs from the template.
- `Hotel` keeps the template room of each floor (`baseOf`) and the optional `HotelOptions.layoutOf(projectId)` used by `addProject`. New methods (pure, no I/O): `moveFurniture(roomId, itemId, to, save?)`, `resetLayout(roomId, save?)`. Both refuse the lobby and the HR office (`code: "not_editable"`, requirement 3.4), take the occupied tiles from the sim, call `save(layout)` after the check and before the change (if `save` throws, nothing changes, `code: "save_failed"`), then `WorldSim.updateRoom(room)`.
- `WorldSim.room` becomes a getter; `updateRoom` swaps the room and rebuilds the path grid. Avatars keep their tiles. `tilesInUse()` lists the tile of every avatar and the rest of every walk in progress.
- Reset restores the template. It is refused with `occupied` when someone stands on a tile that a template piece needs.
- Pinned pieces are never part of a layout.

## Storage (`world-server/src/layout-store.ts`)
- `data/layouts.json` (git-ignored; `AGENTLIFE_LAYOUTS_FILE` overrides it, used by tests): `{ [projectId]: Layout }`. Validated with `LayoutsFileSchema` (at most 100 pieces per project).
- Written after every change: temporary file in the same folder, then rename (atomic). An unreadable or invalid file is renamed to `layouts.json.bad-<time>` and the store starts empty; it is never overwritten (same as `TeamStore`).
- `get`, `set` (an empty layout deletes the entry), `delete`. A removed project keeps its entry; registering the same id again gets the old arrangement back.
- The store is created in `main.ts` and passed to both `Hotel` (read when a floor is built) and the gateway (written on a move). Tests that do not pass a store never touch the disk.

## Messages (`shared/src/protocol.ts`)
- Client: `furni_move { itemId, x, y, dir }` (`itemId` 1–100 characters, `x` and `y` integers within ±100, `dir` 0, 2, 4 or 6) and `furni_reset {}`.
- Server: `room_layout { roomId, furni: PlacedFurni[], anchors: Anchor[] }` (the whole new state of the user's room, sent only to the user while in that room). The client replaces its pieces and anchors; it does not get a new `welcome`, so its panels and job state stay.
- Error code `layout_error`, message = the reason of the table. A refused move changes nothing and sends no `room_layout`.
- Only the user's own floor can change (`userRoom()`), and only a project floor. The checks are repeated on the server whatever the client did; the client may run `checkMove` itself to colour tiles while dragging (the code is shared).
- The demo (replay transport) answers neither message.

## Gateway
`furni_move` and `furni_reset` are handled like the other floor commands: a project floor is required, the answer is `room_layout` or `error layout_error`. A successful move also sends `room_layout` after the walks already queued (`enqueue`), so the avatars do not jump. `syncProjects` passes the stored layout to `hotel.addProject`, so a restart keeps the arrangement. The rate limiter already caps messages per second.

## Tests (tasks 1–2)
- shared: template rules, each refusal code, rotation, anchors follow a moved desk, `applyLayout` fallback, fast-check: any sequence of random moves, accepted or not, leaves a room where everything is reachable and no two pieces share a tile.
- world-server: refused moves through the gateway (outside, taken, blocks the path, elevator, lobby), `layout_error` text, saved layout after a gateway restart, broken file moved aside, a template change falls back for that piece, store write is atomic.
- Playwright and the client are task 3.

## Client: arrange mode (task 3)
- `ui/arrange.ts` (`ArrangeModel`) is the whole behaviour and knows neither DOM nor Pixi. Pointer events (`pointerDown/Move/Up`), keys (`arrangeKey`: arrows = one tile along the floor axes, R = quarter turn, Esc = leave, Ctrl+Z = undo) and the server's answers (`onLayout`, `onRefused`) go in; `furni_move` / `furni_reset` go out; `overlay()` and `view()` say what to draw. Each move is checked first with the shared `checkMove`, so the colour and the reason appear at once; the server repeats the check and also knows who stands where (`occupied`).
- One move is on its way at a time. Key presses wait in a queue (8 at most) and are sent from the position the previous answer gave; the first refusal empties the queue. No answer after 4 s frees the bar ("The hotel did not answer").
- Undo keeps the placement before each accepted move (cleared when arranging stops, the room changes, or the layout is reset) and sends it back as a normal `furni_move`. Reset layout asks first in the bar, then sends `furni_reset`.
- A drag keeps the grab offset (tile under the pointer minus the piece's corner), so a tall piece grabbed away from its corner lands where the preview showed. Rotation tries the next three quarter turns in order and uses the first that fits; if none fits the first reason is shown (a wall piece: "This piece goes on a wall.").
- Scene: `RoomView.setArrange(overlay)` draws the team's standing spots as dots, the selected piece outlined, and the preview in green, or red with a cross (colour is not the only signal). `WorldView.applyRoomLayout` replaces only the furniture objects (glow, flames, desk monitors and candles, mailbox badge) when `room_layout` arrives; avatars, signs, panels and job state stay. `pickFurni(..., { includeWalkable: true })` lets chairs and cobwebs be picked while arranging; the elevator is never grabbed.
- While arranging, `Panels.lock(true)` closes the open panel and ignores every way to open one (server `open_panel`, toasts, list view); the mailbox does not count a blocked `open_panel` as seen. Arranging stops on a new `welcome`, when the list view is shown, and on Done / Esc. Layout is not offered in the recorded demo (no live transport).
- The Arrange button is a stage corner button (`.al-arrange-open`), see requirement 2.1. The tool bar (`ui/arrange-bar.ts`) is at the bottom left of the stage: piece and tile, last answer (green / red text), Rotate, Undo, Reset layout, Done. Button names are their visible words.
- Playwright (`e2e/furni-move.spec.ts`) uses a scratch layouts file (`AGENTLIFE_LAYOUTS_FILE` in `playwright.config.ts`) and resets the floor at the start and end of each test.
