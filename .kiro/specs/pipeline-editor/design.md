# Design Document: pipeline-editor

- `shared/src/pipeline.ts`: `PipelineSchema`, `validatePipeline(p, team) → { ok } | { ok: false, errors: { index, rule }[] }` (pure, used by both engine and client for live feedback).
- `agent-engine/src/jobs/pipeline-runner.ts`: builds the transition table from a validated pipeline (each step kind maps to an existing step function); the JobRunner takes the table instead of the fixed one. The fixed table stays as the default and as a test oracle.
- Research step: `steps/research.ts` (read-only member, output `research.md` artifact, injected into the plan prompt as data).
- Second review: `steps/review.ts` reused with another member; `Review` artifacts per reviewer; report section "Reviews".
- Client: `ui/pipeline-editor.ts` inside the board panel; drag and drop with pointer events plus Up/Down buttons for keyboard use.
