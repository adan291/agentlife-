# Requirements Document

## Introduction
The game layer, part 3. Small things to do while the agents work, so waiting is fun without turning into grinding. Purely client and world-server; the agent-engine does not change and nothing here affects a job.

Asked by the user on 2026-11-13. Depends on furni-shop (Ecto) and team-progress (quests). First to cut if late. All user-facing text in English.

## Requirements

### Requirement 1: Wisp catching
#### Acceptance Criteria
1. While a job runs on the user's floor, a catchable wisp SHALL appear now and then (at most one at a time, every 20 to 60 s); clicking it before it fades (8 s) catches it with a small effect.
2. THE server SHALL decide when a wisp exists and grant a catch (1 Ecto), at most 10 catches per job and 50 per day; a click on a wisp that is not there gives nothing.
3. Under reduced motion the wisp does not move and has no particles.

### Requirement 2: Avatar actions and emotes
#### Acceptance Criteria
1. THE user's avatar SHALL be able to sit on seating furniture (click a sofa or chair), wave, dance and cheer (emote bar, keys 1 to 4 outside text fields), shown with own art.
2. Agents SHALL cheer when their job is delivered with pass, and look glum for a moment on a fail.

### Requirement 3: Ghost mood (visual only)
#### Acceptance Criteria
1. Each desk agent SHALL have a mood (rested, busy, tired) that changes with how long it has worked today; it shows in the tooltip and as a small face on the name tag.
2. A coffee machine (shop item) on the floor SHALL let the user "serve coffee" to a tired agent, which makes it rested. Mood never changes a job, a model or a permission; the tooltip says so.

### Requirement 4: Tests
#### Acceptance Criteria
1. world-server tests: wisp spawn only during a job, catch limits per job and per day, a catch of a missing wisp is refused, sitting on an occupied seat is refused.
2. Client tests: emote keys ignored in text fields; reduced motion.
3. Playwright: during a scripted job, catch a wisp and see the balance rise.
