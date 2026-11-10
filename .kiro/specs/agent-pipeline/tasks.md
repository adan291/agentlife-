# Implementation Plan

- [x] 1. kiro-cli spike (run early; it gates this spec)
  - Throwaway script in `packages/agent-engine/spikes/` plus `docs/spikes/kiro-cli.md` with findings
  - Verify KIRO_API_KEY auth with `KIRO_HOME=data/kiro-home`, agent lookup, stream-json record shapes, exit codes, write-outside-cwd denied, shell denied, credits per run
  - If anything fails, stop and record the alternative in docs/risks-and-decisions.md
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Fixture repository haunted-todo
  - `fixtures/repos/haunted-todo/` with module, Vitest tests, 3 seeded issues, README, lockfile
  - Make sure the fixture is excluded from the monorepo workspace and from root `pnpm check`
  - _Requirements: 2.1_

- [x] 3. Materialise step
  - Copy fixture to `data/repos/<id>/`, `git init`, commit with fixed author; refuse repos containing `.kiro/agents/agentlife-*`
  - _Requirements: 2.2_

- [x] 4. Role agents and prompts
  - `agents/agentlife-{architect,developer,qa}.json` (same shape as `.kiro/agents/agentlife-reviewer.json`) using the syntax confirmed in the spike; install into `data/kiro-home/agents` at startup
  - `prompts/*.md` templates with the untrusted-content rule
  - Validate each agent with `kiro-cli agent validate --path`
  - _Requirements: 3.2, 4.1, 5.2, 7.1_

- [x] 5. KiroCliRuntime
  - Spawn, minimal env, stream-json parsing with zod schemas from the spike, raw log files, timeout and tree kill, error with redacted stderr tail
  - Unit tests with a fake child process; live test behind `AGENTLIFE_LIVE=1`
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6_

- [x] 6. Analyze step
  - Prompt, `extractJsonBlock`, PlanSchema validation with one retry, store plan.json, request approval with one option per task
  - _Requirements: 4.2, 4.3, 4.4_

- [ ] 7. Develop step and diff validation
  - Worktree + branch, run developer agent, validate diff (property test for path rules), commit, store diff.patch
  - _Requirements: 5.1, 5.3, 5.4, 5.5_

- [ ] 8. Docker runner
  - `docker/runner.Dockerfile`, build script `pnpm --filter @agentlife/agent-engine runner:build`, run with limits, timeout + `docker kill`, store test_log.txt, `docker_unavailable` failure
  - Verify Windows path mounting
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 9. Review step
  - QA prompt with task, diff, test log; ReviewSchema with retry; force `fail` when tests failed
  - _Requirements: 7.1, 7.2, 7.3_

- [ ] 10. Report step
  - Template, artifact, `report.ready`, also on failure; snapshot test
  - _Requirements: 8.1, 8.2_

- [ ] 11. Wire real steps into JobRunner
  - `config/agents.json` set to kiro-cli for the three roles; FakeRuntime stays the CI default
  - _Requirements: 9.1_

- [ ] 12. Live runs
  - Three consecutive end-to-end runs from the room; record durations, credits and issues in docs/STATUS.md
  - _Requirements: 9.1, 9.2_

- [ ] 13. Export a demo run
  - Export the best run with `GET /tasks/:id/export` to `packages/client/public/demo/run-001.json` (input for demo-replay)
  - _Requirements: 8.2, 9.2_
