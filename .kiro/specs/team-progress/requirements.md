# Requirements Document

## Introduction
The game layer, part 2 (RPG). Agents and the user gain XP and levels from real, verified work; badges mark milestones; daily quests give a reason to come back. Levels come from real statistics, so they also tell the user, at the HR desk, how a team member has performed. The game never changes what agents do or their permissions.

Asked by the user on 2026-11-13. Depends on furni-shop (Ecto rewards for quests) and hr-desk (team members). All user-facing text in English.

## Requirements

### Requirement 1: XP and levels
#### Acceptance Criteria
1. THE world-server SHALL derive XP per team member and for the user from engine events (step finished ok, job delivered with pass, review pass, branch delivered, plan approved by the user), with amounts in `config/progress.json`, idempotent per task as in furni-shop.
2. Levels SHALL follow a fixed curve (level n needs 50·n·(n+1)/2 XP), stored in `data/progress.json` (file rules as in furni-shop).
3. Each member SHALL also keep real stats: jobs, pass rate, average step time. The team bar, the agent tooltip and the HR panel SHALL show level, XP to the next level and these stats.
4. A level-up SHALL show a short effect over the agent (own art) and a toast.

### Requirement 2: Badges
#### Acceptance Criteria
1. At least 12 badges SHALL exist in `config/badges.json` (for example First delivery, Ten deliveries, First branch review, Night owl, Librarian, Clean streak of five passes), each with its rule over the same events and its own icon drawn in code.
2. A badge SHALL be granted once, shown in a Badges tab of a new Profile panel (user) and in the member's HR card.

### Requirement 3: Daily quests
#### Acceptance Criteria
1. Each local day the server SHALL offer three quests from a fixed pool (for example "Deliver a branch", "Run a branch review", "Accept a memory note", "Schedule a night job"), chosen with the date as seed, with an Ecto reward each.
2. Quest progress SHALL come from the same events; a quest completes once and pays once. The Profile panel lists today's quests with progress.

### Requirement 4: Tests
#### Acceptance Criteria
1. Property tests: XP and levels are monotonic and replay-safe; the quest choice is deterministic for a date.
2. world-server tests: each XP source, each badge rule, quest completion and payout once, files survive a restart.
3. Playwright: a scripted job raises the Developer's XP in the team bar and completes a quest.
