# Assets and third-party code

Every third-party asset or copied source file is listed here with its source and licence (CC0 or MIT only). No Habbo (Sulake) graphics, sounds, names, code or trade dress are used. All sprites, icons, furniture and characters are drawn in code using PixiJS primitives (rectangles, circles, lines, text); none are traced from or derived from any external image or game asset.

## Third-party npm packages

Runtime and development dependencies are listed in `package.json` / `pnpm-lock.yaml`. Each is used under its own licence (MIT unless noted in its `package.json`). Key runtime dependencies:

| Package | Licence | Used for |
|---|---|---|
| `pixi.js` | MIT | 2-D rendering (client) |
| `vite` | MIT | Build tool (client) |
| `zod` | MIT | Schema validation (shared, engine, world-server) |
| `@playwright/test` | Apache-2.0 | End-to-end browser tests |
| `better-sqlite3` | MIT | SQLite event log (agent-engine) |
| `fast-check` | MIT | Property-based tests |
| `ws` | MIT | WebSocket server (world-server) |

A full list with exact versions is in `pnpm-lock.yaml`.

## Fonts

The UI uses the browser's default monospace font (`font: inherit` / `monospace`). No web font is loaded or bundled.

## Sounds

None. The hotel has no audio.

## Original work

All sprites, furniture, room layouts, ghost characters, outfit parts, the isometric geometry (`packages/shared/src/geometry.ts`) and the visual style were designed and implemented from scratch for this project. No existing game, tileset or sprite sheet was used as a reference or base.
