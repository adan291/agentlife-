# Status

Updated: 2026-11-13 (furni-shop tasks 1 and 2 done on branch feat/furni-shop, not merged; task 3 is next; main 27 commits ahead of origin)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13.

## Phase
All TASKMAP rows 1-10 are merged into main (project-registry, hotel-floors, build-board, job-types, night-shift, hr-desk, project-memory, list-mode, pipeline-editor, furni-move). First real project done: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job, PASS, delivered as branch `agentlife/task-25942b7f`. Next rows: 11 furni-shop, 12 team-progress, 13 waiting-fun (the game layer), then 14 final-demo with the user.

## Run the hotel
Real engine (PowerShell, from the repo root; Docker running for tests):
- Engine: `cd packages\agent-engine`, set `$env:KIRO_API_KEY` from `.env`, `$env:LLM_BASE_URL='http://127.0.0.1:11434/v1'`, `$env:LLM_MODEL='qwen3.5:4b'`, then `node --experimental-strip-types --no-warnings src/main.ts` (port 8788).
- World-server: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start` (port 8787). Start it after the engine.
- Client: `pnpm --filter @agentlife/client dev`, open http://localhost:5173/.
- Fake engine instead: `$env:RUNTIME='fake'` for the engine (`FAKE_DELAY_MS`, default 800).
- The world-server serves one browser tab at a time. Do not run the conductor while the services are used: it switches branches in the same folder.

## Last conversation with the user
Newest last. Kiro IDE and Kiro Crew (Discord) both append here; older lines are in docs/STATUS-history.md.
- 2026-11-13 (IDE): DiscordIA live check done (job, approve, delivery as a branch; the user's `main` untouched). Fixes merged into main from it: new visits start in the lobby, one plaque over the elevator, writable `node_modules` in the test sandbox (vitest cache), review desk offers only branches with a base (`nothing_to_compare`), mailboxes come back after a restart (`/health restoreSeq`), report rows show "Open ›" and "Branch ready".
- 2026-11-13 (IDE): user asked to move furniture like in classic hotel sims: spec furni-move, done by the conductor (S27, S28), PASS and merged. User then described the goal: housing plus a light RPG / sims game layer, fun while waiting for the agents. Specs written: furni-shop (Ecto earned only from verified work, shop, inventory), team-progress (XP and levels from real stats, badges, daily quests), waiting-fun (wisp catching, sit and emotes, visual ghost mood); TASKMAP rows 11-13, sessions S29-S32. The user liked the plan.
- 2026-11-13 (IDE): the steering warned that workflow.md's reference to this file was cut (75 000 characters, budget 50 000). This file was split: the full old text is in docs/STATUS-history.md; workflow.md now asks sessions to keep it short. Conductor relaunched on rows 11-13.

## Next
1. Conductor: furni-shop task 3 (placing bought furniture, Playwright buy-place-reload), then team-progress (S31), waiting-fun (S32). Cut order if late: waiting-fun, then team-progress. Never cut final-demo.
2. With the user: browser checks in docs/HUMAN-CHECKS.md (25 open), including the furni-move arrange mode and new default layout.
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
| furni-shop | 2 / 3 | feat/furni-shop | Row 11. Wallet, grants, 25-item catalogue, shop counter and panel, buy. Chip with the balance is on the stage, not in the top bar (design.md). Browser tests of the shop pass (58 e2e). Not looked at by the user |
| team-progress | 0 / 2 | — | Row 12 |
| waiting-fun | 0 / 2 | — | Row 13 |

## Open problems
- Playwright's own Chromium is not installed on this machine (`pnpm --filter @agentlife/client e2e` fails to launch it). Run `$env:E2E_CHANNEL='msedge'` first to use the installed Edge. Not installed by a session (global tool).
- hr-desk D10 (docs/risks-and-decisions.md): import review by the read-only `agentlife-import-review` instead of `agentlife-security`. Explained to the user twice; waiting for a yes.
- hr-desk review suggestions not done: escape project ids in the regex in `team/service.ts` (~336); stage all agent files before moving them in `commit`; show import flags as a warning on the approve button.
- Mailbox shows only the latest report of a floor after a restart; older reports of the floor are not kept. Not investigated.
- Flaky tests seen once each: `pipeline-editor.spec.ts` "board shows the editor above the job card" (e2e timing), `pnpm check` under load while the services restart. The report property test flake was fixed (seed -515305606).
- DiscordIA: one of its own tests failed once in four sandbox runs (not identified).
- The demo replay and `run-001.json` predate floors, kinds and the game layer: re-record in final-demo.
- Scratch files outside git that a session could not delete: `data/tmp-pipeline-old.txt`, `data/tmp-demo-dist`, `data/tmp-check.txt` (all git-ignored).

## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-13.
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
