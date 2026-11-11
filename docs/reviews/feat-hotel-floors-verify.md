VERDICT: FAIL

Branch `feat/hotel-floors` (HEAD 7b85d4d), spec `hotel-floors`, tasks 1-5 marked done.

Commands run:
- `pnpm check`: passes (shared 182, world-server 94, client 346, agent-engine 290 + 6 skipped, scripts 14).
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e`: 36 passed, 1 failed. The failure is `e2e/demo.spec.ts`, which the live config also picks up and which needs `VITE_MODE=demo`; it is not a hotel-floors criterion (see note below).
- `E2E_CHANNEL=msedge pnpm e2e:demo`: 1 passed.

## Criteria

| Requirement.criterion | Result | Evidence |
|---|---|---|
| 1.1 Rooms `lobby`, `hr`, `project:<id>`, validated with `RoomDefSchema` | PASS | `shared/test/hotel.test.ts` "the lobby, the HR office and the template validate..."; `Hotel.floors()` order test (line 126); `world-server/test/hotel-rooms.test.ts` loads the real room files; `shared/src/world/hotel.ts:46` `roomForProject` ends in `validateRoom` |
| 1.2a Project room generated from `project-template.json` | PASS | `roomForProject` (`hotel.ts:45`); property test in `hotel.test.ts:80`; `world-server/test/floors.test.ts` "gives a project registered later its floor..." |
| 1.2b Project name on a door sign and on the board | FAIL | The name is only stored in `RoomDef.name`. The client draws it nowhere in the room: no `Text` or recipe uses `room.name` (`grep` of `packages/client/src`: only `main.ts` reads it, for the HUD label and the door transition). The door and the board furniture have no name text (`scene/recipes.ts:192` draws a plain lit sign without text). |
| 1.2c Removed project's room disappears, users inside go to the lobby | PASS (code), no gateway test | `Hotel.removeProject` test `hotel.test.ts:186`; gateway `syncProjects` `gateway.ts:226-233` sends the lobby welcome. No test removes a project through the gateway (`world-server/test/floors.test.ts` has no removal case) |
| 1.3 Lobby has Reception, elevator, HR door, directory board, Kiroween decor | PASS | `rooms/lobby.json` (reception_desk, elevator, door_hr, directory_board, cobweb, jack_o_lantern_lamp, lamps); `hotel.test.ts:45`; `hotel-rooms.test.ts` "the Reception is in the lobby, not on the project floors" |
| 1.4a `WorldSim` per room, avatar and agents in exactly one room | PASS | `hotel.test.ts` "moves the user to another floor..." (old sim loses the avatar), "a second join replaces the first user" |
| 1.4b Messages scoped to the user's current room | PASS | `world-server/test/floors.test.ts` "never sends an event of project beta to a user on alpha..." (asserts no walk/agent_state/activity/approval/job_update/work), "the Builder lives in the lobby..." |
| 2.1 Floor panel lists lobby, HR and projects with live status (idle, working who, waiting approval, report ready, failed) | PASS | `client/test/floors.test.ts` "says every status in words", "lists every floor with its status..."; `world-server/test/floors.test.ts` "follows the job...", "marks a report with a failed verdict as failed"; e2e `shell.spec.ts:153` (panel shows 3 floors) |
| 2.2a Transition: doors close, floor indicator, doors open | PASS (logic), look UNVERIFIABLE | `client/test/floors.test.ts` "door transition" (close 350 ms, hold, open; reduced motion); e2e asserts `.al-doors` ends in `data-phase="open"`. Visual quality not checked |
| 2.2b User placed at the target room's elevator | PASS | `world-server/test/floors.test.ts:87` (avatar at `room.door` in both directions); `hotel.test.ts:126` |
| 2.3a Floor waiting for approval or with unread report highlighted in the panel | PASS (logic) | `renderFloorList` sets `data-attention="true"`, tested in `client/test/floors.test.ts:91`; CSS `panels.ts:63`; colour shown in a browser UNVERIFIABLE |
| 2.3b Lobby directory board shows the same status | PASS | `renderFloorList` is shared by elevator and directory (read-only variant tested at `client/test/floors.test.ts:101`); `directory` panel is in `panels.ts` |
| 2.4 Agents do not use the elevator; teams stay on their floor | PASS | Agents only exist in their room (`roomAgents`; test `hotel.test.ts:114` ignores agents of other rooms); no code path moves an agent between sims |
| 3.1a Each floor shows its project's team and own job state; projects run independently | PASS | `agent-engine/test/queue.test.ts` "runs jobs of different projects at the same time"; `world-server/test/floors.test.ts` "a user who goes to beta sees what happened there"; `hotel.test.ts:114` |
| 3.1b At most two jobs at once, others wait in a visible queue | PASS | `queue.test.ts` "queues the third job and starts the waiting jobs in order...", "a job cancelled in the queue...", "uses a limit of 2..."; visible: `world-server/test/floors.test.ts` "shows a job that waits for a slot as queued with its place" and `statusText` "Queued (place 2)" |
| 3.2a Agent ids scoped `<projectId>:<role>` | PASS | `queue.test.ts` "names every agent of a job <project>:<role>...", "the events of a stored job come back scoped after a reload" |
| 3.2b Events, team bar, terminal, stepper show only the current floor | PASS | gateway scoping tests above; `client/test/floors.test.ts` "forgets the job, approvals and reports of the old floor on a new welcome" (stepper/job), "lists only the agents that live on the floor" (team bar), "shows the current floor's lines by default" (terminal); e2e `shell.spec.ts:153` team rows 1 in lobby, 3 on the floor |
| 3.2c Terminal offers "This floor / All floors" | PASS (logic), control UNVERIFIABLE | Model: `client/test/floors.test.ts:167-222`; server side: `world-server/test/floors.test.ts` "sends other floors' activity only after the terminal asks for all floors". The toggle control is wired in `main.ts:179` but no test clicks it |
| 3.3 Builder ghost lives in the lobby | PASS | `hotel.test.ts:126` (lobby agents = builder), `world-server/test/floors.test.ts` "the Builder lives in the lobby..." |
| 4.1 HUD shows current floor name and an "Elevator" shortcut | PASS | e2e `shell.spec.ts:153` (`.al-floor-label` = "Lobby", then "haunted-todo"; "Take the elevator" button opens the panel); `elevatorLabel` test |
| 4.2 Reload returns to the remembered floor if it exists | PASS | e2e `shell.spec.ts:171` "a reload returns to the floor the user was on"; `client/test/floors.test.ts` "remembered floor" (3 tests) |
| 4.3 Demo works with recorded rooms; the export includes the room id; replay shows recorded floors | PASS | `agent-engine/test/observability.test.ts:81` (export has `roomId`); `public/demo/run-001.json` has `roomId` (edited by hand, see STATUS); `client/test/replay-transport.test.ts` "ReplayTransport floors" (8 tests); `pnpm e2e:demo` passes |
| 5.1 Room generation: random names, valid room, sanitised sign, walkable use tiles | PASS | `hotel.test.ts:80` fast-check, 200 runs: valid room, name 1-32 chars, no control chars or paths, `findPath` from the door to every use tile |
| 5.2a An event for project A never reaches a client on B's floor | PASS | `world-server/test/floors.test.ts:156` |
| 5.2b Two-job limit and queue order | PASS | `queue.test.ts:101` |
| 5.3 Elevator flow lobby -> project floor -> lobby in a world-server test | PASS | `world-server/test/floors.test.ts:87` |

## To fix

1. **1.2b, project name on a door sign and on the board.** Draw the room name in the scene: a sign over the room's door/elevator and on the board furniture (client `scene/`, using `welcome.room.name`; the text is already sanitised by `signText`). Alternatively change the requirement to say the name is shown in the HUD and the door transition, and record that in `design.md`. Add a client test or an e2e assertion either way.

Optional, not a criterion failure:
- Add a gateway test for 1.2c (remove a project while the user is on its floor; expect a lobby `welcome` and a `floors` push). Today only `Hotel.removeProject` is tested.
- `pnpm --filter @agentlife/client e2e` also runs `e2e/demo.spec.ts` and fails, because that spec belongs to `playwright.demo.config.ts` (it expects `VITE_MODE=demo`). Add `testIgnore: "demo.spec.ts"` to `playwright.config.ts`. This predates the branch.

## Human checks

- Look at the lobby and a project floor in a real browser: the door transition (doors closing, floor tag, opening), the new elevator, directory board and HR door drawings, and whether a highlighted floor is easy to see in the elevator panel and on the directory board.
- Click "All floors" in the terminal on a live run with two projects and confirm the other floor's lines appear tagged.
- Run two projects at once with the real engine and start a third job to see the queue ("Queued (place n)") in a live run (STATUS says this was not run live).
- Open the demo build (`?mode=demo`) and use the elevator to the lobby and back.
