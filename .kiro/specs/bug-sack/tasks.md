# Implementation Plan

- [ ] 1. Store and Code grabber
  - Shared schemas (bug report, group, fingerprint, messages); world-server bug store (`data/bugs.jsonl`, screenshots, leak masking, limits, atomic file); world-server and agent-engine grabbers; conductor and session errors; `pnpm bugs`; tests
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 5.5, 6.1, 6.2_

- [ ] 2. Game grabber, Report a bug and the Bug sack
  - Client grabber with limits; F8 and Menu "Report a bug" with note and stage screenshot; lobby bug jar (own art), Bug sack panel with Game and Code tabs, details, Fixed/Ignored, filters, search, Copy for Kiro, "Bugs (n)" and dot; demo off; tests, Playwright and visual baselines
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 5.1, 5.2, 5.3, 5.4, 6.3, 6.4_
