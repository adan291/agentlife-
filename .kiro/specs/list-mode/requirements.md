# Requirements Document

## Introduction

The isometric hotel is for seeing; daily work needs speed. list-mode adds a compact list view of all projects and jobs and a command palette, so the user can do everything without walking. Both views use the same data and actions.

Depends on hotel-floors, job-types and night-shift. All user-facing text in English.

## Requirements

### Requirement 1: List view

#### Acceptance Criteria
1. A toggle in the top bar (and the `L` key outside text fields) SHALL switch between Hotel and List views without reloading.
2. THE list SHALL show one row per project: name, current job (kind, state, step, who), waiting-for-you badge, last report verdict and time, night jobs scheduled; rows expand to show the job's steps and links to its artifacts.
3. Every action available in the hotel (start a job of any kind, approve or reject, open report, deliver, schedule a night job) SHALL be available from the list.

### Requirement 2: Command palette

#### Acceptance Criteria
1. `Ctrl+K` SHALL open a palette with fuzzy search over commands: "New <kind> job in <project>", "Approve plan in <project>", "Open report of <project>", "Go to <floor>", "Schedule night job", "Toggle view".
2. Commands SHALL be keyboard-only usable (arrows, Enter, Esc) and show their shortcut when they have one.

### Requirement 3: Tests

#### Acceptance Criteria
1. Fuzzy matching ranks exact prefixes first; every command dispatches the same message as its hotel equivalent; the list renders all states; Playwright: switch views and run "Approve plan" from the palette.
