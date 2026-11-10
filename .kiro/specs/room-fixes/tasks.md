# Implementation Plan

- [ ] 1. Transport: no reconnect on "replaced" (code 4000)
  - Client stops reconnecting on close code 4000, HUD banner "AGENT LIFE is open in another tab" with "Use here"; other close codes keep the backoff
  - Unit tests with the fake socket: 4000 → no timer, banner; 1006 → reconnect; "Use here" → connect
  - _Bug 1_

- [ ] 2. Layout: fit the room into the free viewport
  - Free viewport = window − team bar width (expanded) − terminal height (open) − 16 px margin; used by chooseZoom and centring; recompute on team bar toggle, terminal show/hide/resize and window resize; user-picked zoom wins
  - Unit tests for the free-viewport and zoom choice
  - _Bug 2_

- [ ] 3. Builder row second line
  - "Kiro build sessions" when idle, "<session> · <model>" while a session runs
  - _Bug 3_
