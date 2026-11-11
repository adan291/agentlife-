VERDICT: PASS

Branch `feat/hotel-floors` (HEAD 7f304f3), spec `hotel-floors`, tasks 1-5 marked done. Second verification, after the review fixes (the first one failed on 1.2b).

Commands run:
- `pnpm check`: passes (shared 183, world-server 95, client 349, agent-engine 290 + 6 skipped, scripts 14).
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e`: 36 passed, 0 failed (`demo.spec.ts` is no longer picked up by the live config).
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e:demo`: 1 passed.

## Criteria

| Requirement.criterion | Result | Evidence |
|---|---|---|
| 1.1 Rooms `lobby`, `hr`, `project:<id>`, validated with `RoomDefSchema` | PASS | `shared/test/hotel.test.ts` "the lobby, the HR office and the template validate..."; `Hotel.floors()` order test; `world-server/test/hotel-rooms.test.ts` loads the real room files; `shared/src/world/hotel.ts` `roomForProject` ends in `validateRoom` |
| 1.2a Project room generated from `project-template.json` | PASS | `roomForProject`; fast-check test in `hotel.test.ts`; `world-server/test/floors.test.ts` "gives a project registered later its floor when the next connection arrives" |
| 1.2b Project name on a door sign and on the board | PASS (logic), look UNVERIFIABLE | `client/src/scene/door-signs.ts` `signsFor` selects furniture with interaction `elevator` or `board` in `project:` rooms; `buildSigns` draws a Pixi `Text` over each; wired in `scene/world-view.ts:250` on every welcome. `client/test/door-signs.test.ts`: name over `board_1` and `elevator_1`, long name cut to 16 chars, no signs in lobby/HR. The Pixi text itself is not asserted by any test, only the sign list |
| 1.2c Removed project's room disappears, users inside go to the lobby | PASS | `hotel.test.ts` (`Hotel.removeProject`); `world-server/test/floors.test.ts:141` "takes a user standing on a floor whose project was removed to the lobby, and drops the floor from the list" (second welcome is `lobby`, floor list without the project) |
| 1.3 Lobby has Reception, elevator, HR door, directory board, Kiroween decor | PASS | `rooms/lobby.json`; `hotel.test.ts` lobby test; `hotel-rooms.test.ts` "the Reception is in the lobby, not on the project floors" |
| 1.4a `WorldSim` per room, avatar and agents in exactly one room | PASS | `hotel.test.ts` "moves the user to another floor..." and "a second join replaces the first user" |
| 1.4b Messages scoped to the user's current room | PASS | `world-server/test/floors.test.ts` "never sends an event of project beta to a user on alpha..."; "the Builder lives in the lobby..."; `hotel.test.ts` leave/return test for deferred messages |
| 2.1 Floor panel lists lobby, HR and projects with live status | PASS | `client/test/floors.test.ts` "says every status in words", "lists every floor with its status..."; `world-server/test/floors.test.ts` "follows the job...", "marks a report with a failed verdict as failed"; e2e `shell.spec.ts:153` |
| 2.2a Transition: doors close, floor indicator, doors open | PASS (logic), look UNVERIFIABLE | `client/test/floors.test.ts` "door transition" (350/250/400 ms, reduced motion, give-up); e2e asserts `.al-doors` ends in `data-phase="open"` |
| 2.2b User placed at the target room's elevator | PASS | `world-server/test/floors.test.ts` elevator flow (avatar at `room.door` in both directions) |
| 2.3a Floor waiting for approval or with unread report highlighted in the panel | PASS (logic), colour UNVERIFIABLE | `renderFloorList` sets `data-attention="true"`, tested in `client/test/floors.test.ts` |
| 2.3b Lobby directory board shows the same status | PASS | `renderFloorList` shared by elevator and directory; read-only variant tested in `client/test/floors.test.ts`; `directory` panel in `panels.ts` |
| 2.4 Agents do not use the elevator; teams stay on their floor | PASS | Agents only exist in their room (`roomAgents`); `hotel.test.ts` ignores agents of other rooms; no code path moves an agent between sims |
| 3.1a Each floor shows its project's team and own job state; projects run independently | PASS | `agent-engine/test/queue.test.ts` "runs jobs of different projects at the same time"; `world-server/test/floors.test.ts` "a user who goes to beta sees what happened there" |
| 3.1b At most two jobs at once, others wait in a visible queue | PASS | `queue.test.ts` "queues the third job and starts the waiting jobs in order...", "a job cancelled in the queue...", "uses a limit of 2..."; `world-server/test/floors.test.ts` "shows a job that waits for a slot as queued with its place" |
| 3.2a Agent ids scoped `<projectId>:<role>` | PASS | `queue.test.ts` "names every agent of a job <project>:<role>...", "the events of a stored job come back scoped after a reload" |
| 3.2b Events, team bar, terminal, stepper show only the current floor | PASS | gateway scoping tests; `client/test/floors.test.ts` "forgets the job, approvals and reports of the old floor on a new welcome", "lists only the agents that live on the floor", "shows the current floor's lines by default"; e2e `shell.spec.ts:153` |
| 3.2c Terminal offers "This floor / All floors" | PASS (logic), control UNVERIFIABLE | Model tests in `client/test/floors.test.ts`; `world-server/test/floors.test.ts` "sends other floors' activity only after the terminal asks for all floors". No test clicks the toggle |
| 3.3 Builder ghost lives in the lobby | PASS | `hotel.test.ts` (lobby agents = builder); `world-server/test/floors.test.ts` "the Builder lives in the lobby..." |
| 4.1 HUD shows current floor name and an "Elevator" shortcut | PASS | e2e `shell.spec.ts:153` (`.al-floor-label` "Lobby" then "haunted-todo"; elevator button opens the panel) |
| 4.2 Reload returns to the remembered floor if it exists | PASS | e2e `shell.spec.ts:171`; `client/test/floors.test.ts` "remembered floor" |
| 4.3 Demo works with recorded rooms; export includes room id; replay shows recorded floors | PASS | `agent-engine/test/observability.test.ts` (export has `roomId`); `public/demo/run-001.json` has `roomId`; `client/test/replay-transport.test.ts` "ReplayTransport floors"; `e2e:demo` passes |
| 5.1 Room generation: random names, valid room, sanitised sign, walkable use tiles | PASS | `hotel.test.ts` fast-check: valid room, name 1-32 chars, no control chars, `findPath` from the door to every use tile |
| 5.2a An event for project A never reaches a client on B's floor | PASS | `world-server/test/floors.test.ts` "never sends an event of project beta to a user on alpha..." |
| 5.2b Two-job limit and queue order | PASS | `agent-engine/test/queue.test.ts` |
| 5.3 Elevator flow lobby -> project floor -> lobby in a world-server test | PASS | `world-server/test/floors.test.ts` elevator flow test |

## To fix

None.

## Human checks

- Look at the lobby and a project floor in a real browser: the project name over the elevator and the board (readable, not overlapping the furniture art), the door transition, the elevator, directory board and HR door drawings, and whether a highlighted floor is easy to see in the elevator panel and on the directory board.
- Click "All floors" in the terminal on a live run with two projects and confirm the other floor's lines appear tagged.
- Run two projects at once with the real engine and start a third job to see "Queued (place n)" (not run live, per STATUS).
- Open the demo build (`?mode=demo`) and use the elevator to the lobby and back.
