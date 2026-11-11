# Requirements Document

## Introduction

The hotel works while you sleep. The user schedules jobs for the night on any project (review today's commits, audit dependencies, improve tests). The night shift runs them one after another inside a time and credit-friendly budget, and in the morning the user finds a summary in the lobby mailbox and on Discord, with branches ready to review. Kiroween theme: at night the hotel's lights dim and the ghosts work by candlelight.

Depends on project-registry, job-types and hotel-floors. All user-facing text in English.

## Requirements

### Requirement 1: Schedule

#### Acceptance Criteria
1. A night board in the lobby SHALL let the user add, reorder and remove night jobs: project, kind (from job-types, plus `audit-deps`), input, and model tier (cheap / normal).
2. Night jobs SHALL be stored in `data/night.json` and survive restarts.
3. THE night window SHALL be configurable (default 01:00–07:00 local time) with a maximum number of jobs per night (default 4) and a maximum wall time per job (default 20 min).

### Requirement 2: Approval policy at night

#### Acceptance Criteria
1. Night jobs that would normally wait for approval SHALL use a pre-approval the user gives when scheduling ("Approve the plan automatically if it only touches: <kind's allowed paths>").
2. IF the Architect's plan touches anything outside the pre-approved scope, THEN the job SHALL stop at approval and be reported as "waiting for you" in the morning summary; nothing is developed.
3. Night jobs SHALL never deliver branches automatically unless the user enabled "deliver as branch" for that job when scheduling; they never push or merge.

### Requirement 3: Runner

#### Acceptance Criteria
1. A scheduler in the engine SHALL start night jobs inside the window, one at a time, respecting the per-night and per-job limits, and skip the rest with a reason.
2. THE scheduler SHALL not start if a daytime job is running, and SHALL stop starting new jobs when the window ends.
3. `audit-deps` (read-only): runs `npm outdated --json` and `npm audit --json` inside the sandbox image with network allowed only to the npm registry (or, if that cannot be restricted, with `--offline` against the image's cache and a note that results may be stale); the report lists outdated and vulnerable packages.

### Requirement 4: Morning summary

#### Acceptance Criteria
1. At the end of the window THE engine SHALL write a morning summary: per job, result, branch delivered, time, and items waiting for the user; it SHALL appear in the lobby mailbox.
2. THE summary SHALL be sent to Discord with `pnpm notify` (free; Ollama writes a 3-sentence overview, numbers computed by code), only if the user enabled it.

### Requirement 5: Night look

#### Acceptance Criteria
1. Inside the window the client SHALL dim the rooms, light candles on working desks and show a moon clock in the HUD; reduced-motion respected.

### Requirement 6: Tests

#### Acceptance Criteria
1. Scheduler with a fake clock: window boundaries, limits, daytime job blocks start, skipped jobs reported.
2. Pre-approval: in-scope plan approved, out-of-scope plan stops at approval.
3. Summary content and the Discord call (mocked) only when enabled.
