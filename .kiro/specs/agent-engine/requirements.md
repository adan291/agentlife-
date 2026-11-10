# Requirements Document

## Introduction

The agent-engine is the independent process that owns jobs, agents, approvals, artifacts and the event log. This spec builds the engine core with a deterministic fake runtime: HTTP + SSE API, job state machine, SQLite event log, repo allowlist, runtime interface, timeouts and cancellation. Real runtimes (kiro-cli) and the real pipeline steps come in the agent-pipeline spec.

Context: docs/agent-system-design.md, docs/architecture-proposal.md. The engine knows nothing about tiles, rooms or sprites; it emits semantic anchors only.

## Requirements

### Requirement 1: HTTP API

**User Story:** As the world-server, I want a small HTTP API, so that I can drive jobs without knowing how agents run.

#### Acceptance Criteria
1. THE engine SHALL expose `GET /health`, `GET /repos`, `POST /tasks`, `GET /tasks/:id`, `POST /approvals/:id`, `POST /tasks/:id/cancel`, `GET /events`, `GET /tasks/:id/export`.
2. ALL request bodies and responses SHALL be validated with zod schemas from `@agentlife/shared`.
3. IF a body is invalid, THEN THE engine SHALL respond 400 with the zod issue paths; unknown ids SHALL respond 404.
4. THE engine SHALL bind to 127.0.0.1 by default (`ENGINE_HOST`, `PORT` env; default port 8788; refuses a non-loopback host without `ENGINE_TOKEN`) and require a shared secret header `x-agentlife-token` when `ENGINE_TOKEN` is set.

### Requirement 2: Event log

**User Story:** As a developer, I want every change recorded as an event, so that the system is observable, resumable and replayable.

#### Acceptance Criteria
1. THE engine SHALL append every job, agent, artifact, approval and report change as an `AgentEvent` (schema from `@agentlife/shared`) to an append-only SQLite table with a strictly increasing `seq`.
2. `GET /events` SHALL stream events as Server-Sent Events; WHEN `since=<seq>` (or `Last-Event-ID`) is given, THE engine SHALL first send every stored event with a greater seq, then live events, with no gaps or duplicates.
3. THE job view returned by `GET /tasks/:id` SHALL be derivable by folding that job's events (test: fold(events) equals stored view).
4. `GET /tasks/:id/export` SHALL return the job's events and artifact contents as one JSON document validated by `RunExportSchema`.

### Requirement 3: Job state machine

**User Story:** As a user, I want jobs to follow a fixed, predictable flow, so that agents cannot skip review or approval.

#### Acceptance Criteria
1. THE job states SHALL be: `created, analyzing, awaiting_plan_approval, developing, testing, reviewing, report_ready, delivered, failed, cancelled`.
2. THE engine SHALL only perform transitions listed in a single transition table; any other transition SHALL throw and be logged.
3. `delivered` and `cancelled` SHALL be terminal.
4. THE engine SHALL allow at most one non-terminal job at a time; IF another job is started, THEN it SHALL respond 409 `busy`.
5. WHEN QA returns `fail` for the first time, THE engine SHALL go back to `developing` once; a second `fail` SHALL go to `report_ready` with verdict fail.
6. Properties SHALL be tested with fast-check: from any random sequence of step outcomes and user actions, the job never leaves the transition table, never revisits `developing` more than twice, and always ends terminal when steps eventually finish.

### Requirement 4: Runtimes

**User Story:** As a developer, I want agents to run through a pluggable runtime, so that model or provider changes never touch the world or client.

#### Acceptance Criteria
1. THE engine SHALL define `AgentRuntime` with `run(input): AsyncIterable<RuntimeEvent>` and an `AbortSignal`.
2. THE engine SHALL read the role → runtime mapping from `config/agents.json` (validated) at startup.
3. THE engine SHALL include a `FakeRuntime` that returns canned plan, diff, test and review outputs, used in tests and when `RUNTIME=fake`.
4. THE engine SHALL include an `LlmRuntime` for an OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_MODEL`, optional `LLM_API_KEY`), used for short ambient lines (`agent.say`); IF the endpoint fails or times out (5 s), THEN THE engine SHALL fall back to canned lines and log the error.

### Requirement 5: Limits, timeouts and cancellation

**User Story:** As a user, I want runaway agents stopped, so that a stuck job never blocks the demo.

#### Acceptance Criteria
1. EACH step SHALL have a timeout from config (defaults: analyze 5 min, develop 10 min, test 5 min, review 5 min).
2. WHEN a timeout fires or the job is cancelled, THE engine SHALL abort the runtime, kill any child process tree, and record `task.failed` or `task.state_changed → cancelled`.
3. THE engine SHALL survive a restart: on startup, non-terminal jobs from a previous run SHALL be marked `failed` with reason `engine_restarted`.

### Requirement 6: Repository allowlist

**User Story:** As a user, I want agents to work only on approved repositories, so that nothing unexpected is read or executed.

#### Acceptance Criteria
1. THE engine SHALL read allowlisted repos from `config/repos.json` (`id`, `name`, `source` path inside the project, `testCommand`).
2. IF `POST /tasks` names a repo not in the allowlist, THEN THE engine SHALL respond 400 and SHALL NOT create a job.
3. Goal text SHALL be limited to 300 characters and treated as data inside prompts.

### Requirement 7: Observability

**User Story:** As a developer, I want logs and metrics per step, so that I can debug runs and measure cost.

#### Acceptance Criteria
1. THE engine SHALL write JSON-lines logs to stdout with `ts, level, msg, taskId?, step?`.
2. THE engine SHALL store raw runtime output per step in `data/runs/<taskId>/<step>.jsonl`.
3. THE engine SHALL record per-step duration, exit status and, when the runtime reports it, credits/tokens, and include them in the export.
4. Secrets SHALL never appear in logs, events or exports (test: a configured fake secret never appears in output).
