# Design Document: hr-desk

- `agents/tiers/read-only.json`, `agents/tiers/write-in-worktree.json`: the only source of `tools` and `permissions.rules` (today's role agent files are split into tier + persona).
- `src/team/generate.ts`: `agentFileFor(member, template, tier)` → `{ name, description, prompt: persona + role instructions, model, tools: tier.tools, permissions: tier.permissions }`; written to `data/kiro-home/agents/<projectId>-<memberId>.json`; `kiro-cli agent validate --path` on write.
- `src/team/store.ts`: `data/teams.json` `{ [projectId]: Member[] }`, `Member { id, displayName, templateId, role, model }`; default team created on registration.
- `src/team/import.ts`: fetch only allowlisted URLs (HTTPS, 64 KB cap, 10 s timeout), parse with a strict zod schema after copying only known safe fields, `leaks.scanText`, then queue for review; `review.ts` runs `agentlife-security` with a fixed prompt and stores its verdict; approval stores `sha256(content)`.
- Pipeline integration: the JobRunner resolves each role step to the team member with that role (first one), so a project can run with a renamed or differently modelled agent; `reviewer` and `researcher` roles are used by pipeline-editor.
- Client: `ui/hr.ts` (tabs: Catalogue, Teams, Imports), HR ghost tooltip; floors show members by display name.
