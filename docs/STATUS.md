# Status

Updated: 2026-11-11

## Phase
Phase 0 done. world-room merged into main (S1, S3, S4, S5; tasks 1–11 done, task 12 waits for the user's browser check). Reviewed with agentlife-reviewer (docs/reviews/feat-world-room.md); its two blockers were fixed. agent-engine merged into main (S6, S7; 10/10). Review docs/reviews/feat-agent-engine.md: blocker fixed (ENGINE_HOST, refuses a non-loopback host without ENGINE_TOKEN). Two-process e2e verified: engine (RUNTIME=fake) + world-server ENGINE=http, a scripted WebSocket client went start_job -> approve -> report. `pnpm check` passes (272 tests, 2 live-only skipped). agent-pipeline tasks 1–5 (S2, S8) are done on feat/agent-pipeline, not merged. Next: S9 (tasks 6–9: analyze, develop + diff validation, Docker runner, review).

## Run the client
Two terminals from the repo root (the client needs the world-server on 127.0.0.1:8787):
- `pnpm --filter @agentlife/world-server start`
- `pnpm --filter @agentlife/client dev` then open http://localhost:5173/ (Z or the button toggles 1×/2×)

With the real engine (RUNTIME=fake): start the engine first, then the world-server with `ENGINE=http` (`ENGINE_URL` default http://127.0.0.1:8788, `ENGINE_TOKEN` optional on both):
- `pnpm --filter @agentlife/agent-engine start` (`FAKE_DELAY_MS`, default 800, sets the pace of the fake agents)
- PowerShell: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start`

## Specs
| Spec | Tasks done | Branch | Notes |
|---|---|---|---|
| world-room | 11 / 12 | main | Task 12 open: scripted WebSocket e2e passed; browser checklist below pending (user) |
| agent-engine | 10 / 10 | main | Merged. Two-process e2e verified by script |
| agent-pipeline | 5 / 13 | feat/agent-pipeline | Tasks 1–5 done: spike, fixture, materialise, role agents + prompts, KiroCliRuntime (not wired into the engine yet, task 11). Next: tasks 6–9 |
| demo-replay | 0 / 7 | — | S11–S13 |

## Manual browser checks (world-room task 12, user to do)
Automated so far: a scripted WebSocket client against ENGINE=fake (use computer_desk_1 -> repos + open_panel computer -> start_job -> approval -> approve -> developing/testing/reviewing -> delivered + report in ~10 s) passed. Run both servers (see above) and check:
1. Click the computer desk: avatar walks there, Computer panel opens listing haunted-todo.
2. Empty goal + Start job does nothing; text over 300 chars is impossible to type; counter updates.
3. Start job: button shows "Job running...", Architect shows thinking/working bubbles and badges.
4. After ~6 s the plan approval arrives. Click the mailbox: panel lists the pending plan with Approve / Reject.
5. Approve: status changes to approved, Developer and QA states change, no errors in console.
6. Board: click it; timeline shows each state with a time. It updates live while open.
7. Mailbox after ~10 s: report renders as headings/lists, no raw HTML. Esc and the Close button both close any panel; the canvas stays clickable when closed.
8. Start a second job after the first ends, and a job with Reject (pending approvals of finished jobs must disappear from the mailbox).
9. Stop the world-server while the computer panel is open: banner reconnects; reopen computer shows an engine error, not a blank panel.
10. Typing in the goal box then pressing Z must not toggle zoom (already guarded); a server message arriving while typing re-renders the form and may drop focus (known, minor).

## Open problems / pending decisions
- Decided in agent-engine task 6 (recorded in the spec's design.md): the transition table gained `created -> failed`, `awaiting_plan_approval -> failed` and `reviewing -> failed` (review timeout and restart recovery, as recommended). Other conventions: plan rejection and cancel end in `cancelled` with no report; a step error or timeout ends `failed -> report_ready -> delivered` with a failure report; `report_ready`/`failed` are not cancellable (409). Not in risks-and-decisions.md because it is not architectural.
- agent-engine e2e check (agent-engine task 10): done with an in-process script (real engine + HttpEngineLink + gateway + WebSocket client, fake runtime): start_job -> approval -> approve -> delivered + report in ~1.3 s with 150 ms fake delay. Running the engine and world-server as two background processes from the unattended shell did not stay up, so the two-process run and the browser run are still for the user.
- Gateway change made in task 10: `jobActive` is cleared when the current task reaches `cancelled` or `delivered` (the real engine does not send task.failed/completed after a rejected plan, which would have left the UI on "Job running...").
- agent-engine notes: approval `note` is accepted by the API but not stored (the `approval.resolved` event has no note field). Per-step credits/tokens come from the run logs `data/runs/<taskId>/<step>.jsonl` and are summed in the export; no event carries them. The `test` step is a canned pass until agent-pipeline adds the Docker runner; `kiro-cli` runtime in config/agents.json is rejected at startup until agent-pipeline.
- Engine restarts: the HttpEngineLink starts from the engine's head (`/health.lastSeq`), so a world-server restart does not replay old jobs; it reconnects with the last seq and resets if the engine DB has a lower seq.
- agent-engine naming: the engine-side job view is `EngineJobViewSchema` (`JobView` already exists as the client-facing view in protocol.ts); recorded in design.md. Fold conventions (steps from state changes, verdict via reason `verdict:pass|fail` on the transition into `report_ready`) are in design.md. Token/credit per step is not in events yet (task 9).
- `pnpm-workspace.yaml` now has `allowBuilds: better-sqlite3: true` (needed for the prebuilt binary).
- agent-pipeline tasks 2–5 (S8), what exists and what to know for tasks 6–9:
  - Fixture `fixtures/repos/haunted-todo` (outside the pnpm workspace; own `package-lock.json`, Vitest 5.1.0, 7 passing + 1 skipped test). `config/repos.json` source is now `fixtures/repos/haunted-todo`. `steps/materialise.ts` creates `data/repos/<id>` (single commit, author `AGENT LIFE Engine`, fixed date, so the commit id is stable). `git.ts` has the `git()` helper (no shell, no user/system git config, `NUL` as global config on Windows) and the `DEVELOPER_IDENTITY` for task 7. `paths.ts` has `dataPaths()` and `isInside()`.
  - Role agents in `packages/agent-engine/agents/*.json` (system prompt inline), task templates in `prompts/*.md` (placeholders goal, task, feedback, diff, testLog, testStatus; no retry placeholder, the retry appends the zod error). `prompts.ts` has `renderPrompt` (one pass) and `fence` (untrusted text in a fence the text cannot close). `installAgents()` runs from `startEngine` when a role uses `kiro-cli`.
  - `KiroCliRuntime` (`runtimes/kiro-cli.ts`): `--v3`, no trust flags, prompt on stdin, minimal env (live-checked on Windows), `RuntimeInput.rawLogPath` for raw JSONL. Steps in tasks 6, 7 and 9 must pass `rawLogPath` (`data/runs/<taskId>/<step>.raw.jsonl`) and `cwd`. `buildRuntimes` in `engine.ts` still rejects `kiro-cli`; task 11 wires it.
  - `kiro-cli agent validate` accepts unknown capabilities and invalid effects, so it is only a load check. The permission rules are tested by shape in `test/agents.test.ts`; behaviour is covered by the spike and the live runs. The agent-validate and live runtime tests run with `AGENTLIFE_LIVE=1` (key in the environment); the live architect test passed (22 s).
  - Sessions here cannot write under `data/` with the edit tools (permission rule); use scripts for anything that must land there.
- S2 spike resolved: with `--v3` and no trust flags, writes outside cwd are denied (the earlier failure came from V2 + `--trust-all-tools`). Product agents must always use `--v3` and never trust flags; engine-side containment check stays. Credits are not in stream-json: measure from the usage panel in the live runs.
- Review suggestions not done yet (non-blocking): gateway sends some messages twice (`job_update`, `approval`); no in-flight state on approve (double click); engine error text is forwarded to the client (max 200 chars). `jobActive` timeout is partly covered (cleared on cancelled/delivered). Revisit with the next review.
- Server packages must avoid constructor parameter properties and enums (`--experimental-strip-types`). Mirrored avatar directions are 0↔6, 1↔5, 2↔4 (design.md).
- GitHub public repo not created yet (needs user).
- The other account's email is still in commit 4e16788; rewrite history before the first push if the user confirms.
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- Discord: `pnpm notify` (free, Ollama summary, DM via the Crew bot); automatic session messages go to Discord only when the user last wrote from Discord (presence in data/presence.json). See docs/sessions.md.
- Model and effort per session: docs/sessions.md; runner `pnpm session next` (always starts from main).

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
