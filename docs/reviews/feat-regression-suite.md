# Revisión: feat/regression-suite (contra main)

Commits: 656d105 (tarea 1), d9e8a2a (tarea 2), d84b7ca (tarea 3).
Spec: `.kiro/specs/regression-suite/` (requirements, design, tasks: 3 de 3 marcadas).

## Veredicto

Aprobar. No hay problemas bloqueantes.

`pnpm check` pasa: shared 485, world-server 455, client 761, agent-engine 682 (7 omitidos), scripts 19.

No se ejecutó la suite Playwright en esta revisión; se revisó su código y su configuración.

## Bloqueantes

Ninguno.

## Requisitos marcados como hechos y no cumplidos

Ninguno detectado en el código. El paso del conductor (`runBrowserTests` en `scripts/conduct.ts`) no se ejecutó de extremo a extremo; el design.md ya lo dice.

## Tests que faltan

- `scripts/conduct.ts` `runBrowserTests`: solo se prueba `summarizeE2e` y `describeE2e` (`scripts/test/e2e-report.test.ts`). La decisión de parar el conductor (fallo, informe ausente, retry con éxito) no tiene test.
- `summarizeE2e` cubre el caso `flaky`, `failed` y `skipped`, pero no un informe sin suites o con suites anidadas de varios niveles.

## Sugerencias no bloqueantes

1. `.github/workflows/ci.yml`: `on.push` ya no tiene `branches`. CI corre en cada rama y en cada etiqueta, además de en cada `pull_request`, así que cada rama abierta se ejecuta dos veces. Conviene limitar `push` a `main` o a `feat/**` y dejar `pull_request` como está.
2. `packages/client/playwright.config.ts`: los archivos de `tmpdir()` tienen nombres fijos y se reescriben al cargar la configuración. Dos ejecuciones a la vez (por ejemplo el conductor y una prueba manual) se pisan. Un sufijo con `process.pid` o una carpeta temporal por ejecución lo evita.
3. `reuseExistingServer: !process.env["CI"]`: en local, un servidor que ya esté en el puerto 8795 o 8796 se reutiliza con su propio estado. Ya está documentado en STATUS; un aviso al arrancar sería más seguro.
4. `scripts/conduct.ts`: el informe JSON se escribe en `tmpdir()` con el pid. Está bien, pero el archivo queda si `sh` lanza una excepción antes de `rmSync`. Un `try/finally` lo cubre.
5. `docs/STATUS.md` dice que CI ejecuta el job `browser` en Linux y Windows, pero la primera ejecución real en CI todavía no se ha visto. Conviene marcarlo como pendiente hasta que el job pase.
