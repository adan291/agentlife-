# Status

Updated: 2026-11-14 (ghost-skins tasks 1-2 done on branch feat/ghost-skins, not merged; rows 1-14 are in main; main pushed at fcd0fd2)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13, and the 2026-11-13 conversation lines.

## Phase
TASKMAP rows 1-14 are merged into main (everything up to ui-tidy). First real project done: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job, PASS, delivered as branch `agentlife/task-25942b7f`. Row 15 ghost-skins: both tasks are on `feat/ghost-skins` (parts and shop, then wearing), waiting for review and merge. Then final-demo with the user.

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
- 2026-11-14 (conductor S35): ghost-skins task 1 done (design.md first). Decisions for the user to check: three slots only, so the picture's neckerchief and carnation are both accessories and a ghost wears one of them (a fourth `neck` slot is a small change); 23 parts, 4 of them unlocked by badges (crown: Hotel veteran, halo: Ten passes, lab coat: Review regular, delivery ribbon: Ten deliveries); prices 15 to 60 Ecto in `packages/world-server/config/outfits.json`; the sprite frame of avatars grew (`AVATAR_FRAME` 40x76) so hats fit above a cheering ghost.
- 2026-11-14 (conductor S36): ghost-skins task 2 done (design.md first). Decisions for the user to check: one `outfits` message with the whole state instead of the outline's welcome field plus live message; members are dressed only in the HR office, the user anywhere; a member's outfit is dropped when the team no longer lists them (fire, replace, or fired outside the hotel at the next visit); HR ghost and Builder are not dressable; a top on the user's figure covers its upper 15 px; lapel and pocket recipes now stay inside narrow bodies.
- 2026-11-14 14:10 (IDE): ghost-skins PASS and merged (S35, S36). Full automated pass on main: `pnpm check` (shared 485, world-server 453, client 759, engine 682), security scan clean, `check:demo-build`, Edge e2e 95/95, e2e:demo 1/1. Hotel restarted (Docker up) for the user's test round; Kiro fixes what the user reports. Then final-demo.
- 2026-11-14 (IDE): user asked for an automated regression suite "like Selenium" to remove human error. Spec regression-suite (Playwright user journeys, layout and interface rules at 3 sizes, visual comparisons with per-platform baselines, run by the conductor before every merge and by CI on Linux and Windows, HUMAN-CHECKS.md pruned to what needs a human), TASKMAP row 16, sessions S37-S39. Hotel stopped; conductor started (log data/sessions/conduct-run12.txt). The user's manual test round moves after it.

## Next
1. Review and merge ghost-skins (both tasks done), then final-demo. Never cut final-demo.
2. With the user: browser checks in docs/HUMAN-CHECKS.md (top bar, Menu, Edit room, the game layer, the Outfits page, the Look pickers).
3. final-demo: re-record the replay with several floors and the game layer, video, Devpost. Freeze 2026-12-01.
4. Push main when the user agrees (last push fcd0fd2).

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
| ghost-skins | 2 / 2 | feat/ghost-skins | Row 15. Task 1: 23 parts in `config/outfits.json`, recipes in `scene/outfit-parts.ts`, `data/wardrobe.json` kept by `Economy`, Outfits tab in the shop. Task 2: `data/outfits.json` kept by `WornStore`, `outfit_wear` checked by the shared `applyWear`, one `outfits` message (whole state) after the wardrobe and after each change, `outfit_error`, members dressed in the HR office and the user anywhere, entries pruned in `refreshTeam` when a member is no longer on the team, `OutfitBook` + `WorldView.applyLooks`, user's figure wears parts (`guestAnchors`), shared `look-picker.ts` in the HR card and a Look tab in the Profile, `data-looks` on the canvas for tests. Playwright: fourth test server (8798/5196, `FAKE_HR=1`, a scripted HR link). HR ghost and Builder cannot be dressed (design.md). Not looked at by the user |

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

## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-13.
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
