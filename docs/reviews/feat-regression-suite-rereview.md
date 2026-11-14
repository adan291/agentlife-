# Revisión (segunda): feat/regression-suite contra main

Commits revisados: 656d105, d9e8a2a, d84b7ca, 6ab74c5, 0f8e3ee.
Spec: `.kiro/specs/regression-suite/` (3 de 3 tareas marcadas).
Esta revisión no sustituye a `feat-regression-suite.md`, que aprobó antes de la verificación FAIL. Ese archivo queda como historial.

## Veredicto

Pedir cambios por un punto: requisito 3.1. Se puede aprobar si el usuario acepta acotar 3.1.

`pnpm check` pasa: shared 485, world-server 455, client 761, agent-engine 682 (7 omitidos), scripts 19.
No se volvió a ejecutar la suite Playwright; se revisó el código y el estado registrado en STATUS.

## Bloqueantes

1. **Requisito 3.1 sin cumplir como está escrito.** `requirements.md` (línea 29) pide comparar "each room ... and of each panel". `packages/client/e2e/visuals.spec.ts` compara 4 salas y unos 20 paneles, pero faltan: night board, Library, review desk, test lab, directory, coffee machine, pipeline editor, HR imports, y el buzón vacío a 360x640 (`docs/regression-backlog.md`, última línea). El spec no cambió. La reducción solo aparece en `design.md` y como pendiente en `docs/STATUS.md`.
   Hay dos salidas, y la elección es del usuario:
   - (a) Aceptar la reducción. Entonces se edita `requirements.md` para decir qué paneles se comparan y se anota la decisión en STATUS.
   - (b) Añadir los paneles que faltan. Cada uno necesita datos scriptados (`FAKE_*` en el motor falso) y un `expectLooksLike` por tamaño.

## Requisitos verificados de nuevo

- 3.1 paneles de trabajo en curso: ahora sí cubiertos. El test "panels of a job: activity, plan, job card, report" compara activity, plan, job card, mailbox con informe y report, con tiempos, duraciones y saldo enmascarados (`support/visual.ts`, `timeMasks`).
- 5.1 lista humana: cumple. Queda una sola lista de 13 ítems en `docs/HUMAN-CHECKS.md`. Los ítems "podría ser un test" están en `docs/regression-backlog.md`.
- 5.2 README y STATUS: cumplen. STATUS tiene una línea desactualizada (ver sugerencia 3).
- 4.1, 4.2, 4.3, 3.2, 3.3, 2.x y 1.x: sin cambios desde la revisión anterior. Las cifras de ejecución de la verificación previa (129 tests, `e2e:demo` 1/1) no se repitieron aquí.

## Tests que faltan

- `scripts/conduct.ts` `runBrowserTests`: no hay test de la decisión de parar (fallo, informe ausente, reintento que pasa). Solo se prueban `summarizeE2e` y `describeE2e`. Ya figura en `regression-backlog.md`.
- `summarizeE2e` no cubre un informe sin suites ni con suites anidadas de varios niveles.

## Sugerencias no bloqueantes

1. `.github/workflows/ci.yml`: `on.push` ya no tiene `branches`. Cada rama con un pull request corre el CI dos veces (push y pull_request). Limitar `push` a `main` y `feat/**`, o dejar solo `pull_request`.
2. `packages/client/playwright.config.ts` (líneas 11 a 55): los archivos temporales tienen nombres fijos. Dos ejecuciones a la vez (el conductor y una prueba manual) se pisan. Un sufijo con `process.pid` lo evita.
3. `docs/STATUS.md` línea 75: "Screens that need a running job are not compared" ya no es cierto tras 0f8e3ee. Quitar esa frase.
4. Un test falló una vez en una ejecución completa y no se identificó. El conductor lo registra como flaky en `data/sessions/log.md`. Conviene vigilarlo en la primera ejecución en CI.
5. La primera ejecución real del job `browser` en GitHub está pendiente. Queda como comprobación humana.
