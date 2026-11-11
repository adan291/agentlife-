# Repository structure

```
packages/shared/        zod protocol + agent event schemas, isometric geometry
packages/client/        Vite + PixiJS front end (live and replay transports)
packages/world-server/  WebSocket gateway, room state, pathfinding, event → visible action
packages/agent-engine/  job state machine, runtimes (kiro-cli, llm), policies, SQLite event log
docs/                   discovery and design decisions (source of truth for "why")
.kiro/                  steering, specs, hooks, custom agents — must stay committed
```

- One spec per feature block under `.kiro/specs/`: world-room, agent-engine, agent-pipeline, build-crew (the Builder ghost mirrors `pnpm session` runs in the room), room-hints (tooltips and onboarding), room-ux (team bar, stepper, activity terminal), room-fixes (bugfix), ui-shell (grid layout), job-insight (work attribution, report viewer), project-registry (Reception, real projects, delivery as a branch), hotel-floors (lobby, elevator, a floor per project), hr-desk (teams, catalogue, trusted imports), pipeline-editor (per-project flow), demo-replay.
- Runtime data (worktrees, run logs, SQLite) goes in `data/`, which is git-ignored.
- Decisions that change the architecture are recorded in `docs/risks-and-decisions.md`.
