# Implementation Plan

- [x] 1. XP, levels and stats
  - Shared schemas; `config/progress.json`; progress store and idempotent XP from engine events; level curve; team bar, tooltip and HR panel show level and stats; level-up effect; property test
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.1_

- [ ] 2. Badges and daily quests
  - `config/badges.json` with 12+ rules and icons; Profile panel (Badges, Quests); seeded daily quests paying Ecto once; tests and Playwright
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 4.2, 4.3_
