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
3. Persona and description SHALL be capped (2 000 and 300 characters), scanned for leaks, and reviewed by the `agentlife-security` agent for prompt-injection patterns ("ignore previous instructions", tool or permission requests, exfiltration requests); the review result SHALL be shown to the user.
4. AN imported template SHALL become hireable only after the user approves it in the HR panel; the approval SHALL be stored with the template's content hash, and any change to the content SHALL require a new approval.

### Requirement 4: HR office and HR agent

#### Acceptance Criteria
1. THE HR office room SHALL have an HR desk (panel: catalogue, teams per project, import queue) and an HR ghost.
2. THE HR agent (read-only tier, cheap model) SHALL answer "suggest a team for <project>" with a proposal based on the project's stack and size, which the user can apply with one click (it never hires on its own).
3. Hired agents SHALL appear on their project's floor at their desk; a fired agent SHALL walk to the elevator and leave.

### Requirement 5: Tests

#### Acceptance Criteria
1. Property test: for any template content (random fields, nested objects, long strings), the generated agent file's permissions equal the tier's.
2. Import: non-allowlisted URL refused; dangerous fields dropped; approval invalidated by a content change.
3. Team rules: last architect/developer cannot be fired; working agent cannot be fired.
