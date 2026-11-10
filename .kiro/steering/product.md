# Product: AGENT LIFE

AGENT LIFE is an isometric virtual hotel, inspired by early-2000s browser social sims, whose residents are real AI agents doing verifiable software work. It is our Kiroween 2026 entry (category: Resurrection). Deadline: 2026-12-04 14:00 PT; feature freeze 2026-12-01.

## MVP (see docs/mvp-roadmap.md)
- One room, one user avatar, three agents: Architect, Developer, QA.
- Furniture is the UI: computer = start a job, mailbox = approvals and reports, board = job timeline.
- One real pipeline on an allowlisted test repo: Architect plans → human approves → Developer edits a worktree → engine runs tests in Docker → QA reviews → report in mailbox.
- Public demo URL runs in replay mode from a recorded real run.

## Out of scope for the MVP
Extra rooms, multiplayer, accounts, RAG/library, fridge/TV/lab, arbitrary repos, push/PR/merge by agents, Discord inside the product, room editor, avatar creator. Do not add these unless the user explicitly asks.

## Language
- User-facing text (UI, README, demo, Devpost material) is in English.
- Internal docs in docs/ may be in Spanish.
