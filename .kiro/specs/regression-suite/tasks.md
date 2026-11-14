# Implementation Plan

- [ ] 1. Journeys and interface rules
  - Shared helpers (clean state, scratch files, layout and interface rules, console errors); the journeys of requirement 1 at the three sizes; fix real bugs they find and record each in design.md
  - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 4.3_

- [ ] 2. Visual comparisons
  - Frozen motion, time and seeds for screenshots; baselines per platform for rooms and panels at three sizes; `e2e:update-visuals`; report keeps the diff
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 3. Wiring and the manual list
  - Conductor runs the suite and e2e:demo before a merge (flaky retry reported); CI job on Linux and Windows with the report on failure; HUMAN-CHECKS.md ticked with the covering test and the rest grouped; STATUS and README test section
  - _Requirements: 4.1, 4.2, 5.1, 5.2_
