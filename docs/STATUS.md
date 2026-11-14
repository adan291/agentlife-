# Status

Updated: 2026-11-14 (regression-suite tasks 1-3 done on branch feat/regression-suite, not merged; rows 1-15 are in main; main pushed at fcd0fd2)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13, and the 2026-11-13 conversation lines.

## Phase
TASKMAP rows 1-15 are merged into main (everything up to ghost-skins). First real project done: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job, PASS, delivered as branch `agentlife/task-25942b7f`. Row 16 regression-suite: all three tasks (journeys and rules, visual comparisons, wiring and manual list) are on `feat/regression-suite`, waiting for review and merge. Then final-demo with the user.

## Run the hotel
Real engine (PowerShell, from the repo root; Docker running for tests):
- Engine: `cd packages\agent-engine`, set `$env:KIRO_API_KEY` from `.env`, `$env:LLM_BASE_URL='http://127.0.0.1:11434/v1'`, `$env:LLM_MODEL='qwen3.5:4b'`, then `node --experimental-strip-types --no-warnings src/main.ts` (port 8788).
- World-server: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start` (port 8787). Start it after the engine.
- Client: `pnpm --filter @agentlife/client dev`, open http://localhost:5173/.
- Fake engine instead: `$env:RUNTIME='fake'` for the engine (`FAKE_DELAY_MS`, default 800).
- The world-server serves one browser tab at a time. Do not run the conductor while the services are used: it switches branches in the same folder.

## Last conversation with the user
Newest last. Kiro IDE and Kiro Crew (Discord) both append here; older lines are in docs/STATUS-history.md.
- 2026-11-14 (IDE): the PC rebooted at 10:29 and the hotel stopped; Docker and the three services restarted. `pnpm check` failed once in `wisp-gateway.test.ts` (timing) and passed on rerun. User asked about skins for the ghosts (example image: ghost with flat cap, vest, neckerchief, carnation); Kiro proposed outfits drawn in code instead of using the image.
- 2026-11-14 (IDE): user said the presence hook fired on every prompt here. Removed `.kiro/hooks/presence-here.json`; Kiro Crew's steering now runs `pnpm notify --here` when the user says on Discord they are back at the PC, and no longer starts `pnpm session` while a conductor runs. User said yes to ghost skins: spec ghost-skins (hat, top, accessory parts drawn in code, Ecto or badges, worn from the HR desk and the Profile), TASKMAP row 15, sessions S35-S36.
- 2026-11-14 (IDE): user's plan: finish ghost-skins and the rest, push, test together to find what to fix, then the user records the video. main pushed (fbe1ceb..fcd0fd2). Hotel stopped; conductor started on ghost-skins (S35, S36), log data/sessions/conduct-run11.txt. Next: user tests the hotel, Kiro fixes, then final-demo (re-record replay, README, video, Devpost). D10 still waits for a yes.
- 2026-11-14 14:10 (IDE): ghost-skins PASS and merged (S35, S36). Full automated pass on main: `pnpm check` (shared 485, world-server 453, client 759, engine 682), security scan clean, `check:demo-build`, Edge e2e 95/95, e2e:demo 1/1. Hotel restarted (Docker up) for the user's test round; Kiro fixes what the user reports. Then final-demo.
- 2026-11-14 (IDE): user asked for an automated regression suite "like Selenium" to remove human error. Spec regression-suite (Playwright user journeys, layout and interface rules at 3 sizes, visual comparisons with per-platform baselines, run by the conductor before every merge and by CI on Linux and Windows, HUMAN-CHECKS.md pruned to what needs a human), TASKMAP row 16, sessions S37-S39. Hotel stopped; conductor started (log data/sessions/conduct-run12.txt). The user's manual test round moves after it.
- 2026-11-14 (IDE): user proposed a room for Jira tickets (uses Jira at work, asked as an idea). Decided: after the submission, not before the freeze. Written in docs/roadmap-after-kiroween.md (Tickets room with ticket sources local, GitHub Issues, Jira read-only, comment back only with approval; engine-only allowlisted network, token from .env, ticket text untrusted).
- 2026-11-14 20:40 (IDE): regression-suite stopped after 2 fix rounds (verify FAIL 3.1: Construction board and Profile Quests tab not compared). Done in the IDE on feat/regression-suite instead of narrowing the requirement: fixed board data in the scripted engine, progress clock fixable for tests (`AGENTLIFE_PROGRESS_NOW`), 3 new visual tests; looking at the images found 2 product bugs (Actions button in a serif font, level line twice in the Profile), fixed. 109 baselines, stable on repeat; `pnpm check`, scan, e2e 144/144 with --retries=1, e2e:demo pass. Conductor relaunched for review, verification and merge.
- 2026-11-14 23:50 (IDE): regression-suite PASS and merged (browser suite 143 passed, 1 flaky). main pushed (d74bac1). Only final-demo is left in the TASKMAP.
- 2026-11-15 (IDE): user: clicking to move sometimes made the avatar go back. Cause: a new walk started from the last whole tile, while the avatar was drawn halfway into the next one. Fixed in `WorldSim.walkTo` (finish the current step, keep its start time), with a fast-check property. While testing, a visual baseline failed only because the run was after midnight (toast "Night owl", a badge that depends on the hour): toasts are now masked in the screenshots, baselines rewritten. `pnpm check`, e2e 144/144, e2e:demo pass.
- 2026-11-15 (IDE): user asked for a BugSack / BugGrabber like in games, with a Game part (visual) and a Code part, where errors are kept and can be read any time. Spec bug-sack (grabbers in client, world-server, engine, conductor; F8 Report a bug with a screenshot; lobby bug jar and Bug sack panel with Game and Code tabs, Fixed/Ignored, Copy for Kiro; data/bugs.jsonl through the leak scanner; `pnpm bugs`), TASKMAP row 17, sessions S40-S41. Before the user's test round. Hotel stopped; conductor started (log data/sessions/conduct-run14.txt).

## Next
1. With the user: the short "Needs a human" list in docs/HUMAN-CHECKS.md, using the hotel with DiscordIA; Kiro fixes what comes up (the regression suite runs on every merge).
2. final-demo: re-record the replay with several floors and the game layer, README, video script, Devpost. Freeze 2026-12-01, submit by 2026-12-03.
3. After the submission: docs/roadmap-after-kiroween.md (Tickets room, Jira first).
4. Flaky: journeys.spec.ts "one run through the hotel" at 360x640 failed once and passed on the retry (conductor run 13).

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
| ghost-skins | 2 / 2 | main | Row 15. Task 1: 23 parts in `config/outfits.json`, recipes in `scene/outfit-parts.ts`, `data/wardrobe.json` kept by `Economy`, Outfits tab in the shop. Task 2: `data/outfits.json` kept by `WornStore`, `outfit_wear` checked by the shared `applyWear`, one `outfits` message (whole state) after the wardrobe and after each change, `outfit_error`, members dressed in the HR office and the user anywhere, entries pruned in `refreshTeam` when a member is no longer on the team, `OutfitBook` + `WorldView.applyLooks`, user's figure wears parts (`guestAnchors`), shared `look-picker.ts` in the HR card and a Look tab in the Profile, `data-looks` on the canvas for tests. Playwright: fourth test server (8798/5196, `FAKE_HR=1`, a scripted HR link). HR ghost and Builder cannot be dressed (design.md). Not looked at by the user |
| regression-suite | 3 / 3 | feat/regression-suite | Row 16. Task 3: the conductor runs `playwright test --retries=1` and `e2e:demo` on main after `pnpm check` (`runBrowserTests`, `scripts/e2e-report.ts`; a flaky test goes to `data/sessions/log.md`, a failure stops the merge with the report path); CI job `browser` on Linux and Windows with the report as an artifact on failure; README "Tests" section. Run the suite and update baselines: see that README section. Task 1: `e2e/support/` (a scratch world-server per test with `FAKE_DELIVER=1`, the WebSocket redirected to it, rules in `rules.ts`, exceptions in `allowlist.ts`), `journeys.spec.ts` (3 journeys x 3 sizes), `rules.spec.ts` (the rules fail on broken pages). 4 real bugs fixed, listed in design.md. Task 2: `visuals.spec.ts` (4 rooms and 20 panels at 3 sizes, 15 tests; job panels with times and balance masked, a hotel with no wisps), time and motion frozen in `support/visual.ts`, baselines in `e2e/__visuals__/win32/` (109 images, committed, repeat runs with zero differing pixels), a platform without that folder skips; `pnpm --filter @agentlife/client e2e:update-visuals` rewrites them; the HTML report keeps the diffs. Run it with `$env:E2E_CHANNEL='msedge'; pnpm --filter @agentlife/client e2e` (132 tests). Review fixes 2026-11-14: panels of a running job added; after the 2nd verify FAIL the IDE added the Construction board and the Profile's Quests tab (frozen progress clock), and fixed the Actions button font and the repeated level line in the Profile; every panel is compared now |

## Open problems
- ui-tidy: a piece that is not selected and stands behind a taller one is picked by pressing on its drawing above the tile (design.md of ui-tidy). `pnpm check` failed once under load in two world-server timing tests (`fun-gateway`, `wisp-gateway`) and passed alone and on the second run.
- Playwright's own Chromium is not installed on this machine. Run `$env:E2E_CHANNEL='msedge'` first to use the installed Edge. Not installed by a session (global tool).
- hr-desk D10 (docs/risks-and-decisions.md): import review by the read-only `agentlife-import-review` instead of `agentlife-security`. Explained to the user twice; waiting for a yes.
- Flaky tests seen once each: `pipeline-editor.spec.ts` "board shows the editor above the job card" (e2e timing; passes alone), `pnpm check` under load while the services restart.
- Playwright config seeds scratch wallets, inventories, wardrobes and quest pools in the temp folder when the runner loads it (`agentlife-e2e-*.json`), and deletes the progress file of the second test server. With `reuseExistingServer` an already running test world-server keeps its own in-memory state, so stop the three test servers (ports 8795 to 8797) before a run that buys furniture or outfits or checks XP.
- team-progress: the pass/fail of a job comes from the engine's `verdict:` reason and the failed state (same as Ecto); XP of a replayed step goes to whoever holds the desk now. The recorded demo shows no levels.
- DiscordIA: one of its own tests failed once in four sandbox runs (not identified).
- The demo replay and `run-001.json` predate floors, kinds and the game layer: re-record in final-demo.
- Scratch files outside git that a session could not delete: `data/tmp-pipeline-old.txt`, `data/tmp-demo-dist`, `data/tmp-check.txt`, `data/tmp-shots` (all git-ignored).
- waiting-fun: after 10 catches for the same scripted task id (the fake engine reuses ids) no wisp pays. Mood is not kept across a restart. The poses and the sitter's depth were checked in screenshots of the lobby only.
- ghost-skins: the parts were checked by tests and in one screenshot (the Developer's cap on a project floor); how every part reads at 1x on every role colour and on the user's taller torso is a human check. Stop the four test servers (ports 8795 to 8798) before an e2e run that buys outfits.

- regression-suite: the journeys start their own world-server on a free port and reach it by redirecting the page's WebSocket; they still need the main test server (ports 8795/5199) for the Vite page. The toast opened with "Open report" does not tell the floor the report was seen, so the overview keeps "Report ready" (design.md of regression-suite, not changed).

- regression-suite: `wearing.test.ts` "draws every part in the five views..." took 6 to 7 s inside the parallel `pnpm check` (2 s alone) and failed on the 5 s limit three times in a row; it now has a 30 s timeout. The load-sensitive tests named under ui-tidy are the same kind.
- regression-suite: the whole suite passed on this machine with the conductor's settings (`CI=1`, Edge: 129 tests, `e2e:demo` 1/1). Not run on a real CI runner yet: the first push shows whether the Linux `browser` job passes. The conductor's own step was not run end to end (a merge was not made); its command and the JSON report reading were run by hand. Visual baselines exist for Windows (Edge) only; CI skips them. The Profile's Quests tab is not compared (the date picks the quests). Screens that need a running job are not compared.

## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-13.
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
