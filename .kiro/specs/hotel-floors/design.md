# Design Document: hotel-floors

- `shared/src/world/hotel.ts`: `Hotel` holds `Map<RoomId, WorldSim>`; `moveUser(userId, roomId)` leaves the old sim and joins the new one (returns `welcome` for the new room). `RoomId = "lobby" | "hr" | \`project:${string}\``.
- Rooms: `world-server/rooms/lobby.json`, `hr.json`, `project-template.json`; `roomForProject(project)` fills the template (sign text through `sanitize`, max 32 chars).
- Furniture: `elevator` (interaction `elevator`), `directory_board` (`directory`), `door` (interaction `door` with a `to` room), `reception_desk` moves to the lobby.
- Protocol: client `go_to { roomId }`; server `floors { floors: FloorStatus[] }` pushed on change; `welcome` gains `roomId`. Messages from the engine are routed by `taskId → projectId → room`.
- Engine: job queue with `maxConcurrentJobs` (config, default 2); one active job per project; agent ids `<projectId>:<role>` in events, mapped to the room's agents by the world-server.
- Client: `ui/elevator.ts` (floor panel), transition overlay (CSS doors + floor number, reduced-motion: instant), HUD floor label, terminal scope toggle.
- Replay: `RunExport` gains `roomId`; the replay builds a hotel with the lobby and the recorded floor.
