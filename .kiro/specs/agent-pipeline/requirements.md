# Requirements Document

## Introduction

The agent-pipeline replaces the fake steps of the agent-engine with real work: the Architect analyses a real repository, the Developer changes it in an isolated git worktree, the engine runs its tests in Docker, QA reviews, and a report is produced. Architect, Developer and QA run through `kiro-cli` headless with one custom agent per role. The target repository is a small fixture created for the project (`haunted-todo`).

Context: docs/agent-system-design.md, .kiro/steering/security.md. Depends on agent-engine (Steps interface, runtimes, store).

## Requirements

### Requirement 1: kiro-cli feasibility spike

**User Story:** As the developer, I want to verify kiro-cli headless behaviour before building on it, so that the main technical risk is retired early.

#### Acceptance Criteria
1. THE spike SHALL confirm and document in `docs/spikes/kiro-cli.md`: authentication with `KIRO_API_KEY`, agent lookup with `KIRO_HOME` pointing to a project directory, the `--output-format stream-json` record shapes (progress, final text, usage), exit codes, and duration.
2. THE spike SHALL verify that a Developer-style agent with `fs_write` allowed only inside the cwd cannot write a file outside it, and that `shell` denied blocks commands.
3. THE spike SHALL measure the credits consumed by one small analyse run and one small edit run.
4. IF any of 1.1–1.2 fails, THEN the developer SHALL stop and record an alternative in docs/risks-and-decisions.md before continuing.

### Requirement 2: Fixture repository

**User Story:** As a user, I want a small, safe repository to work on, so that the demo is repeatable.

#### Acceptance Criteria
1. THE project SHALL contain `fixtures/repos/haunted-todo/`: a TypeScript module (3–4 functions), Vitest tests, and 3 seeded issues (one bug with a failing-but-skipped test, one untested function, one missing input validation), plus a short README.
2. WHEN a job starts, THE engine SHALL materialise the fixture into `data/repos/haunted-todo/` as a fresh git repository with one commit, so each job starts from the same state.

### Requirement 3: KiroCliRuntime

**User Story:** As the engine, I want to run kiro-cli agents as child processes, so that roles do real work with enforced permissions.

#### Acceptance Criteria
1. THE runtime SHALL spawn `kiro-cli chat --v3 --no-interactive --agent <name> --output-format stream-json` with the prompt on stdin, `cwd` set to the step's directory, and `KIRO_HOME` set to `data/kiro-home`.
2. THE engine SHALL install the role agents from `packages/agent-engine/agents/*.json` into `data/kiro-home/agents/` at startup.
3. THE runtime SHALL map stream-json records to `RuntimeEvent` (progress, output, usage) and keep the raw lines in `data/runs/<taskId>/<step>.jsonl`.
4. WHEN the step is aborted or times out, THE runtime SHALL kill the process tree.
5. IF kiro-cli exits non-zero, THEN the step SHALL fail with the exit code and the last 20 lines of stderr (secrets redacted).
6. THE environment passed to kiro-cli SHALL contain only what it needs (PATH, SystemRoot on Windows, KIRO_HOME, KIRO_API_KEY, TEMP/TMP).

### Requirement 4: Architect step

**User Story:** As a user, I want a concrete plan from the Architect, so that I can choose what gets built.

#### Acceptance Criteria
1. THE Architect agent SHALL be read-only (no write, no shell, no web).
2. THE Architect SHALL run on a read-only snapshot (the materialised repo) and return a plan as a fenced JSON block in its final message.
3. THE engine SHALL extract and validate the plan with `PlanSchema`; IF invalid, THEN it SHALL retry once with the validation error appended; a second failure SHALL fail the step.
4. WHEN the plan is valid, THE engine SHALL store `plan.json` and request approval with one option per plan task.

### Requirement 5: Developer step

**User Story:** As a user, I want the approved task implemented in isolation, so that nothing outside the job is touched.

#### Acceptance Criteria
1. THE engine SHALL create a git worktree `data/worktrees/<taskId>` on branch `agentlife/<taskId>` from the materialised repo.
2. THE Developer agent SHALL be allowed to write only inside its cwd and SHALL have shell and web denied; `.git/**`, `**/.env*` and `package.json` SHALL be denied for writing.
3. AFTER the Developer finishes, THE engine SHALL compute the diff with git and validate it: only paths inside the worktree, no binary files, no changes to `package.json`, lockfiles or CI files, at most `maxDiffLines` (default 400) and `maxFiles` (default 10).
4. IF the diff is empty or invalid, THEN the step SHALL fail with the reason and the diff SHALL be stored for the report.
5. ON success THE engine SHALL store `diff.patch` and commit it on the job branch.

### Requirement 6: Test step

**User Story:** As a user, I want tests run in a sandbox, so that results are real and the host stays safe.

#### Acceptance Criteria
1. THE engine SHALL run tests with `docker run --rm --network none --cpus 1 --memory 512m --pids-limit 256` using image `agentlife-runner:1`, with the worktree mounted read-only and copied to a writable temp dir inside the container before running the repo's `testCommand`.
2. THE runner image SHALL be built from `packages/agent-engine/docker/runner.Dockerfile` with the fixture's dependencies preinstalled, so no network is needed.
3. THE step SHALL time out per limits and kill the container (`docker kill`).
4. THE engine SHALL store `test_log.txt` (truncated to 200 KB) and the exit code.
5. IF Docker is not available, THEN the step SHALL fail with reason `docker_unavailable`.

### Requirement 7: QA step

**User Story:** As a user, I want an independent review, so that I know whether to trust the change.

#### Acceptance Criteria
1. THE QA agent SHALL be read-only and receive the task, the diff and the test log.
2. THE QA SHALL return a review as a fenced JSON block validated by `ReviewSchema`, with the same retry rule as 4.3.
3. IF the tests failed, THEN the verdict SHALL be `fail` regardless of the model output.

### Requirement 8: Report

**User Story:** As a user, I want one readable report in the mailbox, so that I can decide what to do with the change.

#### Acceptance Criteria
1. THE engine SHALL build `report.md` from a template: goal, chosen task, plan summary, diff stats and the diff, test result, QA verdict and notes, durations and credits per step.
2. THE report SHALL be emitted as `report.ready` and stored as an artifact, also for failed jobs (with the failure reason).

### Requirement 9: World integration and live run

**User Story:** As a user, I want to watch the real pipeline in the room, so that the demo shows real work.

#### Acceptance Criteria
1. WITH `ENGINE=http` and `config/agents.json` set to `kiro-cli`, a job started from the computer SHALL run end to end with only the plan approval as manual input.
2. THREE consecutive live runs SHALL complete without manual intervention other than approval; results are recorded in docs/STATUS.md.
