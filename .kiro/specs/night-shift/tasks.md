# Implementation Plan

- [ ] 1. Engine: night schedule, window, limits and scheduler
  - `data/night.json`, routes to add/reorder/remove, config window and limits, scheduler with injectable clock
  - _Requirements: 1.2, 1.3, 3.1, 3.2, 6.1_

- [ ] 2. Engine: pre-approval and audit-deps
  - Scope-based automatic approval, stop when out of scope, optional delivery, audit-deps job
  - _Requirements: 2.1, 2.2, 2.3, 3.3, 6.2_

- [ ] 3. Morning summary and Discord
  - Summary artifact to the lobby mailbox; notify with Ollama overview when enabled
  - _Requirements: 4.1, 4.2, 6.3_

- [ ] 4. Client: night board and night look
  - Lobby night board (add, reorder, remove, pre-approval scope, deliver toggle), dimmed rooms, candles, moon clock
  - _Requirements: 1.1, 5.1_
