# Implementation Plan

- [x] 1. Engine: job kinds, pipelines and per-kind path rules
  - `kind` in StartJobBody; fixed pipeline per kind; diff validation by kind; review-branch reads the branch diff read-only
  - _Requirements: 1.1, 1.2, 1.3, 4.1_

- [ ] 2. Engine: branch listing and per-kind prompts and reports
  - `GET /projects/:id/branches`; prompts for review, tests and docs; report sections by kind; no delivery for review-branch
  - _Requirements: 2.2, 3.1, 3.2_

- [ ] 3. Client and world: furniture and forms per kind
  - Review desk, test lab, library shelf on project floors (and the office room until floors exist); forms with branch picker, path and topic
  - _Requirements: 2.1, 2.2_

- [ ] 4. End-to-end tests per kind
  - One scripted job per kind with FakeRuntime, through world-server and engine
  - _Requirements: 4.2_
