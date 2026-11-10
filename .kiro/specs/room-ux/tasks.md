# Implementation Plan

- [x] 1. Shared sanitize, agent.activity event and protocol
  - Move `sanitize` to `shared/src/sanitize.ts` (crew-map re-exports), `agent.activity` event, `activity` server message, `welcome.activity`
  - Tests: schemas, sanitize property test in shared
  - _Requirements: 4.1, 4.5, 6.1_

- [x] 2. Engine: activity from runtime progress, job milestones and crew
  - `runRole` emits throttled `agent.activity`; JobRunner milestone lines (plan ready, approved, test result counts); crew relay emits activity for builder
  - Tests: mapping, throttle 1/s, test-count parsing, no secrets
  - _Requirements: 4.1, 4.2, 6.1_

- [x] 3. World-server: activity ring buffer and forwarding
  - Buffer of 50, `welcome.activity`, forward `activity` messages
  - _Requirements: 4.5, 6.3_

- [x] 4. Client: terminal and readability
  - `ui/terminal.ts` (ring 300, filter, auto-scroll, collapse/resize), `ui/theme.ts` (14 px base, A−/A+), wider panels, diff colouring in reports, legible room labels
  - _Requirements: 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 6.2_

- [x] 5. Client: team bar, stepper and your-turn toast
  - `ui/team-bar.ts` with focus on click, `ui/stepper.ts` (pure mapping + render), `ui/toast.ts` with tab title
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 6.2_
