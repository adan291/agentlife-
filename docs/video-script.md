# Video script (under 3 minutes)

Target: 2 min 40 s. Record the screen with the live engine and DiscordIA (or the demo replay for the final cut). Music: CC0 or your own; list it in ASSETS.md.

## Scenes

| Time | Scene | What to show | Narration |
|---|---|---|---|
| 0:00–0:12 | Hook | A pull-request queue, a Jira backlog, an empty code editor | "AI agents write code fast. But who checked the plan? Who ran the tests? Who reviewed the diff?" |
| 0:12–0:22 | The idea | AGENT LIFE logo, the lobby of the hotel with the elevator and the shop counter | "AGENT LIFE is an isometric virtual hotel. The residents are real AI agents. Furniture is the interface." |
| 0:22–0:35 | Register a project | Reception desk, fill in the path `D:\AgentHotel\DiscordIA`, confirm | "Register a git project. The hotel creates a floor for it." |
| 0:35–0:50 | Start a job | Elevator → DiscordIA floor, computer desk, type a goal, press Start | "Pick the floor, open the computer, describe the change. That is the whole UI." |
| 0:50–1:05 | Architect at work | Architect ghost walks to the board, activity terminal fills up | "The Architect reads the repository and writes a plan. It is read-only: it cannot change a file." |
| 1:05–1:18 | Human gate | Mailbox opens, plan appears, press Approve | "Nothing is built until you approve the plan. This is the only mandatory human step." |
| 1:18–1:38 | Build and test | Developer ghost at the desk, terminal lines, Docker icon, test log | "The Developer edits a worktree. No shell, no network. The engine validates the diff, then runs the tests in Docker with network disabled and resource limits." |
| 1:38–1:52 | QA and report | QA ghost at the desk, mailbox badge, open report: diff, test log, QA verdict, Deliver button | "QA reviews the diff and the log. The report arrives in the mailbox. Press Deliver to get a branch in your repository. Your working copy stays untouched." |
| 1:52–2:08 | The game layer | Shop counter with Ecto balance, buy a hat, put it on the Developer ghost in HR, wisp floating on the floor | "While the agents work you earn Ecto from verified results. Spend it on outfits and furniture. Catch the wisps." |
| 2:08–2:22 | Kiro as the builder | `.kiro/specs/agent-pipeline/tasks.md`, `.kiro/steering/workflow.md`, the construction board in the lobby | "Kiro built this product from specs. Each session follows steering rules, commits one task at a time and verifies before merging. The construction board shows the live TASKMAP." |
| 2:22–2:36 | Kiro in the product | `packages/agent-engine/src/runtimes/kiro-cli.ts`, an agent file with `permissions.rules` | "The hotel's own agents run as headless kiro-cli processes. No trust flags. Every permission is in a file you can read." |
| 2:36–2:40 | Close | Demo URL and repo URL on a dark background | "Try the demo. The code and the Kiro usage notes are in the repository." |

## Automatic recording
`pnpm --filter @agentlife/client video` (Windows, Edge) plays these scenes by itself and writes `data/video/agentlife.webm` (1280×720, about 2 min 35 s) and `data/video/agentlife.srt` (English subtitles).
- The job scenes come from the demo build, a replay of a real run. The Reception, shop, HR and wisp scenes come from a scripted hotel whose wallet and wardrobe are scratch files.
- The narration is the Windows voice "Microsoft Zira" (en-US) and is mixed into the file. To use your own voice, record over the picture and drop the generated audio.
- The words are in `packages/client/video/record.spec.ts` (`LINES`), and the scene order follows the table above.
- The HR scene shows the model "fake", because the scripted hotel has no real models.

## Recording notes

- Use the demo replay (`?mode=demo` or `?autostart`) for the final cut so no local services are needed. Record the live run first to get the story, then re-record the UI parts at a good pace.
- Show the "Replay of a real run" banner at least once so judges know it is a replay.
- Keep the speed at 4× for the analysis and develop phases, 1× for the approval and the report.
- If a scene runs long, cut the game-layer scene first. Never cut the approval gate or the Docker check.
- The Bug sack is a bonus: show it quickly at the end if time allows (F8 → note → panel).
- Subtitles in English. Keep on-screen text short.
- Suggested tools: OBS Studio (CC0), DaVinci Resolve free, or Kap (macOS).
