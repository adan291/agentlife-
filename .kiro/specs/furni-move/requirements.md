# Requirements Document

## Introduction
Each project floor is the user's office for that project, so the user should be able to arrange it. Today every project floor is a copy of `rooms/project-template.json`, with nine pieces of furniture in one row on the north wall and an empty south half. furni-move gives the template a better default layout and lets the user move and rotate furniture on a project floor, in the spirit of early-2000s hotel sims (own art and code only, see the security steering). The layout is saved per project, and the server checks it, so a layout can never leave a desk, the mailbox or the elevator unreachable.

The user asked for this on 2026-11-12, on the DiscordIA floor ("everything is crowded on one side of the room; maybe we should allow moving furniture like in Habbo"). It lifts the MVP exclusion "room editor" for project floors only. All user-facing text is in English.

## Requirements

### Requirement 1: Better default layout
#### Acceptance Criteria
1. THE project template SHALL spread the furniture over both walls and the floor: at most five wall items on the north wall, the reception of work (computer, mailbox, board) close to the elevator, the three agent desks with free tiles in front, decor in the south half.
2. Every interactive piece and every desk anchor SHALL stay reachable from the elevator (tested with the room validator and the pathfinder).
3. Existing project floors without a saved layout SHALL get the new layout.

### Requirement 2: Arrange mode
#### Acceptance Criteria
1. An "Arrange" button (project floors only, live mode only) SHALL switch the floor into arrange mode; Esc or "Done" leaves it. While arranging, clicking furniture does not open its panel. The button sits in the top right corner of the stage, not in the top bar: the bar has no room for one more button without taking the labels from the job stepper (measured: 599 px free at 1366 px wide, 657 px needed).
2. In arrange mode the user SHALL pick a piece with a click, move it by dragging or with the arrow keys, rotate it with R (or a button), and see the target tiles in green when the move is allowed and red when it is not, with the reason ("blocks the path to the mailbox", "tile taken", "outside the room").
3. "Undo" SHALL revert the last move and "Reset layout" SHALL restore the template layout after a confirmation.
4. The elevator and the room's door SHALL not move. Agents keep working while the user arranges; a desk that moves takes its agent's seat with it.

### Requirement 3: Saved and checked by the server
#### Acceptance Criteria
1. A move SHALL be a client message (`furni_move { itemId, x, y, dir }`, `furni_reset`) that the world-server validates against the room (bounds, heightmap, overlap, wall items on walls, floor items on the floor) and against reachability of every interactive piece, desk anchor and standing spot from the elevator. A refused move is answered with an error carrying the reason, and the room does not change.
2. THE world-server SHALL store the layout per project in `data/layouts.json` (git-ignored, atomic write, an unreadable file is moved aside and never overwritten) and apply it when the floor is built, so a restart keeps it. A saved position that no longer fits (template changed) falls back to the template position for that piece.
3. Anchors the agents use (`desk`, `computer`, `mailbox`, `board`) SHALL follow their furniture, and the standing spots (`home_*`) SHALL stay on their tiles, which no solid piece may cover (see design.md); the agent-engine does not change (it still speaks semantic anchors).
4. The lobby, the HR office and the demo (replay) SHALL not be editable.

### Requirement 4: Tests
#### Acceptance Criteria
1. Property test: any sequence of accepted moves leaves every interactive piece, desk anchor and standing spot reachable from the elevator, with no two pieces on one tile.
2. world-server tests: refused moves (outside, overlap, blocking, elevator, lobby), saved layout survives a restart, broken file moved aside, template change fallback.
3. Playwright: enter arrange mode, move the plant with the arrow keys, rotate it, leave, reload, the plant is still there; a blocking move shows the red reason.
