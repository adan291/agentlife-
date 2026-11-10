# Status

Updated: 2026-11-10

## Phase
Phase 0 done. Session S1 done: world-room tasks 1–4. Session S3 done: tasks 5–7. Session S4 done: world-room tasks 8–10 (client transport, palette, room rendering, procedural furniture and avatars, click input, name tags, status badges, speech bubbles). `pnpm check` passes. Next: world-room tasks 11–12 (panels, end-to-end check).

## Run the client
Two terminals from the repo root (the client needs the world-server on 127.0.0.1:8787):
- `pnpm --filter @agentlife/world-server start`
- `pnpm --filter @agentlife/client dev` then open http://localhost:5173/ (Z or the button toggles 1×/2×)

Verified by headless Chrome screenshot: room, furniture, 3 agents with badges and the user avatar render. Click-to-move, walking animation and bubbles were not exercised interactively.

## Specs
| Spec | Tasks done | Branch | Notes |
|---|---|---|---|
| world-room | 10 / 12 | feat/world-room | Next: tasks 11–12 (panels, e2e) |
| agent-engine | 0 / 10 | — | S6–S7 |
| agent-pipeline | 0 / 13 | — | Task 1 (kiro-cli spike) in S2; it gates this spec |
| demo-replay | 0 / 7 | — | S11–S13 |

## Open problems / pending decisions
- GitHub public repo not created yet (needs user).
- feat/world-room not reviewed or merged yet.
- Fixed in S4: world-server did not start under `node --experimental-strip-types` (TokenBucket used constructor parameter properties). Server packages must avoid parameter properties and enums. Mirrored avatar directions are 0↔6, 1↔5, 2↔4 (recorded in design.md).
- Background dev servers could not be stopped from the session (kill denied); a hidden world-server (port 8787) and vite (5173) may still be running.- The other account's email is still in commit 4e16788; rewrite history before the first push if the user confirms.
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- The four specs were written by hand. If the Kiro Specs panel does not list them, run tasks from a normal session or `pnpm session`.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
