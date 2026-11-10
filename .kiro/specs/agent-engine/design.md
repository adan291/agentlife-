# Design Document: agent-engine

## Overview

A single Node process (`packages/agent-engine`) with four layers:

```
http/      node:http server, tiny router, zod validation, SSE
jobs/      transition table, JobRunner (drives steps), JobView fold
runtimes/  AgentRuntime interface, FakeRuntime, LlmRuntime (KiroCliRuntime: agent-pipeline spec)
store/     SQLite (better-sqlite3): events, artifacts, approvals; filesystem: data/runs/
config/    agents.json, repos.json, limits.json (validated at startup)
```

No web framework: about eight routes do not justify one. `better-sqlite3` is used because it installs from prebuilt binaries on Windows (verified in the jt-habbo-hotel audit) and is synchronous, which keeps `seq` assignment trivially ordered.

## Schemas (in `@agentlife/shared`)

`events.ts` already exists from world-room (AgentEvent). This spec adds `engine-api.ts`:
- `Repo { id, name }` (public view; never expose `source` paths): reuses `RepoSchema` from protocol.ts
- The engine-side job view is exported as `EngineJobViewSchema` (the name `JobView` is already the client-facing view in protocol.ts)
- `StartJobBody { repoId, goal (1..300) }`, `ApprovalBody { decision, note? (..500) }`
- `JobView { taskId, repoId, goal, state, steps[], approvals[], artifacts[], verdict? }`
- `Plan { tasks: { id, title, why, files[], acceptance, risk: "low"|"medium"|"high" }[] (1..5) }`
- `Review { verdict: "pass"|"fail", notes: string[], risk }`
- `RunExport { version: 1, recordedAt, job: JobView, events: AgentEvent[], artifacts: { id, kind, content }[] }`

## Store

```sql
CREATE TABLE events   (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, task_id TEXT, agent_id TEXT, type TEXT, payload TEXT);
CREATE TABLE artifacts(id TEXT PRIMARY KEY, task_id TEXT, kind TEXT, title TEXT, path TEXT, created_at INTEGER);
CREATE TABLE approvals(id TEXT PRIMARY KEY, task_id TEXT, kind TEXT, status TEXT, decision TEXT, note TEXT, created_at INTEGER, resolved_at INTEGER);
```

- `appendEvent(ev)` is the only write path for state; JobView is a pure fold over events (`foldJob(events)`), cached in memory and rebuilt on startup.
- Artifact contents live in `data/runs/<taskId>/` (plan.json, diff.patch, test_log.txt, review.json, report.md); DB rows point to them. Paths built with `node:path`.
- DB path: `data/engine.db` (env `ENGINE_DB`). Tests use `:memory:`.
- Fold conventions (jobs/fold.ts): steps are derived from `task.state_changed` (analyzing→analyze, developing→develop, testing→test, reviewing→review, report_ready→report); the QA verdict is the reason `verdict:pass|fail` on the transition into `report_ready` (`task.failed` also sets verdict fail). Requires `pnpm-workspace.yaml` `allowBuilds: better-sqlite3: true`.

## Event bus and SSE

- In-process `EventBus` (EventEmitter) fed by `appendEvent`.
- SSE handler: write headers, replay `SELECT … WHERE seq > ?` in order, then subscribe; subscription is registered **before** the replay query and buffered, dropping any event with `seq <=` last replayed seq. This prevents gaps between replay and live.
- Each SSE message: `id: <seq>`, `event: agent`, `data: <json>`. Heartbeat comment every 15 s.

## Job state machine

```ts
const TRANSITIONS = {
  created:                 ["analyzing", "failed", "cancelled"],  // failed: restart recovery
  analyzing:               ["awaiting_plan_approval", "failed", "cancelled"],
  awaiting_plan_approval:  ["developing", "failed", "cancelled"], // reject => cancelled; failed: restart recovery
  developing:              ["testing", "failed", "cancelled"],
  testing:                 ["reviewing", "failed", "cancelled"],
  reviewing:               ["report_ready", "developing", "failed", "cancelled"], // failed: review timeout/error
  report_ready:            ["delivered"],
  failed:                  ["report_ready"],                     // failure still produces a report
  delivered: [], cancelled: [],
} as const;
```

