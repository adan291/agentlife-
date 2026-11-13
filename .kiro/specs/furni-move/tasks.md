# Implementation Plan

- [x] 1. Default layout and layout rules
  - New `rooms/project-template.json` layout; shared `layout.ts`: apply a saved layout to a room, `checkMove` (bounds, overlap, wall/floor, reachability from the elevator with the existing pathfinder); anchors follow their furniture; property test
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.3, 4.1_

- [x] 2. Server: moves and storage
  - Protocol `furni_move`, `furni_reset`, error code `layout_error`; `data/layouts.json` store; gateway applies the layout when a floor is built and sends the new room to the user; project floors only; tests
  - _Requirements: 3.1, 3.2, 3.4, 4.2_

- [x] 3. Client: arrange mode
  - "Arrange" button, select, drag, arrow keys, R to rotate, green/red tiles with the reason, Undo, Reset layout with confirmation, Esc/Done; panels do not open while arranging; Playwright test
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.3_
