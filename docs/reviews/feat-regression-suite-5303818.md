# Review: feat/regression-suite (5303818)

## Veredicto

**Pedir cambios.** Un punto del requisito 3.1 sigue sin cumplirse y la decisión del usuario no está tomada. Lo demás está bien.

Comprobado en esta revisión:
- `pnpm check`: exit 0 (shared 485, client 761, world-server 457, engine 682 + 7 omitidos, scripts 19).
- Revisión de estructura: el cliente sigue hablando solo con el world-server; el engine no nombra tiles ni sprites; no hay `new URL(...).pathname` ni scripts con bash en `scripts/`, `e2e/` ni `.github/`.
- No ejecuté la suite Playwright completa (ya se ejecutó en la verificación anterior, y los cambios desde entonces son tests y baselines nuevos). Los dos tests nuevos de `visuals.spec.ts` no se han ejecutado en esta revisión.

## Bloqueantes

1. **Requisito 3.1 (tres tamaños para cada panel): el tablero de obra no se compara a 360x640.** `packages/client/e2e/visuals.spec.ts` líneas 331-341: `if (await openPiece(...))` salta el bloque sin fallar cuando la pieza está fuera del escenario. Ya hay baselines `construction-board-{desktop,laptop}.png` y `construction-board-report-{desktop,laptop}.png`, sin versión `phone`. El test pasa igual, y el único rastro es una anotación "skipped screen". `design.md` (línea 131) y `HUMAN-CHECKS.md` (línea 20) lo declaran como excepción, pero `requirements.md` sigue diciendo "each panel" en tres tamaños. Según la verificación anterior, esto necesita el sí del usuario. Hay dos salidas:
   - El usuario acepta la excepción: se escribe en `requirements.md` (3.1) y el test deja de depender de un `if` silencioso (por ejemplo, `expect(...).toBe(true)` con la excepción explícita, como hace `mailbox-empty`).
   - El usuario no la acepta: se busca una ruta que abra el tablero a 360x640 (por ejemplo `show_panel`, como el correo) y se añade su baseline `phone`.

   Por qué importa: la comparación visual puede desaparecer en silencio. Un cambio futuro que saque la pieza del escenario dejaría la pantalla sin comparar y la suite seguiría en verde.

   Mismo patrón en `visuals.spec.ts` línea 304 (`directory`). Hoy el directorio sí tiene baseline en los tres tamaños, así que no afecta, pero el riesgo es el mismo.

## Correcciones de la verificación anterior

- Quests del Profile: ahora se compara (`profile-quests` x 3 tamaños) con `AGENTLIFE_PROGRESS_NOW` fijado por el test. Resuelto.
- Tablero de obra y su informe: comparados a escritorio y portátil (ver bloqueante 1). Parcial.
- Fuente del botón Actions y línea de nivel repetida en el Profile: corregidas en `emotes.ts` y `profile.ts`. Son cambios de producto y deben seguir listados en `design.md` ("Bugs found"). Están listados.

## Pruebas que faltan

- Los dos tests nuevos (`construction board, its report and the Profile's quests`) no se han ejecutado de forma aislada en esta revisión. El registro de la sesión dice que pasaron tres veces; lo dejo como dato del autor.
- La decisión del conductor de parar ante un fallo del navegador (`runBrowserTests` en `scripts/conduct.ts`) no tiene test unitario. Ya lo anota `docs/regression-backlog.md`.

## Sugerencias no bloqueantes

1. `packages/world-server/src/main.ts`, bloque de `ProgressStore`: la sangría del comentario y del objeto no coincide con el resto del bloque. Un `format_code` lo corrige.
2. `packages/world-server/src/fake-panels.ts`: el archivo no termina en salto de línea (`\ No newline at end of file`).
3. `.github/workflows/ci.yml`: con `on: push` sin filtro de ramas, cada push a una rama y cada PR lanzan la matriz completa dos veces (push y pull_request). Basta con mantener `push` solo para `main` si el coste importa.
4. `.kiro/specs/regression-suite/design.md`, línea 131: párrafo de más de 600 caracteres. Partirlo facilitaría revisarlo.

## Preguntas para el usuario

- ¿Acepta que el tablero de obra no se compare a 360x640 (bloqueante 1)?
- Lo que ya figura en `HUMAN-CHECKS.md` (primera ejecución del job `browser` en un runner real, forzar un fallo visual, revisar las 109 imágenes) sigue pendiente. No lo repito aquí.
