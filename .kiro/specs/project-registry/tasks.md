# Implementation Plan

- [x] 1. Shared leak scanner and project schemas
  - Move the scanning core of scripts/security-scan.ts to `packages/shared/src/leaks.ts` (the script keeps working); `projects.ts` schemas and `delivery.done` event
  - _Requirements: 1.1, 1.4, 5.4_

- [x] 2. Engine: allowed roots, inspection and registry
  - `projects/roots.ts`, `inspect.ts`, `registry.ts`; routes `GET/POST/DELETE /projects`; built-in fixture merged; paths kept inside the engine
  - Tests: path property test, temporary-repo registration cases, path never in responses
  - _Requirements: 1.1–1.8, 2.1, 2.2, 7.1, 7.2_

- [ ] 3. Engine: jobs on registered projects
  - Clone-based materialise, report "Based on commit", per-project runner images, test step skipped for unsupported stacks, QA prompt note, extended secret-file deny rules for the three role agents
  - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_

- [ ] 4. Engine: delivery as a branch
  - `projects/deliver.ts`, `POST /tasks/:id/deliver`, `delivery.done`; tests that the project's HEAD, index and files are unchanged and an existing branch is refused
  - _Requirements: 5.1–5.5, 7.3_

- [ ] 5. World-server and client: Reception desk, project list, delivery button
  - Reception furniture and panel (register with confirmation of findings, remove with confirmation), computer panel lists projects, Report viewer "Deliver as branch"
  - _Requirements: 3.1, 6.1, 6.2, 6.3, 5.1_

- [ ] 6. Live check
  - Register a small real project under D:\AgentHotel, run one job, deliver; record in docs/STATUS.md
  - _Requirements: 7.4_
