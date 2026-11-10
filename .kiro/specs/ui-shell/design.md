# Design Document: ui-shell

## Layout

```
┌──────────────────────────── top bar (48 px) ───────────────────────────┐
│ AGENT LIFE   [status]        Plan ✓ › Approve › Build › …      1× A− A+ ?│
├──────────┬─────────────────────────────────────────────────────────────┤
│ side bar │ stage (canvas fills it; toast, tooltips, guide, panels       │
│ 240/52px │ are absolutely positioned inside the stage)                  │
├──────────┴─────────────────────────────────────────────────────────────┤
│ dock: Activity  [filter] [hide]          (32 px collapsed / resizable)  │
└─────────────────────────────────────────────────────────────────────────┘
```

```css
.al-shell { display: grid; height: 100vh; width: 100vw;
  grid-template-columns: var(--side-w) 1fr;
  grid-template-rows: 48px 1fr var(--dock-h);
  grid-template-areas: "top top" "side stage" "dock dock"; }
```

`--side-w` and `--dock-h` are set from state by `shell.ts`; nothing else positions shell regions.

## Modules (`packages/client/src/`)

- `ui/shell.ts`: builds the grid, exposes `topBar`, `side`, `stage`, `dock` elements; `shellTemplate(state, viewport)` is a pure function returning `{ sideW, dockH, sideCollapsed, dockCollapsed, compactStepper }` (tested). Persists user choices; applies breakpoints on resize.
- `main.ts`: `app.init({ resizeTo: stage })` is not enough for grid cells on all browsers, so a `ResizeObserver` on `stage` calls `app.renderer.resize(w, h)` and `world.layout()`.
- `scene/world-view.ts`: remove the free-viewport subtraction from room-fixes; fit uses `app.screen`, which now equals the stage.
- Existing components (`team-bar.ts`, `terminal.ts`, `stepper.ts`, `hud.ts`) mount into their region instead of `document.body`, and drop their `position: fixed`, `top/left/right/bottom` and z-index rules. `toast.ts`, `tooltip.ts`, `guide.ts`, `panels.ts` mount into `stage` with `position: absolute`.
- `ui/theme.ts`: spacing scale, radius, border, shadow, focus ring as custom properties; button states.

## Testing

- Vitest: `shellTemplate` table tests for every combination and breakpoint.
- Playwright (`packages/client/e2e/shell.spec.ts`, run with `pnpm --filter @agentlife/client e2e`, not part of `pnpm check` because it needs a browser): start Vite preview with a fake transport (`?transport=fake`, a tiny in-browser fake that sends a static welcome), then check bounding boxes at the three sizes. If adding the fake transport is larger than a few dozen lines, test with the world-server started by the test instead.
