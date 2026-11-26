# Devpost submission (draft)

Paste each section into the Devpost form. The numbers were counted from the repository on 2026-11-24.

**Name:** AGENT LIFE
**Tagline:** An isometric hotel whose residents are real AI agents doing verifiable software work.
**Category:** Resurrection
**Links:** demo https://adan291.github.io/agentlife-/ · code https://github.com/adan291/agentlife-

## Inspiration
Early-2000s browser hotels were places where you walked a small avatar between rooms, sat on furniture and watched other people live. Today's AI coding agents work in terminals and chat panes, where you cannot see who is doing what or why. We brought the old hotel back as the office of a team of agents. Each agent has a desk, the furniture is the interface, and every job has to leave proof that it works.

## What it does
- **Register a git project** at the Reception in the lobby. It gets its own floor with an Architect, a Developer and a QA desk.
- **Describe a change** at the floor's computer. The Architect reads the code and writes a plan, and the plan waits in the mailbox for your approval.
- **After approval,** the Developer edits an isolated copy of the project. The engine checks the diff (paths, size, no binaries) and runs the project's tests in Docker with no network and resource limits. QA then reviews the diff together with the test log.
- **The report arrives in the mailbox:** the plan, the diff, the tests and the review verdict. Deliver turns the job into an `agentlife/<task>` branch in your repository. The hotel never merges, pushes or touches your working copy.
- **Other job kinds:** review a branch, write tests, document, audit dependencies, and a night shift that runs pre-approved jobs and leaves a morning summary.
- **The team is yours to shape.** The HR office hires, renames, re-models and fires agents from a catalogue. The pipeline editor adds a research step or a second review, and the Library keeps notes the team learnt for the next jobs.
- **Any AI, several at once.** Kiro is the default. A role or a single hired member can run on Ollama, LM Studio, Groq, xAI Grok, OpenAI or OpenRouter instead, and one job can mix them. The public demo replays a real run in which all three agents used a 4B model on a laptop through Ollama.
- **Waiting is a game.** Ecto is earned only from verified work (a passed job, a delivered branch) and spent on furniture and outfits. XP, levels, badges and daily quests come from real stats. Wisps to catch, emotes and a coffee machine for tired agents fill the time while a job runs.

## How we built it
- **Stack:** TypeScript end to end, about 37,000 lines in four packages.
  - `shared`: zod schemas for the protocol and the engine API, the isometric geometry and the room simulation.
  - `client`: Vite and PixiJS, with every sprite drawn in code and no image files.
  - `world-server`: rooms, the game layer and a mirror of the jobs.
  - `agent-engine`: the job state machine, the runtimes, the Docker sandbox and an SQLite event log.
- **Kiro built it.** 28 specs went from requirements to design to tasks, with steering files for the rules every session follows. The repo has 3 hooks, among them a push guard that runs a leak scanner before any `git push`, and 4 custom agents: a builder, a reviewer, a security officer and an acceptance verifier. A conductor script ran unattended build sessions with `kiro-cli` on the TASKMAP, and Kiro Crew on Discord continued the same thread away from the desk. Details are in `docs/kiro-usage.md`.
- **Kiro runs it.** The product's agents are headless `kiro-cli` processes. Each one is limited by its agent file: Architect and QA are read-only, and the Developer may write only inside its worktree and has no shell or network.
- **Tests:** about 2,700 Vitest tests, with fast-check properties for the geometry, pathfinding, the job state machine, diff validation and the replay schedule. On top of that, 164 Playwright tests cover user journeys, layout rules at three window sizes and 127 screenshot comparisons, plus a test that checks the architecture's layering rules.

## Challenges we ran into
- **Keeping agents in their lane.** We checked first, in a spike, that `kiro-cli --v3` denies writes outside the working folder. For the other AI providers there is no such guarantee, so the engine itself is the sandbox there. The model only gets four file tools, run inside the job's folder with the same deny list. There is no shell and no network.
- **Small local models.** A 4B model read the same ten lines twenty times, or answered in prose without the required JSON. The tool loop now refuses repeated calls, asks for the answer before the round limit and reminds once about the format. After that the recorded job went from plan to PASS.
- **One file doing everything.** The WebSocket gateway grew to 1,900 lines. We split it into 17 feature modules with no change in behaviour, and the 514 server tests passed untouched.
- **Credits.** The month's Kiro credits ran out before the end, so the hotel had to work without them. That is how the multi-runtime spec came about.

