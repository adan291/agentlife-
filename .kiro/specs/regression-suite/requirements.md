# Requirements Document

## Introduction
The hotel has 95 Playwright tests, one file per spec, each checking its own feature against the scripted engine. They check behaviour, not looks, nothing walks through the whole hotel as a user does, and they run only when a session runs them by hand: the conductor does not run them before a merge and CI runs only the demo test. Most of what the user found by hand (a moved piece that could not be selected again, a mailbox row that looked like plain text, the emote bar cut by the dock, labels hidden behind furniture) was in that gap, and 76 manual checks wait in docs/HUMAN-CHECKS.md.

The user asked on 2026-11-14 for a regression suite "like Selenium in Java" to take human error out of testing. regression-suite adds user journeys, visual comparisons and layout rules, and runs them on every merge and push. Tests only: no product feature changes, except fixes for real bugs the new tests find (each recorded in this spec's design.md). Uses Playwright (already a dev dependency) and no new runtime dependency. All test names and messages in English.

## Requirements

### Requirement 1: User journeys
#### Acceptance Criteria
1. Playwright journeys SHALL walk the hotel as a user does, against the scripted engine and scratch data files (no credits, no real project):
   - Lobby: Edit room, move and turn a piece twice in a row, Done; Menu by keyboard; Actions menu runs Wave.
   - Shop: buy a furniture item and an outfit part; the balance falls by the price.
   - HR office: put the bought part on a member; it shows on the member's preview.
   - Project floor: place the bought item; start a job at the computer; approve the plan in the mailbox; catch a wisp while the job runs; open the report from its row; deliver; the row shows "Branch ready" before and the delivered branch after.
   - Profile: XP, level, the badge and the quest of that run are shown; the member wears the part on the floor after a reload.
   - List view and Ctrl+K palette: the same job is visible and "Approve plan" works from the palette.
2. Each journey SHALL start from a clean state it creates itself and SHALL not depend on another journey's order.

### Requirement 2: Layout and interface rules
#### Acceptance Criteria
1. A shared helper SHALL check, on every screen of the journeys and at 360×640, 800×600 and 1366×768: no visible control or label outside the viewport; no control covered by another element at its centre (`elementFromPoint`); no horizontal scroll bar; no text cut by its box.
2. Every element that reacts to a click SHALL be a button or link (role), have an accessible name, be reachable with Tab and show a focus ring, and have a pointer cursor.
3. No page error and no console error SHALL occur during a journey (a short allowlist only for known, documented messages).

### Requirement 3: Visual comparisons
#### Acceptance Criteria
1. Screenshots of each room (lobby, HR office, a project floor with the default layout and a decorated one) and of each panel SHALL be compared with committed baselines at the three sizes of 2.1, with animations, motes and the clock frozen (reduced motion, fixed time, fixed seeds) so a run is repeatable.
2. Baselines SHALL be kept per platform (Playwright's platform suffix). A platform without baselines skips the visual step and says so; `pnpm --filter @agentlife/client e2e:update-visuals` rewrites them on purpose.
3. A failing comparison SHALL keep the expected, actual and diff images in the Playwright report.

### Requirement 4: Runs on every merge and push
#### Acceptance Criteria
1. THE conductor SHALL run the whole Playwright suite (`E2E_CHANNEL=msedge` on Windows) and `e2e:demo` before it merges a spec, after `pnpm check`; a failure stops the merge like a failing check, with the report path in the reason. A test that fails and passes on one immediate retry is reported as flaky in the session log, not hidden.
2. CI SHALL run the journeys and the rules on every push and pull request on Linux and Windows, and upload the Playwright report on failure.
3. The test servers SHALL use their own ports and scratch files and stop when the run ends, so a run never touches the user's hotel data or a running hotel.

### Requirement 5: Fewer manual checks
#### Acceptance Criteria
1. Every item of docs/HUMAN-CHECKS.md that a journey, a rule or a visual comparison now covers SHALL be ticked with the name of the test that covers it. What is left SHALL be only what needs a human (is it clear, is it fun, a real kiro-cli run, a real night, Discord), grouped in one short list.
2. docs/STATUS.md and the README's test section SHALL say how to run the suite and update the visual baselines.
