# Implementation Plan

- [x] 1. Tiers, templates and generated agent files
  - Tier files, template schema, catalogue, agent file generation from tier + persona with validation; property test that permissions always equal the tier
  - _Requirements: 1.1, 1.2, 2.5, 5.1_

- [x] 2. Teams per project
  - Hire / rename / change model / fire with the team rules, `data/teams.json`, models list from kiro-cli, engine uses each project's team for jobs, activity lines
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.3_

- [x] 3. Trusted imports
  - Sources allowlist, parsing with dropped fields, caps and leak scan, security-agent review, user approval bound to the content hash
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.2_

- [ ] 4. HR office, HR ghost and panel
  - HR room furniture and panel (catalogue, teams, import queue), HR agent team suggestion (applied by the user), hired agents appear on their floor, fired agents leave by the elevator
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 5. Local intern
  - "Night intern" template on the Ollama runtime, allowed only for tool-free read-only steps, fallback to claude-haiku-5.5 reported
  - _Requirements: 6.1, 6.2, 6.3_
