# Status

Updated: 2026-11-11

## Phase
Phase 0 done. world-room merged into main (S1, S3, S4, S5; tasks 1–11 done, task 12 waits for the user's browser check). Reviewed with agentlife-reviewer (docs/reviews/feat-world-room.md); its two blockers were fixed. agent-engine merged into main (S6, S7; 10/10). Review docs/reviews/feat-agent-engine.md: blocker fixed (ENGINE_HOST, refuses a non-loopback host without ENGINE_TOKEN). Two-process e2e verified: engine (RUNTIME=fake) + world-server ENGINE=http, a scripted WebSocket client went start_job -> approve -> report. `pnpm check` passes (226 tests). Next: agent-pipeline, once the S2 security finding is resolved. S2 (kiro-cli spike) is blocked on a security finding, see below.

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
| agent-pipeline | 0 / 13 | feat/agent-pipeline | Task 1 (spike) blocked, see open problems |
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
- S2 (agent-pipeline task 1, kiro-cli spike) on feat/agent-pipeline: auth with KIRO_API_KEY, agent lookup, write-in-cwd and shell-deny OK; write OUTSIDE cwd was NOT denied (spike used --trust-all-tools). Proposed fix awaiting user OK: no --trust-all-tools + explicit outside-path deny, keep engine-side containment check; then re-run only that check. Findings: docs/spikes/kiro-cli.md on feat/agent-pipeline.
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
