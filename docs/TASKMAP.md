# TASKMAP: from demo to a working agent hotel

Source of truth for `pnpm conduct`. Each row is one spec. The conductor takes a row to 100 %:
build sessions → review (`agentlife-reviewer`) → acceptance verification (`agentlife-verifier`, criterion by criterion with evidence) → up to 2 fix rounds → merge into `main` with `pnpm check` and the leak scanner → next row.
Rows marked `live` are merged and their human checks are queued in docs/HUMAN-CHECKS.md; the conductor does not wait for them. The conductor never pushes unless `AGENTLIFE_PUSH=1`.

Definition of done for every row: all tasks `[x]`, verifier `VERDICT: PASS`, review without blocking issues, merged into `main`, `pnpm check` green, `pnpm security:scan` clean, STATUS.md updated.

| # | Spec | Sessions | Live | Status | What it gives the user |
|---|---|---|---|---|---|
| 1 | `project-registry` | S14 | yes | done | Reception, real projects under D:\AgentHotel, jobs on them, delivery as a branch |
| 2 | `hotel-floors` | S15 S16 | yes | done | Lobby, elevator with live floor status, one floor per project, two jobs at once |
| 3 | `build-board` | S15B | no | done | Construction board in the lobby: TASKMAP rows, tasks per spec, conductor phase, what waits for you |
| 4 | `job-types` | S20 S21 | no | done | Review my branch, write tests, document: each from its own furniture |
| 5 | `night-shift` | S22 S23 | yes | needs-check | Schedule jobs for the night; morning summary in the mailbox and on Discord |
| 6 | `hr-desk` | S17 S18 S24 | yes | needs-check | HR office: hire, rename, change model, fire; trusted imports; local Ollama intern |
| 7 | `project-memory` | S25 | no | done | The Library: what agents learned, used in every next job |
| 8 | `list-mode` | S26 | no | done | List view and command palette for daily use |
| 9 | `pipeline-editor` | S19 | no | done | Choose and order roles per project with fixed safety rules |
| 10 | `furni-move` | S27 S28 | yes | needs-check | Better default floor layout; move and rotate furniture on a project floor, saved and checked by the server |
| 11 | `furni-shop` | S29 S30 | yes | needs-check | Housing: Ecto earned from real work, shop in the lobby, inventory, place bought furniture |
| 12 | `team-progress` | S31 | yes | needs-check | RPG: XP and levels from real stats, badges, daily quests |
| 13 | `waiting-fun` | S32 | yes | needs-check | While you wait: catch wisps, sit and emotes, ghost mood with a coffee machine |
| 14 | `ui-tidy` | S33 S34 | yes | needs-check | Clean top bar: Edit room button, Menu dropdown, Actions menu for the avatar; no stale Builder |
| 15 | `ghost-skins` | S35 S36 | yes | needs-check | Outfits for the ghosts and the avatar (hat, top, accessory), bought with Ecto or unlocked by badges, worn from the HR desk and the Profile |
| 16 | `regression-suite` | S37 S38 S39 | no | done | User journeys, layout rules and visual comparisons in Playwright, run by the conductor before every merge and by CI on every push |
| 17 | `bug-sack` | S40 S41 | yes | needs-check | Every error caught by itself (Game and Code), Report a bug with F8, the Bug sack panel to read them any time |
| 18 | `multi-runtime` | IDE | yes | needs-check | Any AI, several at once: Kiro, Ollama, LM Studio, Groq, Grok, OpenAI, OpenRouter per role and per member; the engine runs the file tools |
| 19 | `final-demo` | — | yes | todo | Re-record the replay with several floors, video, Devpost (user with Kiro) |
| 20 | `app-bugs` | — | yes | todo | Errors of the user's own applications through the Sentry protocol, Diagnose with checked evidence, Fix with a red-green regression test, Maven projects. Spec on branch `feat/app-bugs` |
| 21 | `field-kit` | — | yes | todo | AGENT LIFE offline from a USB drive: portable Linux folder with Node, Ollama and models, start.sh with no network, checksums, Docker or podman sandbox (docs/roadmap-field-kit.md) |
| 22 | `offline-rag` | — | yes | todo | Load PDF, HTML and Markdown documentation and ask with checked citations, in the Library and as agent context |
| 23 | `command-deck` | — | yes | todo | Portable VSCodium with an extension: per-project command buttons, terminal, the hotel's jobs and mailbox, the bug suite |
| 24 | `ada-stack` | — | yes | todo | Ada projects (GNAT, gprbuild) with tests in the sandbox, GNAT log intake for the bug suite |

Row 1 is merged; its live check (a real project in D:\AgentHotel) is done with the user and does not block row 2. Status `skip` keeps the conductor from re-running it.

Dependencies: 2 needs 1; 3 needs 2; 4, 5, 6, 7 need 2; 5 needs 4; 8 needs 4 and 5; 9 needs 6; 10 needs 2; 11 needs 10; 12 needs 11 and 6; 13 needs 12. Rows 11-13 are the game layer (user, 2026-11-13): rewards come only from verified engine events, granted by the world-server; the game never changes what agents do or their permissions. The order above respects them.

Cut order if late (freeze 2026-12-01): 15, 14 task 2, then 13, then 12, then 9, then 8, then 7. Never cut 1, 2, 4, 5 or 10.

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
