# How AGENT LIFE uses Kiro

AGENT LIFE uses Kiro in four places: the IDE, the product's own agents, the unattended build sessions, and the Discord side (Kiro Crew). Each item below links to the files that show it.

## 1. Specs

Every feature block is a Kiro spec with requirements, design and tasks. Each task has acceptance criteria, and a task is only marked done after `pnpm check` passes.

- Specs: [.kiro/specs/](.kiro/specs/), for example [world-room](.kiro/specs/world-room/), [agent-engine](.kiro/specs/agent-engine/), [agent-pipeline](.kiro/specs/agent-pipeline/), [job-insight](.kiro/specs/job-insight/), [demo-replay](.kiro/specs/demo-replay/).
- The demo is the last spec: [requirements](.kiro/specs/demo-replay/requirements.md), [design](.kiro/specs/demo-replay/design.md), [tasks](.kiro/specs/demo-replay/tasks.md).
- Design decisions that changed during implementation were written back into each spec's `design.md` ("Decisions made while implementing") and, when architectural, into [docs/risks-and-decisions.md](docs/risks-and-decisions.md).

## 2. Steering

Steering files give Kiro the project rules on every request, so a new session starts with the same constraints.

- [workflow.md](.kiro/steering/workflow.md): start and end-of-session protocol. The repository is the memory: each session reads [docs/STATUS.md](docs/STATUS.md), works on a `feat/<spec>` branch, makes one commit per task, and updates the status file.
- [tech.md](.kiro/steering/tech.md): stack and portability rules (Node 22, ES modules, `node:path`, no bash-only scripts).
- [security.md](.kiro/steering/security.md): the product's agent permissions, the Docker rule for tests, and the publishing gate.
- [product.md](.kiro/steering/product.md) and [structure.md](.kiro/steering/structure.md): scope, out-of-scope list and package boundaries.

## 3. Hooks

Hooks run automatically on Kiro events.

- [push-guard.json](.kiro/hooks/push-guard.json): a PreToolUse hook. Before any shell call that is a `git push`, it runs the leak scanner and blocks the push if it finds secrets or personal data.
- [typecheck-on-save.json](.kiro/hooks/typecheck-on-save.json): runs `pnpm typecheck` when a TypeScript file under `packages/` is saved.
- [status-reminder.json](.kiro/hooks/status-reminder.json): at the end of a run, checks that the spec's tasks and `docs/STATUS.md` match the work done.
- [presence-here.json](.kiro/hooks/presence-here.json): records that the user is at the PC, so automatic notifications stay in the chat and do not go to Discord.

## 4. Custom agents

Three custom agents, each with its own file permissions and shell allowlist.

- [agentlife-builder.json](.kiro/agents/agentlife-builder.json): the unattended implementer for spec tasks. It can write only in the project folders and cannot run `git push`, `git merge`, `git reset` or delete files. Its prompt is in [.kiro/agents/prompts/](.kiro/agents/prompts/).
- [agentlife-reviewer.json](.kiro/agents/agentlife-reviewer.json): a second-pass reviewer for finished tasks.
- [agentlife-security.json](.kiro/agents/agentlife-security.json): a read-only security officer. It scans files and git history for secrets and personal data and recommends decisions. It writes only to `data/security/` and never changes code or git.

## 5. kiro-cli in headless mode (the product's agents)

The product's Developer, Architect and QA agents run as `kiro-cli` processes. This is the core of the product, not a helper.

- Runtime: [packages/agent-engine/src/runtimes/kiro-cli.ts](packages/agent-engine/src/runtimes/kiro-cli.ts). It always passes `--v3`, never passes a `--trust-*` flag, sends the prompt on stdin, and uses a minimal environment. The agent file is the only grant surface.
- Agent definitions: [packages/agent-engine/agents/](packages/agent-engine/agents/). Architect and QA are read-only. Developer writes only in its task worktree and has no shell or network tools. Each file has `permissions.rules` with explicit deny entries.
- Prompt templates: [packages/agent-engine/prompts/](packages/agent-engine/prompts/). Repository contents go into fenced blocks that the text cannot close.
- Spike: [docs/spikes/](docs/spikes/) records the check that showed writes outside the working directory are denied with `--v3` and no trust flags.
- The engine validates every diff (paths, binaries, size) before the report step uses it.

## 6. Build sessions with `pnpm session`

Each spec task is run by `kiro-cli` with the builder agent. The runner picks the model and effort for each session, so cheaper models handle documentation and reviews and the stronger ones handle security-sensitive code.

- Runner: [scripts/run-session.ts](scripts/run-session.ts). Plan: [scripts/sessions.json](scripts/sessions.json). Rationale and prompts: [docs/sessions.md](docs/sessions.md).
- The runner refuses to start with uncommitted changes, and it stops before spending if the chosen model is not available to the account.

## 7. Property-based tests

The domain logic is tested with fast-check properties, in addition to examples. Examples:

- Replay schedule (gap compression and speed): [packages/client/test/replay-engine.test.ts](packages/client/test/replay-engine.test.ts).
- Isometric geometry and pathfinding: [packages/shared/test/geometry.test.ts](packages/shared/test/geometry.test.ts) and [packages/shared/test/pathfind.test.ts](packages/shared/test/pathfind.test.ts).
- Diff validation: [packages/agent-engine/test/validate-diff.test.ts](packages/agent-engine/test/validate-diff.test.ts).
- Event store and job state: [packages/agent-engine/test/store.test.ts](packages/agent-engine/test/store.test.ts) and [packages/agent-engine/test/runner.test.ts](packages/agent-engine/test/runner.test.ts).

## 8. Kiro Crew (Discord)

Kiro Crew is the Discord side of the same workflow. A Crew session can read the project status and continue the thread from the IDE.

- Notifications: `pnpm notify` sends a summary to Discord by direct message. Automatic session messages go to Discord only when the user last wrote from Discord.
- The shared conversation log is the "Last conversation with the user" section of [docs/STATUS.md](docs/STATUS.md). Both the IDE and Crew append to it.

## 9. Browser checks and end-to-end tests

- Playwright smoke test of the demo: [packages/client/e2e/demo.spec.ts](packages/client/e2e/demo.spec.ts), run in CI by [pages.yml](.github/workflows/pages.yml).
- The demo build check, [packages/client/tools/check-demo-build.ts](packages/client/tools/check-demo-build.ts), fails if the demo build contains a WebSocket URL or a live endpoint.

## Limits

- The live mode needs a Kiro plan with headless access and a `KIRO_API_KEY`. Judges cannot run it without those, which is why the demo replays a recorded run.
- Model output is not deterministic. The prompts are in [packages/agent-engine/prompts/](packages/agent-engine/prompts/), and the engine checks each step's output format before using it.
