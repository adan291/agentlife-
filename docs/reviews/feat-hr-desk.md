# Review: feat/hr-desk against main

Reviewed: 2026-11-12, HEAD 3ea56d9 (the verify commit on top of f0ba971). Spec: `.kiro/specs/hr-desk`.

## Verdict: request changes (two decisions left to the user)

Still open, unchanged since the last review:

1. Requirement 4.3 (hired agents appear on their floor) fails as written. Only the first member of a role with a desk shows (`packages/agent-engine/src/team/service.ts`, `currentTeam`, keeps the first member per role). Other hires wait on the bench. The verify report (`docs/reviews/feat-hr-desk-verify.md`) says the choice is the user's: show every member on the floor, or reword 4.3 to match the code.
2. D10 (`docs/risks-and-decisions.md`): the import review uses `agentlife-import-review` (read-only tier) instead of `agentlife-security`. Requirement 3.3 matches the code. The user has not ratified D10.

`pnpm check` passes on HEAD 3ea56d9: shared 211, world-server 137, client 440, agent-engine 598 passed and 7 skipped, scripts 16.

## Blocking

None in the code paths reviewed. The merge waits for the two user decisions above.

## Requirements not met as written

| Requirement | State | Where |
|---|---|---|
| 4.3 hired agents appear on their floor | Partly met: only the member holding a role's desk shows. Recorded as a reading in design.md (task 4); needs the user's yes or a code change | `src/team/service.ts` (`currentTeam`), `client/src/scene/world-view.ts`, `test/hr-desk-e2e.test.ts` |
| 3.3 review by `agentlife-security` | Replaced by `agentlife-import-review` (D10); requirement text updated, user not yet agreed | `team/service-agents.ts`, `team/import-review.ts` |
| 6.1 intern runtime is `LlmRuntime` | Replaced by `OllamaRuntime` plus `InternRuntime` (fallback); design.md task 5 explains it | `src/runtimes/ollama.ts`, `src/team/intern.ts` |
| 6.3 fallback to claude-haiku-5.5 with report notice | Met at unit level: event, terminal line, `JobNotes`, `## Notes` in the report. Notes are lost on engine restart (documented) | `src/steps/deps.ts` (`runRole`), `src/steps/report.ts` |

## Checked and fine

- Boundaries: the client sends only `hr_state` and `hr_do` to the world-server. The world-server calls the engine over HTTP and reads only model names, never a model. Nothing in `agent-engine/src` mentions tiles or sprites (grep of `tile` and `sprite`, case-insensitive, found no matches).
- Agent permissions: both tiers deny shell and web fetch, deny writes, and deny secret-looking files (`agents/tiers/read-only.json`). The generated agent file takes only `tools` and `permissions` from the tier (`team/generate.ts:agentFileFor`). Property tests in `team-generate.test.ts`.
- Last architect or developer cannot be fired (`service.ts`, `fire`). A working member cannot be fired (`workingMemberIds` from the job snapshots).
- Imports: HTTPS only, exact allowlist match, `redirect: "manual"` and `credentials: "omit"`, 10 s timeout, 64 KB cap (`team/import.ts`). Approval is bound to the content hash.
- Local model: `OllamaRuntime` accepts only loopback addresses (`isLoopbackUrl`), refuses credentials in the URL, and uses `redirect: "error"`. `InternRuntime` calls the fallback only when Ollama is unavailable and nothing has been streamed yet, and never on cancellation. `runRole` refuses the intern for any step outside `INTERN_STEPS` before a runtime starts.
- Untrusted text reaches prompts only inside `fence()`. The client renders with `textContent` or `createElement`.
- Paths: no `new URL(...).pathname` as a file path. Ids in HTTP paths go through `encodeURIComponent`. Request bodies are capped at 64 KB (`http/server.ts`).
- Agent file writes are staged, validated with `kiro-cli agent validate`, then moved. Names must match `AGENT_NAME_RE`, and a customised team cannot use the `agentlife-` prefix (`service.ts`, `commit`).
- Scripts: no bash-only constructs in the changed scripts.

## Missing tests and checks

- No live run: real `kiro-cli` review and HR agent, a real download, Ollama with `qwen3.5:4b`, the fallback with a real `kiro-cli`. Listed in design.md and HUMAN-CHECKS.md.
- No browser check of the HR panel. `client/test/hr-panel.test.ts` and `client/e2e/hr.spec.ts` cover render only.
- The live `kiro-cli agent validate` test is skipped without `AGENTLIFE_LIVE=1`.
- Not checked in this pass: whether a test covers a stored intern member reaching `runRole` through `TeamService.resolve`. `intern.test.ts` covers `runRole` with a stubbed member.

## Non-blocking suggestions

1. `team/service.ts` `syncAgents` builds a regex from project ids without escaping. Ids are limited to `[a-z0-9-]` by the schema, so this is safe today. Escape the id anyway.
2. `team/service.ts` `commit` writes agent files one by one. If a later write fails, earlier files already hold the new content while the stored team is unchanged. Stage all files first, then move them.
3. The service agents `agentlife-import-review` and `agentlife-hr` have `fs_read` for `**` (the tier). Their working directory is empty, but the permission does not confine reads to it, so a hostile imported persona could ask the reviewer to read files elsewhere on disk. The answer comes back as flags shown to the user (max 8, 200 characters each). Nothing leaves the machine. Check whether kiro-cli can confine `fs_read` to the working directory for these two agents, or record the risk in D10.
4. `team/import.ts` `checkTemplateText` only reports flags; the import stays queued. Show the flags as a warning on the approve button.
5. `steps/notes.ts`: the fallback note lives in memory only. Say so in the report of a failed job.
