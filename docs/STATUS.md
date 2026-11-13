# Status

Updated: 2026-11-13 (ui-tidy tasks 1-3 done on branch feat/ui-tidy, not merged; waiting-fun and the rest of the game layer are merged into main; main 57 commits ahead of origin)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13.

## Phase
All TASKMAP rows 1-12 are merged into main (project-registry, hotel-floors, build-board, job-types, night-shift, hr-desk, project-memory, list-mode, pipeline-editor, furni-move, furni-shop, team-progress). First real project done: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job, PASS, delivered as branch `agentlife/task-25942b7f`. Row 13 waiting-fun is built on `feat/waiting-fun` and waits for review and merge. Next row: 14 final-demo with the user.

## Run the hotel
Real engine (PowerShell, from the repo root; Docker running for tests):
- Engine: `cd packages\agent-engine`, set `$env:KIRO_API_KEY` from `.env`, `$env:LLM_BASE_URL='http://127.0.0.1:11434/v1'`, `$env:LLM_MODEL='qwen3.5:4b'`, then `node --experimental-strip-types --no-warnings src/main.ts` (port 8788).
- World-server: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start` (port 8787). Start it after the engine.
- Client: `pnpm --filter @agentlife/client dev`, open http://localhost:5173/.
- Fake engine instead: `$env:RUNTIME='fake'` for the engine (`FAKE_DELAY_MS`, default 800).
- The world-server serves one browser tab at a time. Do not run the conductor while the services are used: it switches branches in the same folder.

## Last conversation with the user
Newest last. Kiro IDE and Kiro Crew (Discord) both append here; older lines are in docs/STATUS-history.md.
- 2026-11-13 (IDE): DiscordIA live check done (job, approve, delivery as a branch; the user's `main` untouched). Fixes merged into main from it: new visits start in the lobby, one plaque over the elevator, writable `node_modules` in the test sandbox (vitest cache), review desk offers only branches with a base (`nothing_to_compare`), mailboxes come back after a restart (`/health restoreSeq`), report rows show "Open â€º" and "Branch ready".
- 2026-11-13 (IDE): user asked to move furniture like in classic hotel sims: spec furni-move, done by the conductor (S27, S28), PASS and merged. User then described the goal: housing plus a light RPG / sims game layer, fun while waiting for the agents. Specs written: furni-shop (Ecto earned only from verified work, shop, inventory), team-progress (XP and levels from real stats, badges, daily quests), waiting-fun (wisp catching, sit and emotes, visual ghost mood); TASKMAP rows 11-13, sessions S29-S32. The user liked the plan.
- 2026-11-13 (IDE): the steering warned that workflow.md's reference to this file was cut (75 000 characters, budget 50 000). This file was split: the full old text is in docs/STATUS-history.md; workflow.md now asks sessions to keep it short. Conductor relaunched on rows 11-13.
- 2026-11-13 (IDE): asked for team-progress tasks 1 and 2 with design.md first, reusing the furni-shop grant code. Done on `feat/team-progress` (design commit, one commit per task). Decisions for the user to check: level n needs 25Â·nÂ·(n+1) XP, so a new member is level 0 until 50 XP; XP amounts in `config/progress.json`, quest pool in `config/quests.json`, badges in `config/badges.json`; XP goes to the members who finished a step of the job, not to everybody on the team. Pending: look at it in a browser (HUMAN-CHECKS), merge.
- 2026-11-13 (IDE): asked for waiting-fun tasks 1 and 2 with design.md first. Done on `feat/waiting-fun` (design commit, one commit per task). Decisions for the user to check: wisps only exist when the hotel has an economy (so not with the plain scripted engine), 1 Ecto each, 10 per job and 50 per day counted from the wallet; the coffee machine (shop, Tables, 40 Ecto) is the one sold piece with an interaction (`SHOP_INTERACTIONS`, changes a furni-shop rule), it serves the most tired desk agent; mood thresholds 20 min busy and 60 min tired of work today, kept in memory only; keys 1 to 4 and a bar at the bottom right of the stage. Pending: look at it in a browser, merge.

- 2026-11-13 (IDE): user: "fix what needs fixing and continue". Merged into main in a separate worktree while the conductor ran (f217cf4): mailbox keeps the newest 10 reports of a floor across jobs; hr-desk review suggestions (escaped project id in the stale-file regex, all agent files of a team change checked before any is moved, concerns on the import approve button); conductor keeps both sides of a STATUS.md merge conflict (union) from its next start. An S29 started outside the conductor at 15:16 was kept as a wip commit and finished by the conductor.
- 2026-11-13 19:30 (IDE): conductor finished the game layer: furni-shop, team-progress and waiting-fun PASS and merged (rows 10-13 needs-check, 50 human checks open). The old conductor's merge dropped the line above; restored. main 57 commits ahead of origin. Next: user tries the hotel (arrange, shop, XP, wisps), push, final-demo. The engine did not start: the hr-desk fix used a TypeScript parameter property, which --experimental-strip-types refuses (vitest accepted it). Fixed, and a new test loads engine.ts and gateway.ts with the real flag.
- 2026-11-13 21:15 (IDE): user tried the hotel in the lobby and could not find how to move furniture (Arrange exists only on project floors, as a stage-corner button). Asked for an Edit room button and an actions dropdown to clean the UI. New spec ui-tidy (top bar groups, Menu dropdown, Edit room with E key and editing banner, Actions menu replacing the emote bar cut by the dock, stale Builder 'thinking' back to idle), TASKMAP row 14, sessions S33-S34. Waiting for the user to say when the conductor may run (it needs the hotel services stopped).
- 2026-11-13 21:30 (IDE): user tried arranging: a moved piece could not be selected again (bug), many places refused, wants to turn almost everything in place (mailbox on its own tile), every room editable (lobby, HR), and the emote bar as a closed menu. Added to ui-tidy as requirement 6 and task 2 (3 tasks now, S33 tasks 1-2, S34 task 3). Hotel stopped; conductor started on ui-tidy (log data/sessions/conduct-run10.txt).
- 2026-11-13 23:05 (IDE): ui-tidy PASS and merged (S33, S34); the conductor kept both sides of STATUS.md this time. Only final-demo is left in the TASKMAP. Hotel restarted for the user to try Edit room, Menu, Actions and arranging in every room.

## Next
1. Conductor: review and merge ui-tidy (all 3 tasks done), then final-demo. Never cut final-demo.
2. With the user: browser checks in docs/HUMAN-CHECKS.md, including the new top bar, Menu, Edit room in every room and the ui-tidy list at its end.
3. final-demo: re-record the replay with several floors and the game layer, video, Devpost. Freeze 2026-12-01.
4. Push main when the user agrees (last push fbe1ceb).

## Specs
| Spec | Tasks | State | Notes |
|---|---|---|---|
| world-room, agent-engine, agent-pipeline, build-crew | all | main | MVP pipeline, 3 live runs on haunted-todo |
| room-hints, room-ux, room-fixes, ui-shell, job-insight | all | main | Room UI; most not looked at by the user in a browser |
| demo-replay | 7 / 7 | main | Public demo https://adan291.github.io/agentlife-/ (recorded before floors) |
| project-registry | 6 / 6 | main | Live check done with DiscordIA 2026-11-13 |
| hotel-floors | 5 / 5 | main | Elevator checked by the user; lobby start and plaque fixed 2026-11-13 |
| build-board | 2 / 2 | main | Not looked at in a browser |
| job-types | 4 / 4 | main | Review desk checked live (fix: branch with nothing to compare); tests and docs kinds not run live |
| night-shift | 4 / 4 | main | No live night yet |
| hr-desk | 5 / 5 | main | D10 waits for the user's yes; Ollama intern not run live |
| project-memory | 3 / 3 | main | Librarian not run live |
| list-mode | 3 / 3 | main | Used once by the user (Deliver button) |
| pipeline-editor | 3 / 3 | main | Researcher and second review not run live |
| furni-move | 3 / 3 | main | Arrange button in the stage corner (requirement 2.1 reworded), D14; not looked at by the user |
| furni-shop | 3 / 3 | main | Row 11. Wallet, grants, 25-item catalogue, shop, buy, inventory tray in arrange mode (design.md). Balance chip is in the stage corner. Not looked at by the user |
| team-progress | 2 / 2 | main | Row 12. XP and levels from real events (`progress.json`, same keyed idempotence as grants), stats, 18 badges, 3 seeded daily quests that pay Ecto once, Profile panel (level chip next to the Ecto chip), level-up effect, level lines in team bar, tooltips and HR cards. Needs `AGENTLIFE_PROGRESS_FILE` or the real engine. Playwright: second test server (8796/5198). Not looked at by the user |
| waiting-fun | 2 / 2 | main | Row 13. Wisps (server decides, 1 Ecto, DOM button over the canvas), sit on seats (click, key 4), emotes (keys 1-3), ghosts cheer or look glum on a delivered job, mood face on the desk ghosts' tags, coffee machine in the shop (design.md). Playwright: third test server (8797/5197, `AGENTLIFE_WISP_MS`). Not looked at by the user |
| ui-tidy | 3 / 3 | feat/ui-tidy | Row 14. Task 1: top bar (Elevator, Hotel/List, Edit room, Ecto and level chips, Menu; the group collapses into the Menu under 900 px), Menu with keyboard, keys E and ?, edit banner under the top bar. Task 2: re-select bug fixed (the selected piece wins under the pointer, `pickAllFurni`), wall pieces free in the room and facing the room against a wall, named refusals, lobby and HR office editable, layouts keyed by room id (old file converted), `home_hr` anchor; bought furniture stays on project floors. Task 3: Actions button (bottom left of the stage) replaces the emote bar, same dropdown component as the Menu, keys 1-4 kept; `BuilderWatch` sends the Builder to idle after 10 min without events (design.md). Not looked at by the user. 25 e2e of ui-tidy and waiting-fun pass with Edge |

## Open problems
- ui-tidy: a piece that is not selected and stands behind a taller one is picked by pressing on its drawing above the tile; picking by drawn pixels was not done (design.md of ui-tidy). `pnpm check` failed once under load in two world-server timing tests (`fun-gateway`, `wisp-gateway`) and passed alone and on the second run.
- Playwright's own Chromium is not installed on this machine (`pnpm --filter @agentlife/client e2e` fails to launch it). Run `$env:E2E_CHANNEL='msedge'` first to use the installed Edge. Not installed by a session (global tool).
- hr-desk D10 (docs/risks-and-decisions.md): import review by the read-only `agentlife-import-review` instead of `agentlife-security`. Explained to the user twice; waiting for a yes.
- Flaky tests seen once each: `pipeline-editor.spec.ts` "board shows the editor above the job card" (e2e timing; it failed in the full e2e run on 2026-11-13 twice, the second time with the team-progress spec in the run, and passes alone), `pnpm check` under load while the services restart. The report property test flake was fixed (seed -515305606).
- Playwright config seeds scratch wallets, inventories and quest pools in the temp folder when the runner loads it (`agentlife-e2e-*.json`), and deletes the progress file of the second test server. With `reuseExistingServer` an already running test world-server keeps its own in-memory state, so stop both test servers (ports 8795 and 8796) before a run that buys furniture or checks XP.
- team-progress: the pass/fail of a job comes from the engine's `verdict:` reason and the failed state (same as Ecto); XP of a replayed step goes to whoever holds the desk now, not who held it then (only for events that arrived while the world-server was off). The recorded demo shows no levels (the server sends none).
- DiscordIA: one of its own tests failed once in four sandbox runs (not identified).
- The demo replay and `run-001.json` predate floors, kinds and the game layer: re-record in final-demo.
- Scratch files outside git that a session could not delete: `data/tmp-pipeline-old.txt`, `data/tmp-demo-dist`, `data/tmp-check.txt`, `data/tmp-shots` (screenshots of the poses; all git-ignored).
- waiting-fun: stop the three test servers (ports 8795 to 8797) before an e2e run; a reused fun server keeps its wallet in memory, and after 10 catches for the same scripted task id (the fake engine reuses ids) no wisp pays. Mood is not kept across a restart. The poses and the sitter's depth were checked in screenshots of the lobby only.

## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-13.
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
