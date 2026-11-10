# AGENT LIFE

An isometric virtual hotel whose residents are real AI agents. Click the computer, pick a repository, and watch an Architect, a Developer and a QA engineer plan, implement, test and review a real change, then collect the report from the mailbox.

Kiroween 2026 entry — category: **Resurrection**.

> Status: early development. Nothing playable yet.

## Requirements

- Node.js 22+
- pnpm (`npm install -g pnpm`)

## Run

```bash
pnpm install
pnpm check                              # typecheck + tests
pnpm --filter @agentlife/client dev     # client on http://localhost:5173
```

## Layout

| Path | What |
|---|---|
| `packages/shared` | Protocol and event schemas (zod), isometric geometry |
| `packages/client` | Vite + PixiJS front end |
| `packages/world-server` | Room state and WebSocket gateway |
| `packages/agent-engine` | Agent pipeline, runtimes, event log |
| `docs/` | Design and technology decisions (Spanish) |
| `.kiro/` | Kiro steering, specs, hooks and custom agents |

## Assets and third-party code

See [ASSETS.md](ASSETS.md). No Habbo assets or code are used.

## License

MIT — see [LICENSE](LICENSE).
