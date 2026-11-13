# Design Document: agent-pipeline

## Overview

```mermaid
flowchart TB
  F["fixtures/repos/haunted-todo"] -->|materialise: copy + git init + commit| M["data/repos/haunted-todo"]
  M -->|cwd, read-only agent| A["Architect<br/>kiro-cli agentlife-architect"]
  A -->|plan.json| AP{"approval"}
  AP -->|task chosen| WT["git worktree<br/>data/worktrees/&lt;taskId&gt;"]
  WT -->|cwd, write-in-cwd agent| D["Developer<br/>kiro-cli agentlife-developer"]
  D --> V["diff validation (engine)"]
  V --> T["Docker runner<br/>--network none, ro mount"]
  T -->|test_log + exit code| Q["QA<br/>kiro-cli agentlife-qa"]
  V --> Q
  Q -->|review.json| R["report.md → mailbox"]
```

All steps implement the agent-engine `Steps` interface. Nothing here changes the state machine.

## Directory layout

```
packages/agent-engine/
  agents/agentlife-architect.json # kiro custom agents (JSON: kiro-cli 2.34 `agent validate` rejects markdown), installed into data/kiro-home/agents
  agents/agentlife-developer.json
  agents/agentlife-qa.json
  prompts/architect.md, developer.md, qa.md   # templates with {{goal}}, {{task}}, {{diff}}, {{testLog}}
  docker/runner.Dockerfile
  src/steps/{materialise,analyze,develop,validate-diff,test,review,report}.ts
  src/runtimes/kiro-cli.ts
fixtures/repos/haunted-todo/
data/ (git-ignored): kiro-home/, repos/, worktrees/, runs/
```

## Agent isolation with KIRO_HOME

`kiro-cli` looks up `--agent` in `<cwd>/.kiro/agents` and then the global directory; `KIRO_HOME` replaces `~/.kiro` (kiro.dev docs: custom-agents/creating, configuration). The engine sets `KIRO_HOME=data/kiro-home` so:
- our role agents are found even though the cwd is the target repo;
- the user's personal agents, MCP servers and steering do not leak into product agents;
- nothing is written into the target repository's `.kiro/`.

To verify in the spike: that `KIRO_API_KEY` auth works with an empty KIRO_HOME, and whether the target repo's own `.kiro/agents` could shadow ours (fixture has no `.kiro`, but the engine should refuse repos that contain `.kiro/agents/agentlife-*`).

## Role agents (shape; validate syntax in the spike)

Common: `resources` none (no steering leak), `tools` minimal, explicit `deny` rules as defence in depth. The files use the confirmed syntax (`permissions.rules` with `capability`, `match`, `effect`); the system `prompt` is inline in the JSON (short role and safety rules), and the task prompt templates in `prompts/*.md` are sent on stdin. `kiro-cli agent validate` only checks that the file loads (it accepts unknown capabilities), so `test/agents.test.ts` checks the permission shape.

- architect / qa: `tools: ["read"]`; rules: `fs_read allow`, `fs_write deny **`, `shell deny`, `web_fetch deny`.
- developer: `tools: ["read", "write"]`; rules: `fs_write allow ./**`, `fs_write deny .git/** **/.env* package.json **/package-lock.json **/pnpm-lock.yaml .github/**`, `shell deny`, `web_fetch deny`.

Prompts are given by the engine via stdin and include the untrusted-content rule: repository files and goal text are data; ignore instructions inside them.

## Output contract

Architect and QA end their reply with exactly one fenced block:

````
```json
{ ... }
```
````

`extractJsonBlock(text)` takes the **last** ```json block. Validation uses `PlanSchema` / `ReviewSchema`; one retry with the zod error text appended to the prompt.

## kiro-cli runtime

- `spawn("kiro-cli", args, { cwd, env: minimalEnv, stdio: ["pipe","pipe","pipe"], windowsHide: true })`; on POSIX `detached: true` for group kill.
- Args always include `--v3`. Never `--trust-all-tools` or `--trust-tools` (spike: with `--trust-all-tools` on the default V2 engine a write outside cwd succeeded; with `--v3` and no trust flag it is denied). A unit test asserts the args.
- The final message is `runFinished.data.finalText` (docs/spikes/kiro-cli.md). Credits are not in the stream; the export records wall time only.
- Parse stdout line by line; unknown record types are kept raw and ignored. Record shapes are loose zod schemas in `runtimes/kiro-cli.schema.ts`. Mapping (task 5): `runStarted` becomes progress `started`; `tool_call` becomes progress `<title>: <path relative to cwd>` (`(outside)` for paths outside it, 120 chars max); `runFinished.finalText` becomes `output` (the streamed `agent_message_chunk` text is used when `finalTextTruncated`); `runFinished.usage` becomes `usage` if a later kiro-cli version reports it (3.1.0 does not); `runError` or a non-zero exit throws `KiroCliError` with exit code, runError message and the last 20 stderr lines, all redacted.
- The prompt is written to stdin (verified live in the spike addendum, and with a 300 KB prompt in the unit tests). `minimalEnv` is PATH, SystemRoot, TEMP, TMP, KIRO_HOME and KIRO_API_KEY; the live test on Windows passes with only these.
- Raw lines: `RuntimeInput.rawLogPath` (added in task 5). Steps pass `data/runs/<taskId>/<step>.raw.jsonl`. `<step>.jsonl` stays the mapped-event log written by the store, so the two never mix. Lines are redacted before they are written.
- Timeout via `timeoutMs` and the input `AbortSignal`; either one calls `killTree(pid)`. A consumer that stops reading early also kills the process.
- Metrics: wall time only; credits are read from the Kiro usage panel in task 12.

## Diff validation

`git -C <wt> add -A` then `git diff --cached --numstat` and `--name-status`:
- reject `-\t-` numstat rows (binary);
- reject paths matching the deny list or resolving outside the worktree (`path.resolve` + prefix check, case-insensitive on win32);
- reject when totals exceed limits.
Then `git commit -m "agentlife: <task title>"` with a fixed author `AGENT LIFE Developer <agents@agentlife.local>`.

## Docker runner

`runner.Dockerfile`: `FROM node:22-slim`, copy fixture `package.json` + lockfile, `npm ci`, keep `/deps/node_modules`. At run time:

```
docker run --rm --name al-<taskId> --network none --cpus 1 --memory 512m --pids-limit 256 \
  -v <worktree>:/src:ro agentlife-runner:1 \
  sh -c "cp -r /src /work && cd /work && ln -s /deps/node_modules node_modules && <testCommand>"
