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
