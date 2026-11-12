# TASKMAP: from demo to a working agent hotel

Source of truth for `pnpm conduct`. Each row is one spec. The conductor takes a row to 100 %:
build sessions → review (`agentlife-reviewer`) → acceptance verification (`agentlife-verifier`, criterion by criterion with evidence) → up to 2 fix rounds → merge into `main` with `pnpm check` and the leak scanner → next row.
Rows marked `live` are merged and their human checks are queued in docs/HUMAN-CHECKS.md; the conductor does not wait for them. The conductor never pushes unless `AGENTLIFE_PUSH=1`.

Definition of done for every row: all tasks `[x]`, verifier `VERDICT: PASS`, review without blocking issues, merged into `main`, `pnpm check` green, `pnpm security:scan` clean, STATUS.md updated.

| # | Spec | Sessions | Live | Status | What it gives the user |
|---|---|---|---|---|---|
| 1 | `project-registry` | S14 | yes | needs-check | Reception, real projects under D:\AgentHotel, jobs on them, delivery as a branch |
| 2 | `hotel-floors` | S15 S16 | yes | done | Lobby, elevator with live floor status, one floor per project, two jobs at once |
| 3 | `build-board` | S15B | no | done | Construction board in the lobby: TASKMAP rows, tasks per spec, conductor phase, what waits for you |
| 4 | `job-types` | S20 S21 | no | done | Review my branch, write tests, document: each from its own furniture |
| 5 | `night-shift` | S22 S23 | yes | needs-check | Schedule jobs for the night; morning summary in the mailbox and on Discord |
| 6 | `hr-desk` | S17 S18 S24 | yes | needs-check | HR office: hire, rename, change model, fire; trusted imports; local Ollama intern |
| 7 | `project-memory` | S25 | no | done | The Library: what agents learned, used in every next job |
| 8 | `list-mode` | S26 | no | todo | List view and command palette for daily use |
| 9 | `pipeline-editor` | S19 | no | todo | Choose and order roles per project with fixed safety rules |
| 10 | `final-demo` | — | yes | todo | Re-record the replay with several floors, video, Devpost (user with Kiro) |

Row 1 is merged; its live check (a real project in D:\AgentHotel) is done with the user and does not block row 2. Status `skip` keeps the conductor from re-running it.

Dependencies: 2 needs 1; 3 needs 2; 4, 5, 6, 7 need 2; 5 needs 4; 8 needs 4 and 5; 9 needs 6. The order above respects them.

Cut order if late (freeze 2026-12-01): 9, then 8, then 7. Never cut 1, 2, 4, 5 or 10.

## Agents

| Agent | Role | Writes |
|---|---|---|
| `agentlife-builder` | Implements spec tasks (via `pnpm session`) | Code on the feature branch |
| `agentlife-reviewer` | Code review against spec and steering | `docs/reviews/` |
| `agentlife-verifier` | Acceptance: every criterion PASS/FAIL with evidence | `docs/reviews/` |
| `agentlife-security` | Leaks, publishing and risky decisions | `data/security/` |

## Commands

- `pnpm conduct --dry-run`: show what is left.
- `pnpm conduct --once`: take the next row to 100 % and stop.
- `pnpm conduct`: run all rows until one needs the user.
