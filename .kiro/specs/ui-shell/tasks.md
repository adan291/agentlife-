# Implementation Plan

- [x] 1. Shell grid and stage-sized canvas
  - `ui/shell.ts` with `shellTemplate` (pure, tested), grid regions, ResizeObserver → renderer resize + re-fit; remove the room-fixes free-viewport code
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1_

- [x] 2. Move components into regions
  - Team bar → side, terminal → dock, stepper + status + HUD controls → top bar; toast, tooltip, guide, panels → stage (absolute); remove all `position: fixed` shell rules
  - _Requirements: 1.5, 4.1, 4.2_

- [x] 3. Side bar and dock behaviour
  - Collapsed side bar (52 px icons, tooltips), single chevron toggle with aria-label, ellipsis + title; dock drag-resize, collapse to header with latest line and unread count; persisted state
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2_

- [x] 4. Responsive rules and visual polish
  - Breakpoints (900 / 640 px width, 560 px height), compact stepper; theme tokens, button states, focus rings, panel header/body/footer
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_

- [x] 5. Playwright layout smoke test
  - Three viewport sizes; no overlap between regions; canvas equals stage; collapsing the side bar grows the canvas
  - _Requirements: 7.2_
