# Implementation Plan

- [x] 1. Engine: build board data and phase events
  - Parsers for TASKMAP, tasks.md, session log and verify reports; `GET /build/board`; crew event kind `phase`; conductor reports its phase
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 4.1_

- [x] 2. World and client: construction board in the lobby
  - Furniture and panel with status chips, progress bars, expandable tasks, waits-for-you on top, verdict links, refresh rules, Builder phase bubbles
  - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 4.2_
