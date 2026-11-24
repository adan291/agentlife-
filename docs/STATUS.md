# Status

Updated: 2026-11-16 (multi-runtime tasks 1-3 done and merged into main; rows 1-18 are in main)

Keep this file short (under 15 000 characters): it is loaded into every session through workflow.md. Per-spec implementation notes go in the spec's design.md; when an entry here stops being current, move it to docs/STATUS-history.md. That file holds everything written here up to 2026-11-13, the conversation lines up to 2026-11-14 and the long spec rows of 2026-11-14.

## Phase
TASKMAP rows 1-18 are merged into main (everything up to multi-runtime). Real projects: DiscordIA (`D:\AgentHotel\DiscordIA`) got a job on Kiro (PASS, delivered as branch `agentlife/task-25942b7f`) and one with all three roles on Ollama `qwen3.5:4b` (PASS, 2026-11-16). Next: final-demo with the user.

## Run the hotel
- One command: `pnpm hotel` (or double-click `Start AGENT LIFE.cmd`). Real agents when an AI (Kiro key, else Ollama, else a cloud key in .env) and Docker are there, else scripted; `--ai <provider> --model <model>`, `--fake`, `--real`, `--restart`, `--no-open`. With Kiro credits out: `pnpm hotel --ai ollama --model qwen3.5:4b`. Ctrl+C stops all three (scripts/hotel.ts, helpers tested in scripts/test/hotel.test.ts). By hand:
Real engine (PowerShell, from the repo root; Docker running for tests):
- Engine: `cd packages\agent-engine`, set `$env:KIRO_API_KEY` from `.env`, `$env:LLM_BASE_URL='http://127.0.0.1:11434/v1'`, `$env:LLM_MODEL='qwen3.5:4b'`, then `node --experimental-strip-types --no-warnings src/main.ts` (port 8788).
- World-server: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start` (port 8787). Start it after the engine.
- Client: `pnpm --filter @agentlife/client dev`, open http://localhost:5173/.
- Fake engine instead: `$env:RUNTIME='fake'` for the engine (`FAKE_DELAY_MS`, default 800).
- The world-server serves one browser tab at a time. Do not run the conductor while the services are used: it switches branches in the same folder.

## Last conversation with the user
Newest last. Kiro IDE and Kiro Crew (Discord) both append here; older lines are in docs/STATUS-history.md.
- 2026-11-16 (IDE): implemented all actionable items from the kiroween-review document:- 2026-11-16 (IDE): user asked for a very easy way to start the hotel. Added `pnpm hotel` (scripts/hotel.ts + hotel-lib.ts with tests) and `Start AGENT LIFE.cmd`: reads .env (known keys only), checks ports, starts Docker Desktop on Windows if needed, falls back to scripted agents with the reason, finds Ollama, starts engine then world-server then client, opens the browser; the Kiro key goes to the engine only and is masked in the logs. Checked live: start, a second run refuses with a hint, --restart, Ctrl+C leaves no process on the ports. README Quick start section.

- 2026-11-16 (IDE): user wants the tool dynamic: any AI, not only Kiro, several at once (Ollama, Grok...). Checked: Ollama qwen3.5:4b and llama3.1 both do tool calling on the OpenAI-compatible API (11 s). Spec multi-runtime written (providers.json, OpenAICompatRuntime with an engine-run tool loop as the sandbox, provider per role and per HR member, HR pickers, pnpm hotel keys), TASKMAP row 18. Kiro credits are out, so Kiro builds it in the IDE, not the conductor. Waiting for the user's go.
- 2026-11-16 (IDE): user: "hagamoslo ahora". multi-runtime built in the IDE, 3 tasks, merged and pushed: providers.json, OpenAICompatRuntime with engine-run file tools (D19), provider per role and per HR member with pickers and the cloud notice, `model (Provider)` in reports and seats, `pnpm hotel --ai/--model` and cloud keys for the engine only. Live: a DiscordIA job fully on Ollama qwen3.5:4b, PASS; the first two tries showed the small model looping and skipping the json block, so the loop now refuses repeated calls, asks for the answer before the limit and reminds about the json block (design.md). 5 visual baselines rewritten (6 to 28 pixels of browser drift). Pending: the user's xAI or Groq key, if any, to try a cloud AI; final-demo.

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
| multi-runtime | 3 / 3 | main | Row 18. Any OpenAI-format AI with tool calls (Ollama, LM Studio, Groq, xAI, OpenAI, OpenRouter) per role (`agents.json`), per HR member, or per run (`pnpm hotel --ai`); the engine runs the file tools (D19). Live on Ollama 2026-11-16; no cloud AI tried (no key) |
| bug-sack | 2 / 2 | main | Row 17. Task 1: shared `bugs.ts` (schemas, fingerprint, `BugBook`) and `bugs-node.ts` (masking, file format, inbox), world-server `BugStore` (`data/bugs.jsonl`, `AGENTLIFE_BUGS_FILE`, only with `ENGINE=http` or that variable), Code grabbers, `pnpm run bugs` (D17). Task 2: Game grabber, Report a bug (F8, screenshot sent in pieces, D18), Bug sack panel, bug jar in the lobby, `bug_news` push, Menu items and dot, off in the demo (design.md "Task 2"). Every Playwright test server has a scratch `AGENTLIFE_BUGS_FILE`. Not run live, not looked at by the user |

## Open problems
- ui-tidy: a piece behind a taller one is picked by pressing its drawing above the tile (design.md); not fixed.
- Flaky: `pipeline-editor.spec.ts` "board shows the editor" (e2e timing, passes alone); `pnpm check` under load on two world-server timing tests.
- The demo replay (`run-001.json`) predates floors and the game layer. Kiro credits exhausted for the month (renewal ~Dec 1); re-record with real agents on Ollama (`pnpm hotel --ai ollama`) or `RUNTIME=fake`.
- multi-runtime: a 4B local model is slow (a one-line change took about 6 minutes) and may still miss the plan format on a bigger goal; the analyze timeout is 5 minutes for every provider.
- ghost-skins: check every part at 1x on every role colour is a human check (not yet done).
- regression-suite: visual baselines exist for Windows/Edge only; CI skips them. First Linux run will confirm the browser job passes.
- waiting-fun: mood not kept across a restart; after 10 catches for the same scripted task id no wisp pays (fake engine reuses ids).


## Security
- History rewritten twice with git filter-repo (noreply identity `14869836+adan291@users.noreply.github.com`, no personal emails, no key-shaped literals); backups in `data/backup/` (git-ignored). Local git config uses the noreply address. `pnpm security:scan` clean on 2026-11-16.
- Nothing is pushed while the scan reports high or medium findings (push guard hook and git pre-push hook). Decisions on findings are the user's.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
