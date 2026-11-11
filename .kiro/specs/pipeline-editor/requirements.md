# Requirements Document

## Introduction

Each project can choose which team members take part in a job and in which order, from the board on its floor. The engine keeps the safety rules that cannot be broken. Depends on hr-desk (roles `reviewer`, `researcher`) and hotel-floors.

## Requirements

### Requirement 1: Pipeline definition

#### Acceptance Criteria
1. A pipeline SHALL be an ordered list of steps, each `{ kind, memberId? }` with kinds `research`, `plan`, `approve`, `develop`, `test`, `review`, `second-review`, `report`; stored per project in `data/pipelines.json`; the default equals today's flow.
2. THE engine SHALL validate every pipeline and reject it with a reason unless: it starts with `plan` (optionally preceded by `research`), `approve` comes after `plan` and before `develop`, `test` comes after `develop`, every `review` comes after `test`, it ends with `report`, and each step's member has the role the step needs.
3. THE state machine SHALL be generated from the validated pipeline; a property test SHALL check that for any valid pipeline no run reaches `develop` without an approval and no review runs before tests.

### Requirement 2: Board editor

#### Acceptance Criteria
1. THE board panel SHALL show the pipeline as a row of cards (step, member ghost, model) that the user can add, remove and reorder by drag and drop or with buttons; invalid positions SHALL be shown in red with the rule that blocks them, and Save SHALL be disabled until valid.
2. Changes SHALL apply to the next job; a running job keeps its pipeline.

### Requirement 3: Optional steps

#### Acceptance Criteria
1. `research`: a read-only researcher reads the repository and writes notes the Architect receives in its prompt.
2. `second-review`: a second reviewer with a different model (for example Codex when available, otherwise another Kiro model) reviews independently; the report shows both verdicts and the job fails if either fails.
