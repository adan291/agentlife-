# Bugfix: room-fixes

Found by the user in the browser after room-ux was merged (2026-11-10).

## Bug 1: endless "Reconnecting…" when a second client connects

The world-server keeps one user session and closes the previous socket with code 4000 ("replaced by a newer connection") when a new one connects (`packages/world-server/src/gateway.ts`). The client (`packages/client/src/transport.ts`) treats every close as a network failure and reconnects, which replaces the other client, which then reconnects too.

### Current Behavior
- WHEN a second tab, a headless browser or a script connects to the world-server THEN the system closes the first socket with code 4000, the first tab reconnects within 1–10 s, replaces the second one, and both tabs alternate between connected and "Reconnecting…" indefinitely.

### Expected Behavior
- WHEN a socket is closed with code 4000 THEN the system SHALL NOT reconnect automatically, and SHALL show a banner "AGENT LIFE is open in another tab" with a "Use here" button.
- WHEN the user clicks "Use here" THEN the system SHALL connect again (replacing the other client, which then shows the same banner).
- WHEN a socket closes for any other reason THEN the system SHALL reconnect with the existing backoff.

### Unchanged Behavior
- WHEN the world-server restarts THEN the system SHALL CONTINUE TO show "Reconnecting…" and reconnect with backoff 1 s, 2 s, 5 s, 10 s.
- WHEN the socket is open THEN the system SHALL CONTINUE TO hide the status banner.

## Bug 2: room too small and off-centre since room-ux

`WorldView.layout()` and `chooseZoom()` (`packages/client/src/scene/world-view.ts`, `zoom.ts`) use the whole window. The team bar (left) and the activity terminal (bottom) now cover part of it.

### Current Behavior
- WHEN the room loads with the team bar expanded and the terminal open THEN the system centres the room in the full window and keeps zoom 1× even when 2× would fit in the free area, so the room looks small and sits partly behind the terminal.

### Expected Behavior
- WHEN choosing the zoom and the centre THEN the system SHALL use the free viewport: window minus the team bar width (when expanded) and minus the terminal height (when open), with a margin of 16 px.
- WHEN the team bar is collapsed or expanded, the terminal is hidden, shown or resized, or the window is resized THEN the system SHALL recompute the layout, and SHALL re-choose the zoom only if the user has not picked one with the 1×/2× button.
- WHEN 2× fits in the free viewport THEN the system SHALL pick 2×.

### Unchanged Behavior
- WHEN the user picks a zoom with the button or the Z key THEN the system SHALL CONTINUE TO keep that zoom.
- WHEN an agent is focused from the team bar THEN the system SHALL CONTINUE TO pan to it (now within the free viewport).

## Bug 3: Builder row shows no model

### Current Behavior
- WHEN the team bar renders the Builder THEN the system shows no second line, unlike the other rows.

### Expected Behavior
- WHEN no build session is running THEN the Builder row SHALL show "Kiro build sessions"; WHILE one runs it SHALL show "<session> · <model>" from the latest Builder `started` crew event.