`JobRunner` is an async function per job that awaits each step, records events, and checks `signal.aborted` between steps. Steps are injected (`Steps` interface: `analyze, develop, test, review, report`), so this spec wires them to FakeRuntime and agent-pipeline replaces them with real ones. The runner emits the visual events too: `agent.goto` (anchor), `agent.state_changed`, ambient `agent.say` from LlmRuntime.

Visual script per step (anchors only):
- analyze: architect → `board`, state `thinking`
- awaiting approval: architect → `mailbox`, state `waiting_approval`; others `idle`
- develop: developer → `desk`, state `working`
- test: qa → `computer`, state `working`
- review: qa → `desk` (developer's), state `thinking`
- report: architect → `mailbox`, state `done`

Runner conventions (jobs/runner.ts, accepted in S7):
- `Steps` (jobs/steps.ts) return data; the runner persists artifacts (plan.json, diff.patch, test_log.txt, review.json, report.md) and emits all events. Test failure is a result, not an error: the review still runs, and the effective verdict is `fail` if tests failed or QA said fail.
- A step error or timeout records `task.state_changed → failed` (reason `timeout:<step>` or the error message), `task.failed`, then `failed → report_ready` (reason `verdict:fail`), `report.ready`, `delivered`, `task.completed`. A cancel records `cancelled` only (no report). `report_ready` and `failed` are not cancellable (409).
- Plan rejection goes to `cancelled` (reason `Plan rejected`) after `approval.resolved`. Cancelling while an approval is pending first emits `approval.resolved reject`.
- Restart recovery: every non-terminal job gets `failed` (`engine_restarted`) unless already `failed`/`report_ready`, then the failure report and `delivered`; if `report.ready` was already emitted, the job is just delivered.
- Per-step usage (credits/tokens) is not an event: runtime events are written to `data/runs/<taskId>/<step>.jsonl` with the step ordinal `n`, and the export sums them per step record.
- Secret redaction is applied centrally in the Store (events, artifacts, run logs) and in the logger.

## Runtimes

```ts
interface RuntimeInput { role: Role; prompt: string; cwd: string; timeoutMs: number; signal: AbortSignal }
type RuntimeEvent = { kind: "progress"; text: string } | { kind: "output"; text: string } | { kind: "usage"; credits?: number; tokens?: number }
interface AgentRuntime { readonly id: string; run(i: RuntimeInput): AsyncIterable<RuntimeEvent> }
```

- `FakeRuntime`: deterministic outputs keyed by role, configurable delay; used by tests.
- `LlmRuntime`: `fetch(LLM_BASE_URL + "/chat/completions")`, `AbortSignal.any([signal, AbortSignal.timeout(5000)])`, max 60 tokens, output screened (length ≤ 120 chars, no URLs) before becoming `agent.say`.
- Process-tree kill helper for later runtimes: `killTree(pid)` → `taskkill /pid <pid> /T /F` on win32, `process.kill(-pid)` with detached process group elsewhere.

## Config

- `config/agents.json`: `{ architect: { runtime: "fake"|"kiro-cli", agent?: string, model?: string }, developer: …, qa: …, ambient: { runtime: "llm"|"none" } }`
- `config/repos.json`: `[{ id, name, source, testCommand }]`
- `config/limits.json`: step timeouts, max diff lines, max files changed.

## Error handling

- Unexpected exceptions inside a step → `task.failed { reason }`, then a failure report.
- On startup, recover: fold all events; any non-terminal job → `failed: engine_restarted` → `report_ready`.

## Testing strategy

- Transition table and JobRunner with fast-check (requirement 3.6) using FakeRuntime and random outcomes.
- SSE: start the server on an ephemeral port, append events while a client reconnects with `since`, assert no gaps/duplicates.
- Fold equivalence: random event sequences → `foldJob` equals incremental view.
- Secret redaction test (7.4).
