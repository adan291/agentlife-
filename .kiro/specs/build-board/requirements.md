# Requirements Document

## Introduction

The user wants to see the work that builds AGENT LIFE inside AGENT LIFE: the TASKMAP rows, each spec's tasks, what the conductor is doing and what waits for the user. build-board adds a construction board in the lobby next to the Builder ghost. Read-only, no credits.

Depends on hotel-floors (lobby) and build-crew (Builder). All user-facing text in English.

## Requirements

### Requirement 1: Data from the repository

#### Acceptance Criteria
1. THE engine SHALL expose `GET /build/board` returning, validated by `BuildBoardSchema` in `@agentlife/shared`: the TASKMAP rows (number, spec, sessions, live, status, purpose), for each spec its tasks (number, title, done) and done/total counts, the last 10 lines of `data/sessions/log.md` (session, date, model, minutes, status), and for each spec the latest verifier verdict (`PASS`/`FAIL`/none) read from the first line of `docs/reviews/feat-<spec>-verify.md`.
2. THE engine SHALL read only these files inside the AGENT LIFE repository (`docs/TASKMAP.md`, `.kiro/specs/*/tasks.md`, `data/sessions/log.md`, `docs/reviews/*-verify.md`), with paths built from a fixed list and spec names matching `^[a-z0-9-]+$`; nothing from user projects.
3. Missing or malformed files SHALL produce empty sections, never an error.

### Requirement 2: Conductor phase

#### Acceptance Criteria
1. THE conductor SHALL report its phase to the engine (`POST /crew/events` with a new kind `phase`: `session <id>`, `review`, `verify`, `fix <n>`, `merge`, `stopped: <reason>`, `done`), best effort like the session runner.
2. THE board SHALL show the current phase and spec, and the Builder SHALL say the phase in a bubble.

### Requirement 3: Board in the lobby

#### Acceptance Criteria
1. THE lobby SHALL have a construction board (interactive furniture, hint "What is being built and what waits for you").
2. ITS panel SHALL list the TASKMAP rows in order with a status chip (todo, running, verifying, merged, waits for you, skipped), a progress bar of done/total tasks, and expandable task lists; the running row SHALL be highlighted; rows that wait for the user SHALL be at the top with the reason.
3. THE panel SHALL refresh when crew or phase events arrive and at most every 10 s otherwise.
4. THE verdict chip SHALL link to the verify report rendered as Markdown (safe renderer).

### Requirement 4: Tests

#### Acceptance Criteria
1. Parsing of TASKMAP rows, tasks.md checkboxes, the session log and verify first lines on fixtures, including malformed input; spec name validation rejects path tricks.
2. Phase events mapped to board state and Builder bubbles.
