# Status

Updated: 2026-11-10

## Phase
Phase 0 done. world-room merged into main (S1, S3, S4, S5; tasks 1–11 done, task 12 waits for the user's browser check). Reviewed with agentlife-reviewer (docs/reviews/feat-world-room.md); its two blockers were fixed. `pnpm check` passes (153 tests). Next: S6 (agent-engine tasks 1–5). S2 (kiro-cli spike) is blocked on a security finding, see below.

## Run the client
Two terminals from the repo root (the client needs the world-server on 127.0.0.1:8787):
- `pnpm --filter @agentlife/world-server start`
- `pnpm --filter @agentlife/client dev` then open http://localhost:5173/ (Z or the button toggles 1×/2×)

## Specs
| Spec | Tasks done | Branch | Notes |
|---|---|---|---|
| world-room | 11 / 12 | main | Task 12 open: scripted WebSocket e2e passed; browser checklist below pending (user) |
| agent-engine | 0 / 10 | — | Next: S6 (tasks 1–5), S7 (6–10) |
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
- S2 (agent-pipeline task 1, kiro-cli spike) on feat/agent-pipeline: auth with KIRO_API_KEY, agent lookup, write-in-cwd and shell-deny OK; write OUTSIDE cwd was NOT denied (spike used --trust-all-tools). Proposed fix awaiting user OK: no --trust-all-tools + explicit outside-path deny, keep engine-side containment check; then re-run only that check. Findings: docs/spikes/kiro-cli.md on feat/agent-pipeline.
- Review suggestions not done yet (non-blocking): gateway sends some messages twice (`job_update`, `approval`); no in-flight state on approve (double click); `jobActive` has no timeout; engine error text is forwarded to the client (max 200 chars). Address in agent-engine integration (S7, task 10).
- Server packages must avoid constructor parameter properties and enums (`--experimental-strip-types`). Mirrored avatar directions are 0↔6, 1↔5, 2↔4 (design.md).
- GitHub public repo not created yet (needs user).
- The other account's email is still in commit 4e16788; rewrite history before the first push if the user confirms.
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- Discord: `pnpm notify` (free, Ollama summary, DM via the Crew bot); automatic session messages go to Discord only when the user last wrote from Discord (presence in data/presence.json). See docs/sessions.md.
- Model and effort per session: docs/sessions.md; runner `pnpm session next` (always starts from main).

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
