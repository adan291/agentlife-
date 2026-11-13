# Requirements Document

## Introduction
The top bar and the stage collected one button per feature: Elevator, List, Commands, zoom, A−, A+, ?, the Ecto and level chips, the Arrange button in a corner of the stage (project floors only, easy to miss), and the emote bar over the bottom right of the stage, where it is cut by the activity dock. On 2026-11-13 the user could not find how to move furniture and asked for a clear "Edit room" button and a menu for actions, to clean up the UI.

ui-tidy groups the controls so each has one obvious place. No new features; every existing action keeps working and keeps its keyboard shortcut. All user-facing text in English.

## Requirements

### Requirement 1: Top bar with three groups
#### Acceptance Criteria
1. THE top bar SHALL show, left to right: the logo and floor name; the job stepper (only while a job runs, as today); then a fixed group: **Elevator**, **Hotel / List** (one toggle with two states), **Edit room**, the **Ecto and level** chip (opens the Profile panel), and a **Menu** button.
2. **Menu** SHALL open a dropdown with: Commands (Ctrl+K), Zoom 1×/2× (Z), Text smaller / larger, Help and guide (?), and the shortcut next to each. It closes on Esc, on a click outside and after a choice, and is fully keyboard usable (arrows, Enter).
3. At widths below 900 px the fixed group SHALL collapse into the Menu except Elevator and Menu; nothing overflows or scrolls at 360, 800 and 1366 px (Playwright).

### Requirement 2: Edit room
#### Acceptance Criteria
1. **Edit room** SHALL be in the top bar on every floor and enter arrange mode there (requirement 6.4: every room is editable); it is disabled only in the recorded demo.
2. While editing, the button reads **Done** and is highlighted, a banner under the top bar says "Editing <floor>: drag furniture, arrows to move, R to turn, Esc when done", and the arrange tool bar (Undo, Reset, Inventory) sits in that banner instead of a stage corner. The stage-corner Arrange button is removed.
3. Entering edit mode SHALL be possible with the E key outside text fields.

### Requirement 3: Actions for the avatar
#### Acceptance Criteria
1. The emote bar SHALL become one **Actions** button at the bottom left of the stage, above the dock, that opens a small menu: Wave (1), Dance (2), Cheer (3), Sit (4, when a seat is near) and any other avatar action of waiting-fun. Keys 1 to 4 keep working.
2. Nothing on the stage SHALL be covered by the dock or cut at its edges at the three widths of 1.3 (Playwright screenshots).

### Requirement 4: Stale Builder state
#### Acceptance Criteria
1. The Builder ghost and its team row SHALL return to idle when no build session has reported for 10 minutes (seen: "thinking, running pnpm" hours after the conductor stopped).

### Requirement 5: Tests
#### Acceptance Criteria
1. Unit tests for the menu model (items, shortcuts, collapse rule) and the stale Builder timeout.
2. Playwright: open the Menu with the keyboard and run Zoom; Edit room on a project floor enters and leaves arrange mode, disabled in the lobby; Actions menu runs Wave; no overflow at 360, 800, 1366 px. Existing e2e tests updated to the new places.

### Requirement 6: Arranging that works the way the user expects (user feedback 2026-11-13, after trying furni-move)
#### Acceptance Criteria
1. **Bug:** after moving a piece, the user could not select or move it again. The same piece SHALL be selectable, movable and turnable any number of times in a row, by mouse and by keys (Playwright: move the plant three times, turn it twice, with no reload).
2. Every piece SHALL turn with R, in place: a piece whose footprint is 1×1 (mailbox, board, library shelf, lamp, plant) always turns on its own tile. A wall piece (`mount: "wall"`) SHALL be allowed to stand free on the floor as well, so it can turn to any direction; on a wall it still faces the room. A turn is refused only for a real reason (a larger footprint no longer fits, or it blocks a path), and the reason is shown.
3. Places where a piece "cannot go" SHALL be fewer and explained: the standing spots of the team stay free, but a refusal always says which rule and, for a blocked path, which piece becomes unreachable. Pieces may stand next to each other and against any wall.
4. **Every room** SHALL be editable: the lobby and the HR office too, with the same rules (the elevator, the doors, the Reception, the shop counter and the HR desk stay reachable; the elevator and the doors do not move). Layouts are saved per room id (`data/layouts.json`), and the demo stays not editable.
5. Requirement 3.1 (Actions menu) is confirmed by the user: the emote buttons take space on the stage and must be a closed menu by default.
