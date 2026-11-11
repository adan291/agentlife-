# Implementation Plan

- [ ] 1. Engine: work attribution and context usage
  - `RuntimeEvent.tool` and `context` from the kiro-cli runtime; WorkTracker in `runRole`; `agent.work` events (throttled); step records with model, context peak, file counts; FakeRuntime deterministic values
  - _Requirements: 1.1, 1.2, 2.1_

- [ ] 2. Protocol, world-server and Origin check
  - `work` message and `welcome` field; `job_details` request proxied to the engine (size caps); `verifyClient` Origin allowlist with tests
  - _Requirements: 1.3, 2.1, 2.2, 7.1, 7.2, 7.3_

- [ ] 3. Client: team bar work block, tooltip, terminal tags, Job panel
  - Task title, step, elapsed, context meter, file counts; `#tag` and step in terminal lines; Job panel with steps table, artifact links and the credits line
  - _Requirements: 1.3, 1.4, 1.5, 2.1, 2.2, 2.3_

- [ ] 4. Client: report delivery, Report viewer, mailbox list
  - Toast queue (your-turn, report), Architect bubble, mailbox glow and unread, Report viewer with verdict badge
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 5. Client: stepper, working visuals, contrast
  - Stepper without scroll bars (+ Playwright check), working effects on ghosts and monitor glow with reduced-motion fallback, custom select and one-repo line, contrast test and button states
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4_
