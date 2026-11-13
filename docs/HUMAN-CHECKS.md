# Human checks waiting for the user

The conductor merged these specs and kept going. Tick each item when checked; tell Kiro about anything that fails.

## project-registry (merged 2026-11-11)
- [ ] Copy a small git project of yours into D:\AgentHotel, register it at the Reception, run one job, approve, press "Deliver as branch" and check the branch `agentlife/<task>` exists in your repo and nothing else changed.

## hotel-floors (merged 2026-11-12)
- [x] Lobby, elevator with door transition, project floor with its name (checked by the user 2026-11-12)
- [ ] With two registered projects, start jobs on both and a third one to see the queue
- [ ] Demo build (`?mode=demo` or the public URL): elevator to the lobby and back

## night-shift (merged 2026-11-12)
- [ ] Look at the feature in the browser

## hr-desk tasks 3-4 (on feat/hr-desk, not merged)
- [ ] Engine and world-server running, go to the HR office (door in the lobby), click the HR desk: hire a QA from the catalogue on a project, fire the first QA, then take the elevator to that project: the old QA leaves by the elevator and the new one walks in with its name
- [ ] "Suggest a team" for a project: the HR ghost looks like it is thinking, the proposal appears, nothing changes until "Apply this team"
- [ ] Hire a second developer, a reviewer, a researcher and the Night intern on one project, then take the elevator to that floor: all four walk in from the elevator and stand at their own spots with their names and role colours; hover one for the tooltip; fire one and watch it walk back to the elevator; check that name tags do not overlap badly
- [ ] Imports: put one https address in `packages/agent-engine/config/catalogue-sources.json`, restart the engine, import, read the persona and the review, approve, hire it; change the file at the source and import again to see "Update waits for you"

## hr-desk (merged 2026-11-12)
- [ ] Look at a project floor with a full team in a browser: six standing ghosts, name tags that may overlap when two stand close, the two spots beside the QA desk, the tooltip of a ghost at a spot. The Edge test covers only the HR office.
- [ ] Watch the walks with a real engine: a hire walking in from the elevator to a spot, a fired member walking out, a desk holder replaced by the next member of the role (that member leaves by the elevator and the desk ghost comes in through it).
- [ ] HR panel in a browser against a real engine: hire, rename, change model, fire; the import queue with an allowlisted source; "suggest a team" and "Apply this team"; the hire, rename and fire lines in the activity terminal on the right floor.
- [ ] Real `kiro-cli`: `AGENTLIFE_LIVE=1` run of the validate test for the generated agent files; the import review and the HR agent with real replies; a real job on a customised team using `--agent` and `--model`.
- [ ] Real download from a source listed in `config/catalogue-sources.json`.
- [ ] Night intern: start Ollama with `qwen3.5:4b` and check an answer; stop Ollama and check that `claude-haiku-5.5` answers and the report's Notes section says so. No pipeline step asks for a researcher yet, so this needs a test harness or pipeline-editor.
- [ ] The user should ratify D10 (import review uses `agentlife-import-review`, not `agentlife-security`).

## pipeline-editor (on feat/pipeline-editor, not merged)
- [ ] Engine and world-server running (`ENGINE=http`), open the board of a project: the Pipeline section is above the job card; drag a card, use the arrows, see the red card with its rule and Save off; put the steps back and press "Back to the default".
- [ ] HR desk: hire a Reviewer (change its model so it differs from QA) and a Researcher; on the board add "+ Second review" and "+ Research", choose who does them, Save, start a job: the research notes appear as an artifact, the report has "Second review" and "Research" sections, and a failing second review fails the job.
- [ ] Fire the Reviewer while the pipeline uses it, then start a job: it is refused with the reason ("Second review needs a reviewer…"), and starts again after "Back to the default".
- [ ] Save a pipeline while a job runs: the running job keeps its old pipeline, the next one uses the new one.
- [ ] Real `kiro-cli`: the researcher and second reviewer with their generated agent files (read-only tier); the Night intern chosen as researcher fails the research step with its own message (known limit).

## furni-move (merged 2026-11-13)
- [ ] Look at arrange mode in a real browser: the green and red tile overlay, the red cross, the selected outline, the standing-spot dots, the tool bar at the bottom left, and that the Arrange button in the top right corner does not cover the room under about 900 px width (STATUS says this was not checked by eye).
- [ ] Look at the new default layout of a project floor (wall pieces, west-wall board and mailbox, agents walking between the new spots, name tags).
- [ ] Requirement 2.4c: start a job on a floor with the real engine, move a desk and other pieces during the job, and confirm the agents keep walking and working; confirm the next walk of a moved desk's agent goes to the new seat.
- [ ] Open the recorded demo and confirm there is no Arrange button (`pnpm --filter @agentlife/client e2e:demo` was not run in this verification).
- [ ] Not run live: a real engine with a real registered project (only the scripted engine was used by the e2e).

## furni-shop task 3: placing (on feat/furni-shop, not merged)
- [ ] In a real browser with the real engine: earn some Ecto (a delivered job), buy two or three pieces at the lobby counter, go to a project floor, press Arrange, and drag items from the tray onto the floor with the mouse. Look at the green and red preview, the tray (picture, count, width next to the room under about 900 px), and that the tray does not cover the Arrange button.
- [ ] Place a wall piece (clock, poster, mirror, banner) on the north and the west wall, turn it with R, and check that it is refused in the middle of the floor.
- [ ] Pick a piece up, restart the world-server, and check that placed pieces and the stock are still there; remove a project in the Reception and check that its pieces are back in the tray of another floor.
- [ ] Touch screen: tap an item in the tray, then tap the floor (dragging from the tray is for a mouse).
