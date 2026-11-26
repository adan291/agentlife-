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

## 4. Custom agents

Four custom agents, each with its own file permissions and shell allowlist.

- [agentlife-builder.json](.kiro/agents/agentlife-builder.json): the unattended implementer for spec tasks. It can write only in the project folders and cannot run `git push`, `git merge`, `git reset` or delete files. Its prompt is in [.kiro/agents/prompts/](.kiro/agents/prompts/).
- [agentlife-reviewer.json](.kiro/agents/agentlife-reviewer.json): a second-pass reviewer for finished tasks.
- [agentlife-security.json](.kiro/agents/agentlife-security.json): a read-only security officer. It scans files and git history for secrets and personal data and recommends decisions. It writes only to `data/security/` and never changes code or git.
- [agentlife-verifier.json](.kiro/agents/agentlife-verifier.json): the acceptance verifier. It checks a finished spec branch criterion by criterion, with evidence (tests, code, command output), and writes a PASS or FAIL report to `docs/reviews/`. It never edits code.

## 5. kiro-cli in headless mode (the product's agents)

The product's Developer, Architect and QA agents run as `kiro-cli` processes. This is the core of the product, not a helper.

- Runtime: [packages/agent-engine/src/runtimes/kiro-cli.ts](packages/agent-engine/src/runtimes/kiro-cli.ts). It always passes `--v3`, never passes a `--trust-*` flag, sends the prompt on stdin, and uses a minimal environment. The agent file is the only grant surface.
- Agent definitions: [packages/agent-engine/agents/](packages/agent-engine/agents/). Architect and QA are read-only. Developer writes only in its task worktree and has no shell or network tools. Each file has `permissions.rules` with explicit deny entries.
- Prompt templates: [packages/agent-engine/prompts/](packages/agent-engine/prompts/). Repository contents go into fenced blocks that the text cannot close.
- Spike: [docs/spikes/](docs/spikes/) records the check that showed writes outside the working directory are denied with `--v3` and no trust flags.
- The engine validates every diff (paths, binaries, size) before the report step uses it.
- Kiro is the default runtime behind the `AgentRuntime` interface. The multi-runtime spec, also built with Kiro, added an OpenAI-compatible runtime for Ollama, LM Studio, Groq, xAI, OpenAI and OpenRouter. There the engine itself runs the file tools inside the job's folder, with the same deny list as the Kiro agent files (D19 in [docs/risks-and-decisions.md](docs/risks-and-decisions.md)).

## 6. Build sessions with `pnpm session`

Each spec task is run by `kiro-cli` with the builder agent. The runner picks the model and effort for each session, so cheaper models handle documentation and reviews and the stronger ones handle security-sensitive code.

- Runner: [scripts/run-session.ts](scripts/run-session.ts). Plan: [scripts/sessions.json](scripts/sessions.json). Rationale and prompts: [docs/sessions.md](docs/sessions.md).
- The runner refuses to start with uncommitted changes, and it stops before spending if the chosen model is not available to the account.
- The conductor, [scripts/conduct.ts](scripts/conduct.ts) (`pnpm conduct`), runs the whole plan in [docs/TASKMAP.md](docs/TASKMAP.md). For each spec it runs the build sessions, then the reviewer agent, then the verifier agent, with at most two fix rounds when the verifier says FAIL. Only a PASS is merged. Features that need a human look are queued in `docs/HUMAN-CHECKS.md` and the run goes on.

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
- Regression suite (164 Playwright tests): user journeys through the whole hotel (shop, HR, project floor with a job, delivery, Profile), layout and interface rules at three sizes, and 127 screenshot comparisons. The suite starts its own servers and writes only scratch files; it never touches the hotel's `data/`. Every spec merge runs it; CI runs it on Linux and Windows on every push. See [packages/client/e2e/](packages/client/e2e/).

## 10. What was not built by Kiro

- The `.kiro/specs/` files were written by the developer and by Kiro together (the developer wrote the first draft of requirements; Kiro filled in the design after the first implementation attempt). Requirements in `.kiro/specs/*/requirements.md` and decisions in `.kiro/specs/*/design.md` are the shared design record.
- The `docs/risks-and-decisions.md` file is maintained by both. Each entry records the decision, the reason, and the alternative that was rejected.
- Security decisions (history rewrite, allowing a scan finding, D10) were always made by the developer; Kiro recommended but never acted alone.
- The video and the Devpost submission are the developer's.

## 11. The judges' questions, one by one

- **IDE, CLI, Web, Crew.** The IDE is where the work was steered and reviewed: the multi-runtime spec, the split of the world-server gateway into feature modules, the architecture test, the video recorder and the submission material were built in IDE chat. `kiro-cli` is where unattended work ran: the product's own agents (section 5) and the build sessions run by the conductor (section 6). Kiro Crew carried the same thread to Discord (section 8). Kiro Web was not used. When the monthly usage limit stopped the headless runs, the IDE kept the project moving, and the product learned to run on other AIs (multi-runtime). That is why the public demo was recorded on a local model.
- **Custom agents.** Four (section 4). The verifier turned "is the spec really done?" into a written PASS or FAIL per acceptance criterion before the conductor merged. During the regression-suite spec it failed the work twice because two panels were not compared in the screenshots; both were added before the merge, and writing them found two real interface bugs.
- **Hooks.** Three (section 3). The push guard runs the leak scanner before any `git push`. It is part of why the published history has no personal emails or key-shaped strings: the history was rewritten twice with `git filter-repo`, and the decisions were the developer's.
- **Spec-driven development compared with vibe coding.** 28 specs, each with requirements, a design and tasks with acceptance criteria. A task counts as done only after `pnpm check` passes. That structure is what let the conductor build and verify specs unattended. Two pieces were built in IDE chat without a spec first, the gateway split and the video recorder. The split was safe because 514 existing tests stayed untouched and passing, and an architecture test now keeps the layering. The recorder had no tests, and it was where the late surprises were (a page the browser refused to frame, a tooltip showing over a report). The specs cost more at the start.
- **Steering.** Five files (section 2). `workflow.md` makes the repository the memory of the project: every session starts by reading `docs/STATUS.md`. The strategy that mattered most was keeping that file short. When it grew to 75,000 characters Kiro warned that the text included from it was being cut, so it was split into a short current file and a history file, and a size limit went into `workflow.md`.
- **MCP.** The project does not depend on any MCP server, and no spec was built around one. A `fetch` server is configured in the developer's own Kiro settings, outside the repository.
- **Property-based tests.** fast-check on the pure parts: isometric projection and depth sort, pathfinding, the job state machine, diff validation, the replay schedule, bug fingerprints and the idempotence of masking, and the engine's file tools (random paths must never leave the job folder). We did not log which bugs they caught, so we claim none in particular.
- **Kiro powers.** No powers were used.

## Limits

- With Kiro, the live mode needs a plan with headless access and a `KIRO_API_KEY`. Without one, the same pipeline runs on a local model (`pnpm hotel --ai ollama`) or another OpenAI-compatible AI (multi-runtime). The public demo replays a recorded real run (2026-11-24, all three roles on Ollama `qwen3.5:4b`), so judges need nothing installed.
- A small local model is slow (a one-file change takes a few minutes) and follows the output formats less reliably than Kiro's models; the engine's format checks and retries catch most of it.
- Model output is not deterministic. The prompts are in [packages/agent-engine/prompts/](packages/agent-engine/prompts/), and the engine checks each step's output format before using it.