## Accomplishments that we're proud of
- Every claim in a report is backed by something the engine checked itself: the diff, the Docker test log, the review. Ecto and XP are counted only from those facts.
- The same pipeline runs on Kiro or entirely on a laptop with a local model.
- Nothing leaves the machine without passing the leak scanner, and the git history was cleaned of personal data twice.

## What we learned
- Specs and a status file kept in the repository let many short sessions, some of them unattended, build one coherent product.
- The engine should be the judge, not the model. Format checks, sandboxed tests and diff validation matter more than the prompt.

## What's next
- **Errors from your own applications.** Any application with a Sentry SDK (Java, Spring Boot, Node and others) would send its errors to its floor's bug trap. The agents would diagnose each one with evidence checked against the code, and fix it with a regression test that fails before the fix and passes after. The protocol and offline Maven tests were already validated (spec `app-bugs`).
- **A Tickets room** that turns Jira or GitHub issues into jobs.
- **Several devices at once** and a desktop or mobile wrapper. The architecture rules already keep the core portable.

## Built with
TypeScript, Node.js, PixiJS, Vite, zod, Vitest, fast-check, Playwright, SQLite, Docker, Kiro (IDE, specs, steering, hooks, custom agents, kiro-cli, Kiro Crew), Ollama.

## Testing instructions (Devpost field)
No login is needed.
1. **The demo, nothing to install:** open https://adan291.github.io/agentlife-/ . It replays a real run on the `haunted-todo` project, recorded with all three agents on a local model. Open the computer, start the job, approve the plan in the mailbox, and watch the Developer, the Docker tests and the QA review. Speed buttons: 1x, 4x, 16x.
2. **The whole hotel on your machine, no keys and no Docker:** Node.js 22 and pnpm, then `pnpm install` and `pnpm hotel --fake`. It opens http://localhost:5173/ with scripted agents: shop, HR office, floors, Edit room, wisps, Profile and the Bug sack all work.
3. **Real agents, optional:** `pnpm hotel --ai ollama --model qwen3.5:4b` with Ollama running and Docker started, or `pnpm hotel` with a `KIRO_API_KEY` in `.env`. Register a git project under `D:\AgentHotel` (or the folder in `config/hotel.json`) at the Reception.
4. **Tests:** `pnpm check` (about 2,700 unit and property tests) and `pnpm --filter @agentlife/client e2e` (164 browser tests).

## Category and bonus prizes
- **Category:** Resurrection. The early-2000s browser hotel, with its avatars, furniture and rooms, brought back as the office of real AI agents.
- **Bonus:** Blog post and Social Blitz, if published (add the links). Ghost of Kiroween Past only if the developer registered for Kiroween 2025.

## Pre-existing work
None. The first commit is dated 2026-11-10, after the submission period opened on 2026-10-30. Third-party packages are listed in ASSETS.md; every sprite, icon and layout is drawn in code. No third-party game assets or code were used.

## How Kiro was used (Devpost field; the long version is docs/kiro-usage.md)
- **IDE, CLI, Web, Crew:** the IDE for steering, reviewing and the multi-runtime, gateway-split and video-recorder work; `kiro-cli` for the product's agents and for unattended build sessions run by a conductor script; Kiro Crew for the same thread on Discord. Web was not used.
- **Custom agents:** four (builder, reviewer, security officer, acceptance verifier). The verifier failed the regression-suite spec twice until the missing panels were compared, which found two real interface bugs.
- **Hooks:** three; the push guard runs a leak scanner before any `git push`.
- **Specs vs vibe coding:** 28 specs with acceptance criteria let the conductor build and verify unattended. The two pieces built in chat without a spec were safe where tests already existed (the gateway split, 514 tests untouched) and surprising where they did not (the video recorder).
- **Steering:** five files; the repository is the memory, and a short `docs/STATUS.md` is read first in every session.
- **MCP and powers:** not used by the project.
- **Property-based tests:** fast-check on geometry, pathfinding, the job state machine, diff validation, the replay schedule, bug fingerprints, masking and the file-tool sandbox.