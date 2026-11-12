# Review: feat/hr-desk against main

Reviewed: 2026-11-12, HEAD f0ba971 (updates the review of b11e37e … e3d5b23). Spec: `.kiro/specs/hr-desk`.

## Verdict: request changes (one decision left to the user)

The blocking items of the first review are fixed in f0ba971:

- Import review: the replacement agent `agentlife-import-review` is recorded as D10 in `docs/risks-and-decisions.md`, and requirement 3.3 now names it. The user has not ratified D10 yet.
- Architectural decisions D9–D11 are recorded in `docs/risks-and-decisions.md`.
- The suggest test for roles without a desk (reviewer, researcher, night-intern) exists: `test/team-suggest.test.ts:116-118`.

Still open:

1. Requirement 4.3 (hired agents appear on their floor) fails as written. Only the first member of a role with a desk shows; other hires wait on the bench. The verify report (`docs/reviews/feat-hr-desk-verify.md`) says the choice is the user's: show every member on the floor, or change 4.3 to match the code.
2. D10: the user must ratify the use of `agentlife-import-review` instead of `agentlife-security`, or ask for a read-only tier on `agentlife-security`.

`pnpm check` passes on this branch (shared 211, world-server 137, client 440, agent-engine 598 passed and 7 skipped, scripts 16).

## Blocking

None in the code paths reviewed. The merge waits for the two user decisions above.

## Requirements not met as written

| Requirement | State | Where |
|---|---|---|
| 4.3 hired agents appear on their floor | Partly met: only the member holding a role's desk shows. Recorded as a reading in design.md (task 4); needs the user's yes or a code change | `src/team/suggest.ts`, `client/src/scene/world-view.ts`, `test/hr-desk-e2e.test.ts` |
| 3.3 review by `agentlife-security` | Replaced by `agentlife-import-review` (D10); requirement text updated, user not yet agreed | `team/service-agents.ts`, `team/import-review.ts` |
| 6.1 intern runtime is `LlmRuntime` | Replaced by `OllamaRuntime` plus `InternRuntime` (fallback); design.md task 5 explains it | `src/runtimes/ollama.ts`, `src/team/intern.ts` |
| 6.3 fallback to claude-haiku-5.5 with report notice | Met at unit level: event, terminal line, `JobNotes`, `## Notes` in the report. Notes are lost on engine restart (documented) | `src/steps/deps.ts`, `src/steps/report.ts` |

## Checked and fine

- Boundaries: the client sends only `hr_state` and `hr_do` to the world-server. The world-server calls the engine over HTTP and reads only model names, never a model. Nothing in `agent-engine/src` mentions tiles or sprites.
- Agent permissions: both tiers deny shell and web fetch and deny secret-looking files. The generated agent file takes only `tools` and `permissions` from the tier (`team/generate.ts:agentFileFor`). Property tests in `team-generate.test.ts`.
- Imports: HTTPS only, exact allowlist match, no redirects (`redirect: "manual"`), 10 s timeout, 64 KB cap, leak scan, fixed injection checks. Approval is bound to the content hash.
- Local model: `OllamaRuntime` accepts only loopback addresses, refuses credentials in the URL, uses `redirect: "error"`. `InternRuntime` calls the fallback only when Ollama is unavailable, never after output has started or on cancellation.
- Untrusted text reaches prompts only inside `fence()`. The client renders with `textContent` or `createElement`.
- Paths: no `new URL(...).pathname` as a file path. Ids in HTTP paths go through `encodeURIComponent`.
- Agent file writes are staged, validated with `kiro-cli agent validate`, then moved. Names must match `AGENT_NAME_RE`.
- Scripts: no bash-only constructs in the changed scripts.

## Missing tests and checks

- No live run: real `kiro-cli` review and HR agent, a real download, Ollama with `qwen3.5:4b`, the fallback with a real `kiro-cli`. Listed in design.md and HUMAN-CHECKS.md.
- No browser check of the HR panel. `client/test/hr-panel.test.ts` and `client/e2e/hr.spec.ts` cover render only.
- The live `kiro-cli agent validate` test is skipped without `AGENTLIFE_LIVE=1`.

## Non-blocking suggestions

1. `team/service.ts:334` builds a regex from project ids without escaping. Ids are limited to `[a-z0-9-]` by the schema, so this is safe today. Escape the id anyway.
2. `team/service.ts` `commit` writes agent files one by one. If a later write fails, earlier files already hold the new content while the stored team is unchanged. Stage all files first, then move them.
3. `team/import.ts` `checkTemplateText` only reports flags; the import stays queued. Show the flags as a warning on the approve button.
4. `steps/notes.ts`: the fallback note lives in memory only. Say so in the report of a failed job.
