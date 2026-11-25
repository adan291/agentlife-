# Architecture

How AGENT LIFE is put together, and the rules that keep it that way. `scripts/test/architecture.test.ts` checks the rules on every `pnpm check`. The why of each decision is in `docs/risks-and-decisions.md` (D21 for this layout).

## Style: a modular monolith per process, ports and adapters at the edges
Four packages, three processes. Each process is one program split into feature modules. Where the outside world comes in (AI providers, Docker, files, HTTP, the browser), there is an interface (a port) with one or more adapters behind it. There are no full hexagonal layers inside each module: for a project of this size they would mostly add code that only passes calls along.

```
client (browser)  --WebSocket, @agentlife/shared protocol-->  world-server  --HTTP + SSE, engine-api-->  agent-engine
                                                                                                  |-- AgentRuntime: kiro-cli, OpenAI-compatible, fake
                                                                                                  |-- DockerExec: test sandbox
                                                                                                  '-- Store: SQLite event log
```

| Package | What it is | Its ports |
|---|---|---|
| `shared` | The contract: zod schemas of the protocol and the engine API, pure rules (geometry, sim, bugs, progress) | none; no node imports except `leaks.ts` and `bugs-node.ts`, which are separate entry points |
| `client` | Vite + PixiJS front end | `Transport` (live WebSocket or recorded replay) |
| `world-server` | The hotel: rooms, sessions, the game layer, and the mirror of the jobs | `EngineLink` (HTTP engine or fake engine), stores (layouts, wallet, progress, outfits, bugs) |
| `agent-engine` | Jobs, agents, tests, reports | `AgentRuntime`, `DockerExec`, `Store`, HTTP routes |

## The world-server gateway
`world-server/src/gateway.ts` builds the features, connects them and owns the one WebSocket connection: origin check, rate limit, message validation, routing, timers' lifetime. Everything else is in `world-server/src/gateway/`:

- `context.ts`: what every feature shares. It holds the session, the per-floor state (`Floor`), `send`, `toUser`, the ordered outbox (`enqueue`), `deliver`, and the handler table type. `wire` holds the two functions that are built late (`sendSim`, `sendWelcome`), because rooms need panels and panels need almost every feature.
- `features/<name>.ts`: one feature each. `createX(ctx, deps)` returns its functions, its `handlers` (the client messages it answers) and, when it has timers, `close`. The features are economy, outfits, bugs, wisps, team (HR and desks), mood, builder, progress, floors (floor list and overview), night, library, pipeline, projects (Reception, repos, branches, construction board), jobs, panels, rooms and arrange.
- `engine-events.ts`: what each engine event does: Ecto and XP, the room's sim, the floor's mirrored state.
- `options.ts`, `rate.ts`: the options type and the rate limiters.

Adding a feature means writing `features/<name>.ts` with its handlers, adding it to `startGateway`, and, if a welcome needs it, adding it to `rooms.ts`. A client message type belongs to exactly one feature; `mergeHandlers` throws at start when two features claim the same type.

## Rules (checked)
1. `shared` imports no other package. The client imports neither server package nor `node:`. The world-server never imports the engine.
2. `shared` has no `node:` imports outside `leaks.ts` and `bugs-node.ts`, and its index does not export them. That keeps the contract usable in a browser or a mobile bundle.
3. Only `client/src/scene/` and `client/src/main.ts` import PixiJS. Panels and state are plain DOM and TypeScript.
4. `agent-engine/src/jobs/` (the state machine) does no I/O and does not import the HTTP layer.
5. In the engine, only route files and the assembly (`engine.ts`) import `http/`. Domain code throws the errors of `errors.ts` (`BadRequestError`, `ConflictError`, `NotFoundError`), and the HTTP layer maps them to status codes.
6. A gateway feature imports another feature only as a type. It gets the real object from `startGateway`. Features and `engine-events.ts` never import `ws` values.
7. `gateway.ts` stays an assembly, under 250 lines.

## Toward an app (not built)
- **Desktop or mobile wrapper of the web client** (Tauri, Capacitor): this needs no change to the structure.
- **A native UI**: move the panels' state and logic into a `client-core` package. Rule 3 already keeps PixiJS out of them.
- **Several devices at once**: `Session` becomes one per connection instead of `ctx.session()`. Only the context and the features that read the session change (they all go through `ctx`).
- **A versioned protocol**: `hello` already carries `PROTOCOL_VERSION`. Before two client versions have to live together, add a supported range instead of exact equality.
- **Remote access**: authentication on the WebSocket and the engine token are needed before the world-server listens beyond loopback.
