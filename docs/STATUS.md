# Status

Updated: 2026-11-15 (bug-sack task 1 done on branch feat/bug-sack, not merged; rows 1-16 are in main)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13, the conversation lines up to 2026-11-14 and the long spec rows of 2026-11-14.

## Phase
TASKMAP rows 1-16 are merged into main (everything up to regression-suite). First real project done: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job, PASS, delivered as branch `agentlife/task-25942b7f`. Row 17 bug-sack: task 1 (store, Code grabber, `pnpm run bugs`) is on `feat/bug-sack`; task 2 (Game grabber, Report a bug, the panel) is S41. Then final-demo with the user.

## Run the hotel
Real engine (PowerShell, from the repo root; Docker running for tests):
- Engine: `cd packages\agent-engine`, set `$env:KIRO_API_KEY` from `.env`, `$env:LLM_BASE_URL='http://127.0.0.1:11434/v1'`, `$env:LLM_MODEL='qwen3.5:4b'`, then `node --experimental-strip-types --no-warnings src/main.ts` (port 8788).
- World-server: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start` (port 8787). Start it after the engine.
- Client: `pnpm --filter @agentlife/client dev`, open http://localhost:5173/.
- Fake engine instead: `$env:RUNTIME='fake'` for the engine (`FAKE_DELAY_MS`, default 800).
- The world-server serves one browser tab at a time. Do not run the conductor while the services are used: it switches branches in the same folder.

## Last conversation with the user
Newest last. Kiro IDE and Kiro Crew (Discord) both append here; older lines are in docs/STATUS-history.md.
- 2026-11-15 (IDE): user: clicking to move sometimes made the avatar go back. Cause: a new walk started from the last whole tile, while the avatar was drawn halfway into the next one. Fixed in `WorldSim.walkTo` (finish the current step, keep its start time), with a fast-check property. While testing, a visual baseline failed only because the run was after midnight (toast "Night owl", a badge that depends on the hour): toasts are now masked in the screenshots, baselines rewritten. `pnpm check`, e2e 144/144, e2e:demo pass.
- 2026-11-15 (IDE): user asked for a BugSack / BugGrabber like in games, with a Game part (visual) and a Code part, where errors are kept and can be read any time. Spec bug-sack (grabbers in client, world-server, engine, conductor; F8 Report a bug with a screenshot; lobby bug jar and Bug sack panel with Game and Code tabs, Fixed/Ignored, Copy for Kiro; data/bugs.jsonl through the leak scanner), TASKMAP row 17, sessions S40-S41. Before the user's test round. Hotel stopped; conductor started (log data/sessions/conduct-run14.txt).

## Next
1. bug-sack task 2 (S41): the client part. Task 1 left ready: the messages `bug_report`, `bugs_state`, `bug_get`, `bug_status` and their answers, `BugStore.onChange` for a push to the client (not wired in the gateway yet), and no way yet to move a screenshot into the store (the 16 KB message limit; design.md "Files"). Playwright test servers need `AGENTLIFE_BUGS_FILE` in their env, or `bug_report` is answered with `bug_error`.
2. With the user: the short "Needs a human" list in docs/HUMAN-CHECKS.md, using the hotel with DiscordIA; Kiro fixes what comes up (the regression suite runs on every merge).
3. final-demo: re-record the replay with several floors and the game layer, README, video script, Devpost. Freeze 2026-12-01, submit by 2026-12-03.
4. After the submission: docs/roadmap-after-kiroween.md (Tickets room, Jira first).
5. Flaky: journeys.spec.ts "one run through the hotel" at 360x640 failed once and passed on the retry (conductor run 13).

## Specs
| Spec | Tasks | State | Notes |
|---|---|---|---|
| world-room, agent-engine, agent-pipeline, build-crew | all | main | MVP pipeline, 3 live runs on haunted-todo |
| room-hints, room-ux, room-fixes, ui-shell, job-insight | all | main | Room UI; most not looked at by the user in a browser |
| demo-replay | 7 / 7 | main | Public demo https://adan291.github.io/agentlife-/ (recorded before floors) |
| project-registry | 6 / 6 | main | Live check done with DiscordIA 2026-11-13 |
| hotel-floors | 5 / 5 | main | Elevator checked by the user; lobby start and plaque fixed 2026-11-13 |
| build-board | 2 / 2 | main | Not looked at in a browser |
| job-types | 4 / 4 | main | Review desk checked live; tests and docs kinds not run live |
| night-shift | 4 / 4 | main | No live night yet |
| hr-desk | 5 / 5 | main | D10 waits for the user's yes; Ollama intern not run live |
| project-memory | 3 / 3 | main | Librarian not run live |
| list-mode | 3 / 3 | main | Used once by the user (Deliver button) |
| pipeline-editor | 3 / 3 | main | Researcher and second review not run live |
| furni-move | 3 / 3 | main | Arrange in the stage corner, D14; superseded in the UI by ui-tidy's Edit room |
| furni-shop | 3 / 3 | main | Row 11. Wallet, grants, 25-item catalogue, shop, inventory tray (design.md) |
| team-progress | 2 / 2 | main | Row 12. XP, levels, stats, 18 badges, daily quests, Profile panel. Needs `AGENTLIFE_PROGRESS_FILE` or the real engine. Playwright: second test server (8796/5198) |
| waiting-fun | 2 / 2 | main | Row 13. Wisps, sit and emotes, glad or glum ghosts, mood face, coffee machine. Playwright: third test server (8797/5197) |
| ui-tidy | 3 / 3 | main | Row 14. Top bar, Menu, Edit room in every room, Actions menu, Builder back to idle after 10 min (design.md) |
| ghost-skins | 2 / 2 | main | Row 15. 23 parts drawn in code, wardrobe, worn from the HR desk and the Profile (design.md). Playwright: fourth test server (8798/5196). Not looked at by the user |
| regression-suite | 3 / 3 | main | Row 16. Journeys, rules and visual comparisons in Playwright, run by the conductor before a merge and by CI. Run it and update baselines: README "Tests" section |
| bug-sack | 1 / 2 | feat/bug-sack | Row 17. Task 1: shared `bugs.ts` (schemas, fingerprint, `BugBook`) and `bugs-node.ts` (masking through `maskLeaks`, file format, inbox), world-server `BugStore` (`data/bugs.jsonl`, `AGENTLIFE_BUGS_FILE`, only with `ENGINE=http` or that variable), grabbers in the world-server, engine (`onBug` in the job runner and the 500s), conductor and session, `pnpm run bugs` (D17 in risks-and-decisions). Not run live |

## Open problems
- bug-sack: `pnpm bugs` as the requirement names it is a built-in pnpm command, so the script runs as `pnpm run bugs` (design.md "Terminal"). The user may want another name (for example `bugsack`). The scratch folder `data/tmp-smoke` (a smoke test of the world-server) could not be deleted by the session (git-ignored).
- ui-tidy: a piece that is not selected and stands behind a taller one is picked by pressing on its drawing above the tile (design.md of ui-tidy). `pnpm check` failed once under load in two world-server timing tests (`fun-gateway`, `wisp-gateway`) and passed alone and on the second run.
- Playwright's own Chromium is not installed on this machine. Run `$env:E2E_CHANNEL='msedge'` first to use the installed Edge. Not installed by a session (global tool).
- hr-desk D10 (docs/risks-and-decisions.md): import review by the read-only `agentlife-import-review` instead of `agentlife-security`. Explained to the user twice; waiting for a yes.
- Flaky tests seen once each: `pipeline-editor.spec.ts` "board shows the editor above the job card" (e2e timing; passes alone), `pnpm check` under load while the services restart.
- Playwright config seeds scratch wallets, inventories, wardrobes and quest pools in the temp folder when the runner loads it (`agentlife-e2e-*.json`), and deletes the progress file of the second test server. With `reuseExistingServer` an already running test world-server keeps its own in-memory state, so stop the four test servers (ports 8795 to 8798) before a run that buys furniture or outfits or checks XP.
- team-progress: the pass/fail of a job comes from the engine's `verdict:` reason and the failed state (same as Ecto); XP of a replayed step goes to whoever holds the desk now. The recorded demo shows no levels.
- DiscordIA: one of its own tests failed once in four sandbox runs (not identified).
- The demo replay and `run-001.json` predate floors, kinds and the game layer: re-record in final-demo.
- Scratch files outside git that a session could not delete: `data/tmp-pipeline-old.txt`, `data/tmp-demo-dist`, `data/tmp-check.txt`, `data/tmp-shots` (all git-ignored).
- waiting-fun: after 10 catches for the same scripted task id (the fake engine reuses ids) no wisp pays. Mood is not kept across a restart. The poses and the sitter's depth were checked in screenshots of the lobby only.
- ghost-skins: how every part reads at 1x on every role colour and on the user's taller torso is a human check.
- regression-suite: not run on a real CI runner yet (the first push shows whether the Linux `browser` job passes). Visual baselines exist for Windows (Edge) only; CI skips them. Screens that need a running job are not compared. More in docs/STATUS-history.md.

## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-15.
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
