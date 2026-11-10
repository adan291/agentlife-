# Implementation Plan

- [x] 1. Isometric geometry in shared
  - Create `shared/src/geometry/projection.ts` (`tileToScreen`, `screenToTile`), `heightmap.ts` (`parseHeightmap`), `depth.ts` (`depthKey`)
  - Export from `shared/src/index.ts`
  - Unit tests plus fast-check properties: projection round-trip, depth ordering for non-overlapping footprints
  - _Requirements: 2.1, 2.2, 2.4_

- [x] 2. Pathfinding in shared
  - `shared/src/geometry/pathfind.ts`: A* 8-neighbour, no corner cutting, max height step 1
  - fast-check properties: adjacency and walkability of every step, ends at target, null when unreachable
  - _Requirements: 3.2, 3.5_

- [x] 3. Room, furniture and anchor schemas
  - `shared/src/furni.ts` (FurniDefSchema + catalog: computer desk, mailbox, board, agent desk ×1 def, chair, plant, lamp, sofa, jack-o'-lantern lamp, cobweb), `shared/src/room.ts` (RoomDefSchema, `validateRoom`, `useTile`, `resolveAnchor`)
  - Validation rejects anchors/footprints off the floor and unwalkable use tiles
  - Author `packages/world-server/rooms/office.json` (about 12×10 tiles) and a test that it validates
  - _Requirements: 1.1, 1.2, 1.4, 4.1, 4.3, 9.2_

- [x] 4. Protocol and agent event schemas
  - `shared/src/protocol.ts` (ClientMsg, ServerMsg) and `shared/src/events.ts` (AgentEvent) as zod discriminated unions
  - Tests: valid samples parse, malformed samples are rejected
  - _Requirements: 6.1, 5.5_

- [x] 5. WorldSim
  - `shared/src/world/sim.ts`: join/snapshot, `move`, `use` (walk to use tile + deferred open_panel), agent events → walk/agent_state/say, clock-derived positions
  - Property test: after any random sequence of valid intents and agent events, every avatar is on a walkable tile
  - _Requirements: 3.1, 3.3, 4.2, 4.4, 5.2, 5.3, 5.4_

- [x] 6. World-server gateway
  - `world-server/src/main.ts`, `gateway.ts`: load + validate room (fail fast with field path), ws on 127.0.0.1:8787, zod validation, 16 KB max payload, 20 msg/s rate limit, welcome on connect
  - Use `fileURLToPath` for the room path (Windows)
  - Tests with a real ws client on an ephemeral port
  - _Requirements: 1.3, 6.2, 6.3, 6.4_

- [x] 7. EngineLink and fake engine
  - `engine-link.ts` interface, `fake-engine.ts` scripted scenario that waits for approval
  - Wire panel data requests (`repos`, `job_update`, `approval`, `report`) through the gateway
  - Test: scenario reaches `report.ready` only after an approve
  - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Client: transport, palette and room rendering
  - `transport.ts` (LiveTransport with reconnect), `palette.ts`, `scene/room-view.ts` (floor, walls, hover highlight), zoom 1×/2×
  - _Requirements: 2.1, 2.3, 2.5, 9.1_

- [x] 9. Client: procedural textures, furniture and avatars
  - `scene/textures.ts` with `SpriteProvider`, draw recipes for every catalog item, avatar figure with 8 logical directions and walk animation
  - `furni-view.ts`, `avatar-view.ts`, depth sorting each frame for moving avatars
  - _Requirements: 2.2, 3.4, 4.3, 9.2_

- [x] 10. Client: input and agent overlays
  - Click to move, click furniture to use, name tags, role colours, status badges with 8 state icons, speech bubbles with duration by length
  - _Requirements: 3.1, 4.2, 5.1, 5.3, 5.4, 5.5_

- [x] 11. Client: panels
  - `ui/panels.ts` (open/close, Esc), computer, mailbox (approve/reject, reports), board (timeline), `ui/markdown.ts` safe renderer with a test that HTML in input is escaped
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 12. End-to-end check with the fake engine
  - Run world-server (ENGINE=fake) and client; walk to computer, start job, approve in mailbox, read report
  - Record the manual check result in docs/STATUS.md; fix any defects found
  - _Requirements: 7.2, 8.1, 8.2, 8.3_
