# Review: feat/hr-desk against main

Reviewed: 2026-11-12. Commits: b11e37e … e3d5b23 (tasks 1–5). Spec: `.kiro/specs/hr-desk` (requirements, design, tasks).

## Verdict: request changes

No code defect found in the paths checked. Two items need a decision or a record before merge:

1. The import review does not follow requirement 3.3, and the change of approach was not agreed with the user first (see below).
2. The architectural decisions of this branch are not recorded in `docs/risks-and-decisions.md`.

`pnpm check` passes on this branch (shared 211, world-server 137, client 440, agent-engine 598 passed, 7 skipped; scripts 16).

## Blocking

### 1. Import review uses a new agent, not `agentlife-security` (spec mismatch, needs the user)

- Requirement 3.3 says imports are "reviewed by the `agentlife-security` agent". Design.md (task 3 section, "Review") replaces it with `agentlife-import-review`, built in `team/service-agents.ts` and `team/import-review.ts`.
- The reason given is sound: `agentlife-security` can write under `data/security` and run git, so it should not read internet text. The new agent uses the read-only tier.
- The workflow says that when the design turns out wrong, stop and tell the user before changing the approach. The branch changed it and recorded it, but the user has not accepted it.
- Needed: the user accepts the replacement (then update requirement 3.3 in requirements.md) or asks for the original agent. Until then the requirement is not met as written.

### 2. Architectural decisions missing from `docs/risks-and-decisions.md`

The branch adds decisions that the workflow says to record when architectural:

- A second model runtime on the engine side (`runtimes/ollama.ts`), sending prompts to a local model, replacing requirement 6.1's `LlmRuntime`.
- A new read-only agent role for importing text from the internet (`agentlife-import-review`) and one for HR suggestions (`agentlife-hr`).
- Trusted imports from allowlisted HTTPS sources, with the approval bound to the content hash.

`docs/risks-and-decisions.md` is not in the diff. Add entries.

## Requirements not met as written

| Requirement | State | Where |
|---|---|---|
| 3.3 review by `agentlife-security` | Replaced (see blocking 1) | design.md, task 3 "Review" |
| 6.1 intern runtime is `LlmRuntime` | Replaced by `OllamaRuntime` plus `InternRuntime` (fallback). Design.md, task 5 explains why | `src/runtimes/ollama.ts`, `src/team/intern.ts` |
| 4.3 hired agents appear on their floor | Only a hire that takes a desk (first member of a role) shows. Second members wait on the bench. Recorded as a reading in design.md; needs the user's yes | `src/team/suggest.ts`, `client/src/scene/world-view.ts` |
| 6.3 fallback to claude-haiku-5.5 with report notice | Met: `runRole` writes the event, a terminal line and a `JobNotes` entry; `report.ts` prints `## Notes`. Notes are lost on engine restart (documented) | `src/steps/deps.ts`, `src/steps/report.ts` |

Everything else in the spec is met as far as the code and tests show: tiers as the only source of `tools` and `permissions`, property test over random template content (`test/team-generate.test.ts:148`), dropped fields (`test/team-import.test.ts:187`), hash-bound approval with `content_changed` (`test/team-import-routes.test.ts:79`), last architect/developer and working-agent refusals (`test/team-routes.test.ts:72`, `test/team.test.ts:263`), intern refusal of `analyze`, `develop`, `review` and no-step calls before anything runs (`test/intern.test.ts:168`, `:297`).

## Checked and fine

- Boundaries: the client only sends messages to the world-server (`hr_state`, `hr_do`). The world-server calls the engine over HTTP and never a model (`world-server/src/http-engine.ts`, `gateway.ts`). Nothing in `agent-engine/src` mentions tiles or sprites.
- Agent permissions: `read-only.json` and `write-in-worktree.json` deny shell and web_fetch and deny reads of secret-looking files. The write tier denies `.git`, env files, manifests, `.github`, `.kiro`. The generated file takes only `tools` and `permissions` from the tier (`team/generate.ts:agentFileFor`).
- Imports: HTTPS only, exact allowlist match after normalising, no redirects (`team/import.ts`, `redirect: "manual"`), no credentials, 10 s timeout, 64 KB cap while reading. Fixed prompt-injection patterns run on every import (`checkTemplateText`).
- Local model: `OllamaRuntime` refuses any address that is not loopback, refuses credentials in the URL, sends `redirect: "error"`, and `think: false`. `InternRuntime` calls the fallback only for `OllamaUnavailableError`, never after output has started, and never on cancellation.
- Untrusted text reaches prompts only inside `fence()`. Client rendering uses `textContent` or `createElement`; `innerHTML` appears only in the comment of `ui/markdown.ts`.
- Paths: no `new URL(...).pathname` as a file path. Project and member ids in HTTP paths go through `encodeURIComponent` (`http-engine.ts:95-106`).
- Agent file writes are staged, validated with `kiro-cli agent validate`, then moved (`team/generate.ts:writeAgentFile`). Names must match `AGENT_NAME_RE`. A project id that would start with `agentlife-` is refused (`team/service.ts:commit`).
- Scripts: no bash-only constructs in the changed scripts.

## Missing tests

- No test that the HR suggestion (`team/suggest.ts`) refuses a template whose role has no desk (reviewer, researcher). Code path exists; `test/team-suggest.test.ts` should cover it.
- No live run: real `kiro-cli` review and HR agent, a real download, Ollama with `qwen3.5:4b`. Listed in design.md and HUMAN-CHECKS.md. Acceptable for the merge decision, but the fallback path with a real `kiro-cli` is still unproven.
- No browser check of the HR panel. The client test (`client/test/hr-panel.test.ts`) and the Playwright HR smoke test (`client/e2e/hr.spec.ts`) cover render only.

## Non-blocking suggestions

1. `team/service.ts:336` builds a regex from project ids without escaping. Ids are limited to `[a-z0-9-]` by the schema, so this is safe today. Escape the id anyway, or compare names by prefix, to keep it safe if the schema changes.
2. `team/service.ts:commit` writes agent files one by one. If the third write fails, the first two files already hold the new content while the stored team is unchanged. Write to staging for all members first, then move them.
3. `steps/notes.ts`: the fallback note is kept in memory only. A job that fails at restart loses the note. Acceptable, but say so in the report of a failed job.
4. `team/import.ts` `checkTemplateText` only reports flags; the import is still queued. Show the flags as a warning on the approve button, so the user cannot approve blind.
5. `docs/STATUS.md` still says the branch is "not merged; needs review + verification" and lists this review as pending. Update it when the user accepts blocking 1 and 2.
