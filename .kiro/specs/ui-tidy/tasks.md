# Implementation Plan

- [x] 1. Top bar groups, Menu and Edit room
  - Top bar fixed group, Hotel/List toggle, Ecto/level chip, Menu dropdown with shortcuts and collapse below 900 px; Edit room button and E key, editing banner with the arrange tool bar, stage-corner Arrange removed; unit and Playwright tests, existing e2e updated
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 5.1, 5.2_

- [x] 2. Arranging fixes and every room editable
  - Reproduce first with a Playwright test: a moved piece cannot be selected again; fix it. Turn in place for 1×1 pieces, wall pieces may stand free, clearer refusal reasons; lobby and HR office editable with their own reachability rules; layouts per room id; tests
  - _Requirements: 2.1, 6.1, 6.2, 6.3, 6.4_

- [ ] 3. Actions menu and stale Builder
  - Actions button and menu replacing the emote bar, closed by default, keys kept; nothing cut by the dock; Builder back to idle after 10 minutes without a report; tests
  - _Requirements: 3.1, 3.2, 4.1, 5.1, 5.2, 6.5_
