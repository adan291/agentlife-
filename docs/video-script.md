# Video script (under 3 minutes)

Target length: 2 min 40 s, so the cut stays under the 3-minute limit. Record the screen with the demo build and the live engine. Music must be CC0 or the author's own and listed in [ASSETS.md](../ASSETS.md).

| Time | Scene | On screen | Narration |
|---|---|---|---|
| 0:00 – 0:15 | Problem | Title card, then a plain code editor with a failing test | "Coding agents write code fast, but you still have to trust it. Who checked the plan, the tests, the review?" |
| 0:15 – 0:30 | Idea | The isometric room, AGENT LIFE logo | "AGENT LIFE is a virtual hotel where the residents are AI agents. Furniture is the interface." |
| 0:30 – 0:50 | Live room | Walk the avatar to the computer, open the panel, pick the haunted-todo repository | "The computer starts a job. I pick a repository from an allowlist and write a goal." |
| 0:50 – 1:05 | Real run | Replay at 4×: the Architect walks to the board, the plan appears | "Three agents: an Architect that plans, a Developer that edits a worktree, and a QA engineer that reviews. The Architect is read-only." |
| 1:05 – 1:20 | Human gate | Mailbox opens, the plan is shown, click Approve | "Nothing changes until I approve the plan in the mailbox." |
| 1:20 – 1:40 | Verification | Board timeline, test step shows the Docker run and pass | "The Developer's diff is checked by the engine, then the tests run in Docker with no network. The model never runs the tests." |
| 1:40 – 2:00 | Report | Mailbox report: headings, the diff, the test log, QA verdict | "The report comes back to the mailbox with the real diff, the test log and the review." |
| 2:00 – 2:20 | Kiro usage | Split screen: `.kiro/specs/demo-replay/tasks.md`, `.kiro/steering/workflow.md`, `.kiro/agents/agentlife-builder.json` | "Kiro built this project from specs. Steering keeps every session on the same rules, and custom agents have explicit file and shell permissions." |
| 2:20 – 2:35 | Kiro in the product | `packages/agent-engine/src/runtimes/kiro-cli.ts` with `--v3`, the agent file with `permissions.rules` | "The product's own agents run as headless kiro-cli processes. No trust flags, and every grant is in an agent file." |
| 2:35 – 2:40 | Close | Demo URL and repository URL on a plain background | "Try it at the demo link. The code and Kiro usage notes are in the repository." |

## Notes for recording

- Show the banner "Replay of a real run recorded on <date>" at least once, and say it is a replay. Judges must know it is not live.
- Use the demo build (`?mode=demo`) for the recording so no local services are needed. Keep the speed at 4× outside the report and at 1× for the approval.
- Cut any waiting. The run takes about 70 to 80 seconds live, so the replay should be trimmed, not sped past the approval.
- If a scene runs long, cut the Kiro usage scene first. Never cut the approval gate or the Docker check: they are the point of the project.
- Subtitles in English. Keep on-screen text short.
