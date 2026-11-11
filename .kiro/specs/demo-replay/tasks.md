# Implementation Plan

- [x] 1. Mode selection and base-path-safe assets
  - `src/mode.ts`; route all asset URLs through `import.meta.env.BASE_URL`
  - _Requirements: 3.1, 3.2_

- [x] 2. Schedule builder and ReplayEngine
  - Gap compression, speed, approval pause/resume; property test for the schedule
  - _Requirements: 1.2, 1.4, 2.3_

- [x] 3. ReplayTransport
  - Implements Transport; runs WorldSim + ReplayEngine in the browser; panels fed from recorded artifacts
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 4. Replay UI
  - Banner with recorded date, speed buttons 1×/4×/16×, restart; hidden DOM list of agent states (`data-agent-state`)
  - _Requirements: 2.1, 2.2_

- [x] 5. Demo build check and GitHub Pages workflow
  - Test that the demo build contains no live endpoints; `.github/workflows/pages.yml`
  - _Requirements: 3.3, 4.1_

- [x] 6. Playwright smoke test
  - `e2e/demo.spec.ts` against `vite preview`; run in CI
  - _Requirements: 4.2_

- [x] 7. Submission material
  - README (English, final), `docs/kiro-usage.md`, `docs/video-script.md`
  - _Requirements: 5.1, 5.2, 5.3_
