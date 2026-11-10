# Status

Updated: 2026-11-10

## Phase
Phase 0 done. world-room tasks 1-12 done (S1, S3, S4, S5). Panels (computer, mailbox, board, safe markdown) added. `pnpm check` and client build pass. Next: review and merge feat/world-room (user), then agent-engine.

## Run the client
Two terminals from the repo root (the client needs the world-server on 127.0.0.1:8787):
- `pnpm --filter @agentlife/world-server start`
- `pnpm --filter @agentlife/client dev` then open http://localhost:5173/ (Z or the button toggles 1×/2×)

Verified by headless Chrome screenshot: room, furniture, 3 agents with badges and the user avatar render. Click-to-move, walking animation and bubbles were not exercised interactively.

## Specs
| Spec | Tasks done | Branch | Notes |
|---|---|---|---|
| world-room | 12 / 12 | feat/world-room | Pending user browser check and review |
| agent-engine | 0 / 10 | — | S6–S7 |
| agent-pipeline | 0 / 13 | — | Task 1 (kiro-cli spike) in S2; it gates this spec |
| demo-replay | 0 / 7 | — | S11–S13 |

## Manual browser checks (world-room task 12, user to do)
Automated so far: a scripted WebSocket client against ENGINE=fake (use computer_desk_1 -> repos + open_panel computer -> start_job -> approval -> approve -> developing/testing/reviewing -> delivered + report in ~10 s) passed. The panels themselves were NOT exercised in a browser. Run both servers (see above) and check:
1. Click the computer desk: avatar walks there, Computer panel opens listing haunted-todo.
2. Empty goal + Start job does nothing; text over 300 chars is impossible to type; counter updates.
3. Start job: button shows "Job running...", Architect shows thinking/working bubbles and badges.
4. After ~6 s the plan approval arrives. Click the mailbox: panel lists the pending plan with Approve / Reject.
5. Approve: status changes to approved, Developer and QA states change, no errors in console.
6. Board: click it; timeline shows each state with a time. It updates live while open.
7. Mailbox after ~10 s: report renders as headings/lists, no raw HTML. Esc and the Close button both close any panel; the canvas stays clickable when closed.
8. Start a second job after the first ends, and a job with Reject (the old approvals must disappear from the mailbox).
9. Stop the world-server while the computer panel is open: banner reconnects; reopen computer shows an engine error, not a blank panel.
10. Typing in the goal box then pressing Z must not toggle zoom (already guarded); a server message arriving while typing re-renders the form and may drop focus (known, minor).
## Open problems / pending decisions
- Observed in S5 e2e: the gateway sends some messages twice (`job_update` x3 at job start, `approval` x2 when it is requested). The client upserts, so it is harmless; worth a look in agent-engine integration.
- GitHub public repo not created yet (needs user).
- feat/world-room not reviewed or merged yet.
- Fixed in S4: world-server did not start under `node --experimental-strip-types` (TokenBucket used constructor parameter properties). Server packages must avoid parameter properties and enums. Mirrored avatar directions are 0↔6, 1↔5, 2↔4 (recorded in design.md).
- Background dev servers could not be stopped from the session (kill denied); a hidden world-server (port 8787) and vite (5173) may still be running.- The other account's email is still in commit 4e16788; rewrite history before the first push if the user confirms.
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- The four specs were written by hand. If the Kiro Specs panel does not list them, run tasks from a normal session or `pnpm session`.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
