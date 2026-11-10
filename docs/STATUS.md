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
- BLOCKER agent-pipeline task 1 (kiro-cli spike): KIRO_API_KEY is not set (env var unset, no KIRO_API_KEY line in any .env*). The spike must verify API-key auth with an empty KIRO_HOME, so it cannot run. kiro-cli 3.1.0 is logged in via Google (interactive login), which does not prove key auth. Model claude-haiku-5.5 is listed and available. No kiro-cli chat call was made. Findings so far in docs/spikes/kiro-cli.md. Branch feat/agent-pipeline created from main.
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- Discord: `pnpm notify` (free, Ollama summary, DM via the Crew bot) and Kiro Crew for remote work; see docs/sessions.md. The Crew bot cannot post in its configured channel (403), so notifications go by DM.
- kiro-cli is logged in with a Google account that only lists Free-tier models. Confirm which account holds the hackathon credits before S2.
- Model and effort per session: see docs/sessions.md. Automated runner: `pnpm session next` (plan in scripts/sessions.json, agent agentlife-builder). Not yet run for real.
- The other account's email was removed from docs/sessions.md but is still in commit 4e16788; rewrite history before the first push if the user confirms.
- The four specs were written by hand. If the Kiro Specs panel does not list them, open each with "Generate a spec from #requirements.md" or run its tasks from a normal session.

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
