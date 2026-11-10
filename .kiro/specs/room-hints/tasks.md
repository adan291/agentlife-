# Implementation Plan

- [x] 1. Engine: step durations
  - Record `endedAt` for every finished step; test that all finished steps have `durationMs > 0` in the job view, export and report
  - _Requirements: 6.1, 6.2_

- [x] 2. Shared and engine: hints, role info and models
  - `FurniDef.hint` + catalog texts, `shared/src/roles.ts`, `welcome.models`, engine `GET /config/roles`, world-server fills `models` (fake engine: "fake")
  - _Requirements: 1.4, 3.1, 3.2_

- [x] 3. Client: tooltips for furniture and agents
  - `ui/tooltip.ts`, hover resolution for items and avatars, hide rules
  - _Requirements: 1.1, 1.2, 1.3, 3.1_

- [x] 4. Client: glow, mailbox badge and HUD waiting line
  - Pulsing outline with reduced-motion fallback, badge with count and new-report dot, HUD line
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3_

- [x] 5. Client: how-it-works guide
  - First-visit card, "?" button, Esc
  - _Requirements: 5.1, 5.2, 5.3_
