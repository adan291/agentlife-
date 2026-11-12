VERDICT: PASS

Branch `feat/hr-desk` (HEAD `9eb425a`, 12 commits over `main`, tasks 1-5 marked done). Fourth pass, 2026-11-12, after commit `9eb425a` (requirement 4.3 fixed with option A, decision D12). The previous pass failed only on 4.3. All other criteria were re-checked against the unchanged code and tests and still hold.

Commands run:
- `pnpm check`: exit 0 (shared 220, world-server 142, client 450, agent-engine 599 passed and 7 skipped, scripts 16).
- `pnpm security:scan`: clean.
- `world-server/test/hr-desk.test.ts` (15 passed), `shared/test/guests.test.ts` (9), `client/test/floor-people.test.ts` + `hr-panel.test.ts` (32), `agent-engine/test/hr-desk-e2e.test.ts` (4): all passed.
- `E2E_CHANNEL=msedge playwright test e2e/hr.spec.ts`: 2 passed.

## Criteria

| Requirement.criterion | Result | Evidence |
|---|---|---|
| 1.1 Catalogue with a template per role and alternatives | PASS | `config/catalogue/` (architect, architect-thorough, developer, qa, qa-fast, qa-strict, reviewer, researcher, night-intern). `team-generate.test.ts` "has a template for every role and two alternatives for QA". |
| 1.2 `GET /catalogue` lists role, tier, model, source, origin | PASS | `catalogue-route.test.ts` "lists the templates with role, tier, default model, source and origin". |
| 2.1 Hire with name and model checked against account and role lists | PASS | `team.test.ts` "limits models to the role's list and to the account's models", "says so when the model list cannot be read", "refuses an unknown template, a taken name, a bad model and a full team"; `team-routes.test.ts`. |
| 2.2 Last architect/developer cannot be fired, with explanation | PASS | `team.test.ts` "refuses to fire the only architect or the only developer, with an explanation"; `hr-desk-e2e.test.ts` "refuses to fire the last architect and says why". |
| 2.3 No firing while working; rename and model apply next job | PASS | `team.test.ts` "refuses to fire an agent that is working...", "keeps the agents a job started with"; `team-routes.test.ts` "a job started after a model change runs with the new model". |
| 2.4 `data/teams.json`; hire, fire, rename in the activity terminal | PASS | `team/store.ts` tests; `engine.ts` writes `agent.activity` lines under `team:<project>`; `team-routes.test.ts` asserts the lines. Client rendering not seen (Human checks). |
| 2.5 Agent file from tier + persona, validated, permissions equal the tier | PASS | `team/generate.ts`; `team-generate.test.ts` "rebuilds the committed role agents exactly", "builds every catalogue template with the permissions of its tier", "validates in staging, then moves the file into agents/", "keeps the old file ... when validation fails". Live validate test needs `AGENTLIFE_LIVE=1` (skipped). |
| 3.1 Imports only from `config/catalogue-sources.json` | PASS | `team-import.test.ts` "imports are off with the shipped configuration", "allows only an address that is listed...", "refuses plain http, other schemes, credentials..."; `team-import-routes.test.ts` "refuses an address that is not listed without making a request". |
| 3.2 Dangerous and unknown fields dropped and listed | PASS | `team-import.test.ts` "drops tools, permissions, mcpServers, hooks, resources and unknown fields, and lists their names" and the property test; `hr-panel.test.ts` shows "Ignored for safety". |
| 3.3 Caps, leak scan, injection review, result shown | PASS | `team-import.test.ts` caps, secrets/e-mail refusal, "flags the usual prompt-injection and permission requests", review verdict test; `ui/hr.ts` shows the review. Requirement names `agentlife-import-review` (D10). |
| 3.4 Hireable only after approval bound to the content hash | PASS | `team-import.test.ts` "holds an imported template until the user approves its hash...", "invalidates the approval when the content changes...", "keeps approvals across a restart, and drops an approval whose stored content was edited". |
| 4.1 HR office with desk panel (catalogue, teams, imports) and HR ghost | PASS | `rooms/hr.json`; tabs in `ui/hr.ts`; `hr-panel.test.ts`; `hr-desk.test.ts` "HR desk" group; Edge `e2e/hr.spec.ts` "the HR office draws its desk and its ghost without errors, and has no agents in the team bar". |
| 4.2 HR agent suggests a team; user applies it; it never hires alone | PASS | `service-agents.ts` (`hr`, read-only tier); `team-suggest.test.ts` "proposes by the fixed rules ... and hires nobody"; `hr-panel.test.ts` "asks the HR agent, shows its proposal, and applies it only when the user presses the button"; `hr-desk-e2e.test.ts` "asks for a proposal, then applies it: hire the pick, let the replaced member go". |
| 4.3 First member of a desk role at the desk; every other member at a floor spot; fired agent walks to the elevator and leaves; up to 8 visible | PASS | Spots: `rooms/project-template.json` anchors `home_guest1..6`; `guests.test.ts` "only project floors have spots, one per guest id", "every spot is a free standing tile of its own...", "a floor missing a spot is refused". Placement: `gateway.ts` `seatsOf` (desk for first of seated role, `GUEST_IDS` spots for the rest). Gateway tests: `hr-desk.test.ts` "shows the member's name on the floor, and swaps the ghost when somebody else takes the desk", "shows a full team of eight: three at their desks and five at spots, each walking in from the elevator", "walks a member who is let go to the elevator, empties the spot, and leaves the others where they stand", "gives the desk to the next member of the role when the holder is let go, and empties that member's spot". Real engine + gateway + socket: `hr-desk-e2e.test.ts` "shows a second developer, a reviewer, a researcher and the Night intern on the project's floor". Client: `floor-people.test.ts` "shows a second developer, a reviewer, a researcher and the Night intern, each at their own spot", "shows all eight members of a full team: three at desks, five at spots", "keeps a member who was let go in view until the ghost has walked to the elevator, then hides it". Requirement text and D12 agree with the code. |
| 5.1 Property test: permissions equal the tier | PASS | `team-generate.test.ts` "property: the permissions and tools always equal the tier's, whatever the template holds", "property: arbitrary values never produce a file with other permissions". |
| 5.2 Import tests | PASS | Tests listed in 3.1, 3.2, 3.4. |
| 5.3 Team rule tests | PASS | Tests listed in 2.2, 2.3. |
| 6.1 Night intern (researcher, read-only, Ollama, `qwen3.5:4b`) | PASS | `config/catalogue/night-intern.json`; `intern.test.ts` "is a built-in researcher in the read-only tier that runs on Ollama with qwen3.5:4b", "cannot be declared for any other role or for an imported source". |
| 6.2 Only tool-free read-only steps; plan, develop, review refused | PASS | `team/intern.ts` `INTERN_STEPS`; `intern.test.ts` "accepts the small read-only steps and nothing a pipeline needs tools for", "InternRuntime refuses plan, develop and review steps before anything runs", "runRole with the intern refuses ... and never starts a runtime". |
| 6.3 Ollama down: fallback to `claude-haiku-5.5`, report says so | PASS (unit level) | `intern.test.ts` "falls back to claude-haiku-5.5 with the same read-only agent, and reports it first", "records the fallback for the report and the log, and the report mentions it". Not run live (Human checks). |

## To fix

None.

## Human checks

- Look at a project floor with a full team in a browser: six standing ghosts, name tags that may overlap when two stand close, the two spots beside the QA desk, the tooltip of a ghost at a spot. The Edge test covers only the HR office.
- Watch the walks with a real engine: a hire walking in from the elevator to a spot, a fired member walking out, a desk holder replaced by the next member of the role (that member leaves by the elevator and the desk ghost comes in through it).
- HR panel in a browser against a real engine: hire, rename, change model, fire; the import queue with an allowlisted source; "suggest a team" and "Apply this team"; the hire, rename and fire lines in the activity terminal on the right floor.
- Real `kiro-cli`: `AGENTLIFE_LIVE=1` run of the validate test for the generated agent files; the import review and the HR agent with real replies; a real job on a customised team using `--agent` and `--model`.
- Real download from a source listed in `config/catalogue-sources.json`.
- Night intern: start Ollama with `qwen3.5:4b` and check an answer; stop Ollama and check that `claude-haiku-5.5` answers and the report's Notes section says so. No pipeline step asks for a researcher yet, so this needs a test harness or pipeline-editor.
- The user should ratify D10 (import review uses `agentlife-import-review`, not `agentlife-security`).
