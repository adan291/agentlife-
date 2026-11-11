# Implementation Plan

- [x] 1. Shared: Hotel with rooms, room template and new furniture
  - `world/hotel.ts`, room ids, `roomForProject`, lobby/hr/template room files, elevator/directory/door furniture
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1_

- [x] 2. Engine: per-project jobs, agent ids and job queue
  - One active job per project, global limit 2 with a queue, `<projectId>:<role>` agent ids, floor status data
  - _Requirements: 3.1, 3.2, 5.2_

- [x] 3. World-server: routing by room, go_to, floors
  - Messages scoped to the user's room, `go_to`, `floors` pushes, rooms created/removed with projects, Builder in the lobby
  - _Requirements: 1.2, 1.4, 2.4, 3.2, 3.3, 5.2, 5.3_

- [x] 4. Client: elevator, transitions, floor-scoped UI
  - Floor panel with live status, door transition, HUD floor label, remember floor, terminal "This floor / All floors", directory board
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2_

- [ ] 5. Replay with floors
  - `roomId` in exports, replay hotel with lobby + recorded floor, demo smoke test still passes
  - _Requirements: 4.3_
