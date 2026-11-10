# Status

Updated: 2026-11-10

## Phase
Phase 0 done: scaffold, steering, CI, discovery docs, the four specs, reviewer agent, hooks and session plan. Next: session S1 (docs/sessions.md).

## Specs
| Spec | Tasks done | Branch | Notes |
|---|---|---|---|
| world-room | 0 / 12 | — | Ready to start (S1) |
| agent-engine | 0 / 10 | — | S6–S7 |
| agent-pipeline | 0 / 13 | — | Task 1 (kiro-cli spike) runs early in S2; it gates this spec |
| demo-replay | 0 / 7 | — | S11–S13 |

## Open problems / pending decisions
- GitHub public repo not created yet (needs user).
- KIRO_API_KEY not configured yet (needed for S2).
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- Discord: `pnpm notify` (free, Ollama summary, DM via the Crew bot) and Kiro Crew for remote work; see docs/sessions.md. The Crew bot cannot post in its configured channel (403), so notifications go by DM.
- kiro-cli is logged in with a Google account that only lists Free-tier models. Confirm which account holds the hackathon credits before S2.
- Model and effort per session: see docs/sessions.md. Automated runner: `pnpm session next` (plan in scripts/sessions.json, agent agentlife-builder). Not yet run for real.
- The other account's email was removed from docs/sessions.md but is still in commit 4e16788; rewrite history before the first push if the user confirms.
- The four specs were written by hand. If the Kiro Specs panel does not list them, open each with "Generate a spec from #requirements.md" or run its tasks from a normal session.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