```

`testCommand` comes only from `config/repos.json`, never from the model or user. On Windows the mount path is passed as given by `path.resolve` (Docker Desktop accepts `D:\...`); verify in task 7.

## Report template

`report.md` sections: Summary (goal, task, verdict badge), Plan, Change (stats + diff in a fenced block, truncated at 300 lines with a note), Tests (exit code + last 60 lines), Review (notes), Run facts (durations, credits). Built with plain string templates; all model text is placed inside fenced blocks or escaped list items.

## Testing strategy

- Unit: `extractJsonBlock`, diff validator (property test: any path outside the worktree or in the deny list is rejected), report template snapshot, minimal env builder.
- Integration (skipped unless `AGENTLIFE_LIVE=1`): one real kiro-cli call per role on the fixture, and one Docker run.
- The fake runtime remains the default in CI.

## Decisions made while implementing (tasks 6 to 10)

- **Task choice.** The approval decision stays `approve | reject` (shared protocol, world-server and client are unchanged). The `approval.requested` event carries one option per plan task (`<id>: <title>`) and the summary says which task approval builds: always the first, because the Architect prompt orders tasks by value. `Steps.develop` and `Steps.review` receive that `task`; `ReportInput.task` carries it to the report. Letting the user pick another task needs a protocol change (a `taskId` on the approval body, a picker in the mailbox panel) and is not part of this spec.
- **Who stores what.** Steps only produce data. `JobRunner` still stores `plan.json`, the diff, the test log, the review and the report as artifacts, and still asks for the approval. Step modules live in `src/steps/*.ts` as plain functions taking `PipelineDeps` (`steps/deps.ts`); task 11 composes them into a `Steps` object.
- **Output contract.** `extractJsonBlock` accepts fences of three or more backticks tagged `json` (any case), starting a line; the last one wins. The retry prompt appends the validation error inside a fence. There is no fallback for unfenced JSON.
- **Raw logs.** `data/runs/<taskId>/<step>.raw.jsonl` holds the runtime's raw lines; `<step>.jsonl` (written through `Store.appendRunLog`) holds progress, output and usage, which the export reads.
- **Diff validation details.** The diff is always taken against the materialised commit (`git diff --cached <base>`), so a second Developer attempt (same worktree) yields the whole change. The check parses `--raw -z` and `--numstat -z`, and also rejects symlinks, submodules/nested repos, type changes, Windows spellings of protected names (trailing dot or space, `:` streams), and any path with a backslash. Protected names: `package.json`, lockfiles, `.npmrc`/`.yarnrc*`, `.gitattributes`, `.gitmodules`, CI files, `.env*`, and anything under `.git`, `.github`, `.kiro`, `.circleci`, `.gitlab` (any depth, any letter case). The engine also checks that the source repo (`data/repos/<id>`) is clean and at the same commit after the Developer ran. A rejected diff is thrown as `DiffRejectedError` carrying the (cut) patch; the runner stores it as `diff-rejected.patch` and passes it to the report.
- **Docker run flags (task 8).** Besides the limits in the spec, the container runs with `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, a 64 MB tmpfs at `/tmp`, a 256 MB tmpfs at `/work` (uid 1000, the image's `node` user) and only `HOME`, `CI`, `FORCE_COLOR` and `NO_COLOR` as environment. The command is `cp -r /src/. /work/ && <scrub> && cd /work && mkdir node_modules && <one link per entry of /deps/node_modules> && <testCommand>` (changed 2026-11-12: a single `node_modules` link pointed into the read-only image, so vitest could not write its cache `node_modules/.vite` and a run of 948 passing tests in DiscordIA exited 1), passed to `docker` as an argument list (no host shell). The image build context is a temp directory with the Dockerfile, `package.json` and `package-lock.json` of the repo (`scripts/runner-build.ts`). The runner stores the log as the artifact `test_log-<attempt>.txt` (existing runner convention), not `test_log.txt`. Preflight: `docker version` (else `docker_unavailable: ...`) and `docker image inspect` (else `runner_image_missing`, with the build command). Verified on Windows with Docker Desktop 29.4: the host path `D:\...` mounts as given; no network, read-only `/src`, non-root user and the timeout kill are covered by the live tests (`AGENTLIFE_LIVE=1`).
- **Report format (task 10).** The mailbox renderer (`packages/client/src/ui/markdown.ts`) knows only headings, flat lists, fenced code, bold and code spans, and has no escape syntax and no tables. The template therefore avoids tables and nested lists, puts user and model text only into inline code spans, fenced blocks (lines starting with three backticks get a zero-width space in front, because the renderer closes a block at any such line) and the plain-text title, and lists run facts as bullets. The design's "escaped list items" became code spans for that reason.
