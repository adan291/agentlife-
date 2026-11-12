# Requirements Document

## Introduction

The HR office lets the user build each project's team: hire agents from a catalogue, rename them, give them a role and a model, fire them, and import new agent templates from trusted sources. An HR agent (a ghost behind the desk) helps: it explains roles, suggests a team for a project and reviews imported templates.

Security is the core of this spec. An agent template can change who the agent is (name, persona, description, prompt style) but never what it may do: permissions always come from fixed tiers defined in this repository.

Depends on project-registry and hotel-floors (HR office room, per-project teams). All user-facing text in English.

## Glossary
- **Template**: `{ id, name, role, persona, description, defaultModel, tier, source }`.
- **Role**: what the agent does in the pipeline: `architect`, `developer`, `qa`, `reviewer`, `researcher`.
- **Tier**: fixed permission set: `read-only` (architect, qa, reviewer, researcher) or `write-in-worktree` (developer). Tiers live in `packages/agent-engine/agents/tiers/*.json`, reviewed code, never in templates.

## Requirements

### Requirement 1: Catalogue

#### Acceptance Criteria
1. THE engine SHALL ship a local catalogue (`config/catalogue/*.json`) with at least one template per role, including two alternatives for some roles (e.g. a strict QA and a fast QA).
2. `GET /catalogue` SHALL list templates with role, tier, default model, source and whether it is built-in or imported.

### Requirement 2: Hire, rename, fire

**User Story:** As the user, I want to choose who works on each project.

#### Acceptance Criteria
1. `POST /projects/:id/team` SHALL hire a template into a project's team with a display name and a model chosen from the models available to the account (`kiro-cli chat --list-models`), validated against the role's allowed models list.
2. A team SHALL always keep at least one `architect`-role and one `developer`-role member while it has jobs enabled; firing the last one SHALL be refused with an explanation.
3. Firing SHALL be refused while that agent is working; renaming and changing the model SHALL apply to the next job.
4. The team SHALL be stored per project in `data/teams.json`; hiring, firing and renaming SHALL appear in the activity terminal.
5. The role agent file used by kiro-cli SHALL be generated from the tier file plus the template persona; the generated file SHALL be validated with `kiro-cli agent validate`, and a test SHALL assert its permission rules equal the tier's exactly.

### Requirement 3: Import templates from trusted sources

**User Story:** As the user, I want new kinds of agents from the internet without risking my projects.

#### Acceptance Criteria
1. Imports SHALL be allowed only from sources listed in `config/catalogue-sources.json` (HTTPS URLs; empty by default); any other URL SHALL be refused.
2. An imported file SHALL be parsed as a template; any `tools`, `permissions`, `mcpServers`, `hooks`, `resources` or unknown fields SHALL be dropped and listed to the user as "ignored for safety".
3. Persona and description SHALL be capped (2 000 and 300 characters), scanned for leaks, and reviewed for prompt-injection patterns ("ignore previous instructions", tool or permission requests, exfiltration requests) by fixed patterns and by the `agentlife-import-review` agent (read-only tier, empty directory; `agentlife-security` is not used because it can write and run git, see D10 in `docs/risks-and-decisions.md`); the review result SHALL be shown to the user.
4. AN imported template SHALL become hireable only after the user approves it in the HR panel; the approval SHALL be stored with the template's content hash, and any change to the content SHALL require a new approval.

### Requirement 4: HR office and HR agent

#### Acceptance Criteria
1. THE HR office room SHALL have an HR desk (panel: catalogue, teams per project, import queue) and an HR ghost.
2. THE HR agent (read-only tier, cheap model) SHALL answer "suggest a team for <project>" with a proposal based on the project's stack and size, which the user can apply with one click (it never hires on its own).
3. Hired agents SHALL appear on their project's floor: the first member of a role that has a desk (architect, developer, qa) at that desk, every other member (a second developer or QA, a reviewer, a researcher, the Night intern) standing at one of the floor's spots near the desks; a fired agent SHALL walk to the elevator and leave. Every member of a team (up to 8) is visible on its floor.

### Requirement 5: Tests

#### Acceptance Criteria
1. Property test: for any template content (random fields, nested objects, long strings), the generated agent file's permissions equal the tier's.
2. Import: non-allowlisted URL refused; dangerous fields dropped; approval invalidated by a content change.
3. Team rules: last architect/developer cannot be fired; working agent cannot be fired.

### Requirement 6: Local intern (free model)

**User Story:** As the user, I want a cheap helper for small tasks, so that simple work does not spend Kiro credits.

#### Acceptance Criteria
1. THE catalogue SHALL include a "Night intern" template (role `researcher`, tier `read-only`) whose runtime is the local Ollama endpoint (`OllamaRuntime` with a fallback wrapper, `qwen3.5:4b` by default; `LlmRuntime` is the ambient chatter and is not used, see D11) instead of kiro-cli.
2. THE intern SHALL be usable only for read-only steps that need no tools: summaries, morning overviews, memory proposals, classification; the engine SHALL refuse to assign it to plan, develop or review steps.
3. WHEN Ollama is not running, steps assigned to the intern SHALL fall back to `claude-haiku-5.5` and the report SHALL say so.
