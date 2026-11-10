# Requirements Document

## Introduction

Since room-hints and room-ux the client has six independent `position: fixed` overlays (HUD, stepper, toast, team bar, terminal, panels) on top of a full-window PixiJS canvas. Each places itself without knowing the others, so collapsing the team bar, resizing the terminal or shrinking the window makes them overlap and clip (user report, 2026-11-10, screenshot: collapsed team bar truncated over the room, room cut at the top).

ui-shell replaces the overlays with one application shell laid out by CSS grid. The canvas lives in its own cell and is sized by the browser, so the room always fits the space that is actually free. It also defines responsive behaviour and a visual polish pass.

Context: room-ux, room-hints, room-fixes (`free viewport` logic in `world-view.ts`, which this spec supersedes), steering tech.md (plain DOM + CSS, PixiJS v8, no UI framework). All user-facing text in English.

## Requirements

### Requirement 1: Application shell

**User Story:** As a user, I want a stable layout, so that collapsing, resizing or opening panels never breaks the screen.

#### Acceptance Criteria
1. THE client SHALL render one shell element laid out with CSS grid: a top bar (connection status, stepper, HUD controls), a left side bar (team), a centre stage (canvas) and a bottom dock (activity terminal).
2. THE PixiJS canvas SHALL be a child of the stage cell and SHALL be resized from the cell size (ResizeObserver), never from the window.
3. THE room fit (zoom choice and centring) SHALL use the stage size only; the `free viewport` subtraction from room-fixes SHALL be removed.
4. Collapsing the side bar or the dock SHALL change the grid tracks; the stage SHALL grow, and the room SHALL re-fit within one frame (respecting a zoom the user picked).
5. No shell region SHALL overlap another at any window size ≥ 360 × 480 px. Tooltips, the your-turn toast, the guide and panels are the only overlays and SHALL be positioned relative to the stage, not the window.

### Requirement 2: Side bar (team)

#### Acceptance Criteria
1. Expanded width 240 px; collapsed width 52 px showing only the ghost icons with their state colour and a tooltip with name and state.
2. One toggle button with a single, consistent icon (chevron), labelled for screen readers ("Collapse team" / "Expand team"); the collapsed state is remembered in localStorage.
3. Text in rows SHALL never be cut mid-word: long values ellipsise with a `title` attribute holding the full text.

### Requirement 3: Bottom dock (activity terminal)

#### Acceptance Criteria
1. The dock SHALL be resizable by dragging its top edge between 3 lines and 50 % of the window height, and collapsible to its header row (32 px); height and state remembered in localStorage.
2. When collapsed, the header SHALL show the latest line and a count of unread lines.

### Requirement 4: Top bar

#### Acceptance Criteria
1. The top bar SHALL hold, left to right: the AGENT LIFE title, the connection status (only when not connected), the stepper (centre), and the controls (zoom, A−/A+, help).
2. The your-turn toast SHALL appear directly under the top bar inside the stage, never covering the top bar.

### Requirement 5: Responsive behaviour

#### Acceptance Criteria
1. Width < 900 px: the side bar starts collapsed.
2. Width < 640 px: the stepper shows only the current step label with "n/6"; the dock starts collapsed; panels take the full stage width.
3. Height < 560 px: the dock starts collapsed.
4. The layout SHALL work at browser zoom 50–200 % and on window minimise/restore without reloading.

### Requirement 6: Visual polish

#### Acceptance Criteria
1. One spacing scale (4, 8, 12, 16, 24 px), one radius (6 px), one border colour and one shadow for raised elements, defined as CSS custom properties in `ui/theme.ts` and used by every component.
2. Buttons SHALL have hover, focus-visible and pressed states; every interactive control SHALL be reachable with Tab and show a visible focus ring.
3. Panels SHALL have a header with title and close button, a scrollable body and an optional footer with actions.
4. The Kiroween look stays: night palette, pumpkin accent, ghost icons.

### Requirement 7: Tests

#### Acceptance Criteria
1. Unit tests for the grid template per state (side bar expanded/collapsed × dock open/collapsed × breakpoints) as pure functions.
2. A Playwright smoke test (Chromium) at 1366 × 768, 800 × 600 and 375 × 667: no two shell regions' bounding boxes overlap, the canvas size equals the stage size, and collapsing the side bar grows the canvas.
