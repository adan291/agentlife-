# Implementation Plan

- [ ] 1. Shared: builder agent, anchors and crew schema
  - `builder` in AgentIdSchema, `home_builder` anchor, builder desk resolution, `crew.ts` (ActivitySchema, CrewEventSchema)
  - office.json: builder desk + chair + `home_builder`; room still validates; existing tests updated where they enumerate agents
  - _Requirements: 1.1, 1.2, 2.1_

- [ ] 2. Engine: crew relay and route
  - `src/crew.ts` relay with 3 s say throttle; `POST /crew/events`; JobView ignores `build:*` task ids
  - Tests: 400 on invalid body, mapping, throttle, no task.* events, job + build session at the same time
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 4.2_

- [ ] 3. Runner: stream-json mapping and reporting
  - `scripts/crew-map.ts` + fixture + unit and property tests; wire `started` / activity / `finished` into run-session.ts, best effort, `AGENTLIFE_CREW=0`
  - Make root `pnpm check` run `scripts/test/*.test.ts`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1_

- [ ] 4. Client: ghost staff (all agents) and the Builder
  - One original ghost figure (float bob, wavy hem, eyes) used for Architect, Developer, QA and Builder, coloured per role; user avatar unchanged
  - Builder name tag with session label, idle at home when no session
  - Sim or world-server test: builder goto desk and back home
  - _Requirements: 1.3, 1.4, 1b.1, 1b.2, 1b.3, 4.3_

- [ ] 5. Manual check
  - With engine + world-server (ENGINE=http) + client running, run one short real session and record in docs/STATUS.md what was seen
  - _Requirements: 1.4, 2.4, 3.3_
