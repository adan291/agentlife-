# Requirements Document

## Introduction

Today every job is "plan and change code". Real work with agents also means: review my branch before I merge it, write tests for a module, and document or investigate. job-types adds these as job kinds, each started from its own piece of furniture on a project floor, each with a fixed pipeline that keeps the safety rules.

Depends on project-registry and hotel-floors. All user-facing text in English.

## Requirements

### Requirement 1: Job kinds

#### Acceptance Criteria
1. `StartJobBody` SHALL take `kind`: `change` (today's flow), `review-branch`, `write-tests`, `document`; default `change`.
2. Each kind SHALL map to a fixed pipeline validated by the engine:
   - `change`: plan → approve → develop → test → review → report (unchanged).
   - `review-branch`: input is a branch name of the project; review (read-only) of `git diff <default>...<branch>` → test of that branch → report. No approval step (nothing is written).
   - `write-tests`: input is a path or module; plan (tests only) → approve → develop restricted to test files (`**/*.test.*`, `**/*.spec.*`, `test/**`, `tests/**`, `__tests__/**`) → test → review → report.
   - `document`: input is a topic or path; research (read-only) → approve → develop restricted to `docs/**` and `*.md` → review → report.
3. THE diff validation SHALL reject any file outside the kind's allowed paths, with the rule in the report.

### Requirement 2: Furniture per kind

#### Acceptance Criteria
1. Project floors SHALL have: the computer (`change`), a review desk (`review-branch`), a test lab (`write-tests`) and a library shelf (`document`), each with a hint and its own form (branch picker from the project's local branches, module path, topic).
2. The branch picker SHALL list only local branches of the registered project, read by the engine (`git for-each-ref refs/heads`), never typed free text.

### Requirement 3: Reports per kind

#### Acceptance Criteria
1. The report SHALL show the kind and adapt its sections: `review-branch` shows findings by severity and a verdict "ready to merge / changes requested"; `write-tests` shows tests added and coverage of the target when available; `document` shows the files written.
2. `review-branch` results SHALL not offer "Deliver as branch" (nothing was changed).

### Requirement 4: Tests

#### Acceptance Criteria
1. Pipeline per kind validated; path restrictions per kind (property test with random paths); branch picker rejects names not in the project.
2. One scripted end-to-end job per kind with FakeRuntime.
