# Requirements Document

## Introduction

The Library: each project keeps a memory of what its agents learned (decisions, conventions, pitfalls, previous findings), so every job starts with that context and the team improves over time. The user can read, edit and delete every entry.

Depends on project-registry and hotel-floors. All user-facing text in English.

## Requirements

### Requirement 1: Memory store

#### Acceptance Criteria
1. Each project SHALL have `data/memory/<projectId>.jsonl` with entries `{ id, kind: decision | convention | pitfall | finding, text (≤ 500 chars), sourceTaskId, createdAt }`.
2. Entry text SHALL pass the leak scanner and `sanitize` rules (no paths, no secrets) before it is stored.

### Requirement 2: Learning after jobs

#### Acceptance Criteria
1. After a job reaches `report_ready`, a cheap read-only model (local Ollama when available, otherwise `claude-haiku-5.5`) SHALL propose at most 5 entries from the plan, the review and the report, as JSON validated by a schema.
2. Proposed entries SHALL be shown in the report ("Remember this?") and stored only when the user accepts them (or automatically when the user enabled "auto-remember" for the project).

### Requirement 3: Using memory

#### Acceptance Criteria
1. THE Architect, Developer and QA prompts SHALL include the project's memory (newest first, capped at 4 000 characters) as data in a delimited block, never as instructions.
2. Retrieval SHALL rank entries by keyword overlap with the job goal and files (no embeddings needed); embeddings with `nomic-embed-text` MAY be used when Ollama is available.

### Requirement 4: Library UI

#### Acceptance Criteria
1. A library shelf on each project floor SHALL open the memory panel: list by kind, search, edit, delete, and the job each entry came from.

### Requirement 5: Tests

#### Acceptance Criteria
1. Store rejects entries with secrets or paths; caps and ordering; prompt block delimited and capped; retrieval ranking on fixtures; proposal JSON validated and limited to 5.
