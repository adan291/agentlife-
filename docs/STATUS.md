# Status

Updated: 2026-11-15 (bug-sack tasks 1-2 done on branch feat/bug-sack, not merged; rows 1-16 are in main)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13, the conversation lines up to 2026-11-14 and the long spec rows of 2026-11-14.

## Phase
TASKMAP rows 1-16 are merged into main (everything up to regression-suite). First real project done: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job, PASS, delivered as branch `agentlife/task-25942b7f`. Row 17 bug-sack: both tasks are on `feat/bug-sack`, waiting for review and merge (task 2: Game grabber, Report a bug, the panel and the bug jar). Then final-demo with the user.

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
- 2026-11-15 (IDE): task 2 of bug-sack done (S41 work): client grabber, Report a bug, panel, jar drawn in code, screenshot upload in pieces (D18). `pnpm check`, e2e 164/164 with Edge and `--retries=1`, e2e:demo and check:demo-build pass; 29 baselines written or rewritten (lobby, menus, bug screens). Security scan not clean (see Open problems). Pending: merge and the user's look.
- 2026-11-15 (IDE): user said "revisa si queda algo y preparemos para la entrega". README rewritten with the full feature list. STATUS Next updated. TASKMAP bug-sack marked needs-check. `pnpm check` and security scan pass; pushed. Hotel running for the user's test round.
- 2026-11-16 (IDE): implemented all actionable items from the kiroween-review document: (1) D10 ratified; (2) journeys balance poll fix; (3) roadmap and kiro-usage updated.
- 2026-11-16 (IDE): documentation updated for submission and long-term vision. roadmap-after-kiroween.md rewritten: multi-runtime as priority 1 (Ollama + OpenAI-compat runtimes, design and security decisions), ticket-room, distribution, quality. kiro-usage.md extended: regression suite, what Kiro did vs the developer, 10 sections. STATUS Open problems cleaned. Kiro credits exhausted; motor running with RUNTIME=fake for the demo recording. Credits renew ~Dec 1.

 (1) D10 ratified — import review uses agentlife-import-review (read-only tier), recorded in risks-and-decisions.md, cleaned from STATUS and HUMAN-CHECKS; (2) journeys.spec.ts flaky at 360x640 fixed (synchronous balance() call changed to expect.poll, so a racing wallet update can no longer fail the assertion); (3) .env.example, ASSETS.md and video-script.md already done in the previous session. README, TASKMAP and STATUS already up to date. `pnpm check` and security scan pass. Next: re-record the replay and the video for final-demo.

## Next
1. User test round with the hotel + DiscordIA: use it, tell Kiro what breaks, bugs go to the Bug sack.
2. final-demo: re-record the replay with several floors and the game layer, video script, Devpost. Freeze 2026-12-01, submit by 2026-12-03.
3. After submission: docs/roadmap-after-kiroween.md (Tickets room, Jira first).
4. Flaky to watch: journeys.spec.ts at 360x640 (conductor run 13); mailbox-report visual at 800x600 (badge toast, baselines rewritten 2026-11-15).

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
| hr-desk | 5 / 5 | main | D10 ratified 2026-11-16; Ollama intern not run live |
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
| bug-sack | 2 / 2 | feat/bug-sack | Row 17. Task 1: shared `bugs.ts` (schemas, fingerprint, `BugBook`) and `bugs-node.ts` (masking, file format, inbox), world-server `BugStore` (`data/bugs.jsonl`, `AGENTLIFE_BUGS_FILE`, only with `ENGINE=http` or that variable), Code grabbers, `pnpm run bugs` (D17). Task 2: Game grabber, Report a bug (F8, screenshot sent in pieces, D18), Bug sack panel, bug jar in the lobby, `bug_news` push, Menu items and dot, off in the demo (design.md "Task 2"). Every Playwright test server has a scratch `AGENTLIFE_BUGS_FILE`. Not run live, not looked at by the user |

## Open problems
- ui-tidy: a piece behind a taller one is picked by pressing its drawing above the tile (design.md); not fixed.
- Flaky: `pipeline-editor.spec.ts` "board shows the editor" (e2e timing, passes alone); `pnpm check` under load on two world-server timing tests.
- The demo replay (`run-001.json`) predates floors and the game layer. Kiro credits exhausted for the month (renewal ~Dec 1); re-record with `RUNTIME=fake` or wait.
- ghost-skins: check every part at 1x on every role colour is a human check (not yet done).
- regression-suite: visual baselines exist for Windows/Edge only; CI skips them. First Linux run will confirm the browser job passes.
- waiting-fun: mood not kept across a restart; after 10 catches for the same scripted task id no wisp pays (fake engine reuses ids).


## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-15 on main; on `feat/bug-sack` it is not (see Open problems).
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
