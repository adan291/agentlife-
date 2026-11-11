# Requirements Document

## Introduction

AGENT LIFE becomes an "agent hotel": each of the user's real projects gets its own place in the hotel, with agents working on it. This first step adds a project registry (the Reception), runs jobs on registered projects instead of only the `haunted-todo` fixture, and delivers the result to the user's own repository as a branch.

Product rule for real projects: the hotel never changes the user's working copy, never merges and never pushes. The user decides what to do with the delivered branch.

Context: agent-engine and agent-pipeline specs (materialise, develop, test, review, report steps), security steering (`.kiro/steering/security.md`), docs/spikes/kiro-cli.md. Floors and the elevator come in the `hotel-floors` spec; until then the Reception desk stands in the current office. All user-facing text in English.

## Glossary
- **Project**: a git repository on the user's disk registered in the hotel.
- **Allowed roots**: the only directories where a project may live. Default `D:\AgentHotel`; configured in `config/hotel.json` and overridable with `AGENTLIFE_PROJECT_ROOTS` (`;`-separated).
- **Job clone**: the engine's private clone of a project at its current `HEAD`, in `data/repos/<projectId>`.

## Requirements

### Requirement 1: Register a project

**User Story:** As the user, I want to add one of my projects to the hotel, so that the agents can work on it.

#### Acceptance Criteria
1. THE engine SHALL expose `POST /projects` with `{ path, name, testCommand? }` (zod schema in `@agentlife/shared`) and `GET /projects`, `DELETE /projects/:id`.
2. WHEN registering, THE engine SHALL require that the resolved real path (symlinks and `..` resolved, case-insensitive on Windows) is inside an allowed root, is a git repository with at least one commit, and is not the AGENT LIFE repository itself.
3. THE engine SHALL reject projects over 20 000 tracked files or 200 MB of tracked content, with a message that says which limit was hit.
4. THE engine SHALL run the leak scanner over the project's tracked files; IF it finds high or medium findings, THEN registration SHALL fail with the masked findings unless the request repeats with `acceptFindings: true`, and the acceptance SHALL be stored with the project.
5. THE engine SHALL detect the stack: `node-npm` when `package.json` and `package-lock.json` exist; otherwise `unsupported-tests`. The default `testCommand` for `node-npm` is `npm test`; for `unsupported-tests` it is empty and the test step is skipped (Requirement 4.3).
6. Projects SHALL be stored in `data/projects.json` (git-ignored, because it holds local paths) with `id` (slug from the name, unique), `name`, `path`, `stack`, `testCommand`, `registeredAt`, `acceptedFindings`.
7. `DELETE /projects/:id` SHALL only unregister the project and remove the engine's job clone; it SHALL never touch the user's repository.
8. `haunted-todo` SHALL stay available as a built-in project that cannot be deleted.

### Requirement 2: Paths never leave the engine

#### Acceptance Criteria
1. `GET /projects`, events, exports, reports and every message to the world-server SHALL show projects by `id` and `name` only; the absolute path SHALL appear only in `data/projects.json` and engine logs.
2. A test SHALL assert that a registered project's absolute path never appears in the export, the report or the client messages of a job.

### Requirement 3: Jobs on a registered project

**User Story:** As the user, I want to start a job on any registered project.

#### Acceptance Criteria
1. THE computer panel SHALL list registered projects (name, stack) instead of only the fixture; the job request uses the project id.
2. THE materialise step SHALL create the job clone with `git clone --no-hardlinks --single-branch` of the project's current branch at `HEAD` into `data/repos/<projectId>` (replacing a previous clone), refusing symlinks and reserved agent files as today.
3. Uncommitted changes in the user's working copy SHALL be ignored (only committed `HEAD` is used) and THE report SHALL say "Based on commit <short sha> of <branch>".

### Requirement 4: Agent and test safety on real code

#### Acceptance Criteria
1. Architect, Developer and QA agents SHALL be denied reading secret-looking files in the clone: `.env*` (except `.env.example`), `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*.p12`, `*.pfx`, `credentials*`, `secrets*`, `.npmrc`, `.aws/**`, `.ssh/**`, `.git/**`.
2. THE engine SHALL build one test image per `node-npm` project (`agentlife-runner-<projectId>:<lockfile hash>`) from only its `package.json` and `package-lock.json`, with `npm ci --ignore-scripts`, and reuse it while the lockfile is unchanged.
3. FOR `unsupported-tests` projects, THE test step SHALL be skipped with the result "not run (no supported test setup)", QA SHALL be told so in its prompt, and the verdict can be at most "pass without tests" (shown in the report).
4. Tests SHALL keep the existing sandbox flags (no network, read-only mount, limits).

### Requirement 5: Deliver the result to the user's repository

**User Story:** As the user, I want the finished change as a branch in my own repository, so that I can review and merge it myself.

#### Acceptance Criteria
1. WHEN a job of a registered project reaches `report_ready` with a committed diff, THE report SHALL offer "Deliver as branch" (a button in the Report viewer).
2. Delivering SHALL run `git -C <project> fetch <job clone> agentlife/<taskId>:agentlife/<taskId>`, which creates a branch without touching the working copy, the index or the current branch.
3. IF the branch already exists in the project, THEN delivery SHALL fail with a message and SHALL NOT overwrite it.
4. THE engine SHALL record `delivery.done { taskId, branch, commit }` and the report SHALL show the branch name and the command to look at it (`git log agentlife/<taskId>`).
5. Delivery SHALL never push, merge, rebase, check out or change the user's git config.

### Requirement 6: Reception desk

**User Story:** As the user, I want a place in the hotel to manage my projects.

#### Acceptance Criteria
1. THE office room SHALL get a Reception desk (interactive furniture, hint "Register and manage projects").
2. ITS panel SHALL list projects (name, stack, test command, registered date) and offer a form: folder path, name, test command (prefilled after detection), with clear errors for each validation rule and a confirmation step that shows masked scanner findings.
3. Removing a project SHALL ask for confirmation and state that the user's files are not touched.

### Requirement 7: Tests

#### Acceptance Criteria
1. Path validation property test: random paths with `..`, mixed case, trailing separators and symlinks never validate outside an allowed root.
2. Registration tests with temporary git repositories: not a repo, empty repo, outside root, too large, scanner finding with and without acceptance, AGENT LIFE itself.
3. Delivery tests: branch created without changing the project's HEAD, index or working files; existing branch refused.
4. A live check (manual, recorded in docs/STATUS.md): register a small real project under `D:\AgentHotel`, run one job, deliver the branch.
