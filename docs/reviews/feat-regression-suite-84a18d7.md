# Revisión: feat/regression-suite en 84a18d7 (contra main)

Commits: 656d105 (tarea 1), d9e8a2a (tarea 2), d84b7ca (tarea 3), y las correcciones posteriores hasta 84a18d7.
Spec: `.kiro/specs/regression-suite/` (requirements, design, tasks: 3 de 3 marcadas).

## Veredicto

Request changes, por un punto pequeño de la requisito 3.1 (ver "Bloqueantes"). Lo demás está bien.

`pnpm check` pasa: shared 485, world-server 457, client 761, agent-engine 682 (7 omitidos), scripts 19.

No se ejecutó la suite Playwright en esta revisión; se revisó su código y su configuración.

## Bloqueantes

1. **Requisito 3.1, "each panel" no se cumple del todo.**
   - `packages/client/e2e/visuals.spec.ts`: la pestaña Quests del Profile no se compara. El documento de estado ya lo dice porque la fecha elige las misiones. Hace falta fijar la fecha en el test (o el seed de misiones) y añadir la comparación.
   - La bandeja de correo vacía a 360x640 se salta (`visuals.spec.ts`, anotación "skipped screen"). El requisito pide los tres tamaños para cada panel. Hace falta una ruta que abra la bandeja en ese tamaño (por ejemplo el mensaje `show_panel`, como indica el comentario), o una decisión del usuario para aceptar la excepción y dejarla escrita en requirements.md.

## Requisitos marcados como hechos y no cumplidos

- Tarea 3 / requisito 4.1: `scripts/conduct.ts` `runBrowserTests` decide si para el conductor. No hay test de esa decisión (ver "Tests que faltan"). El paso no se ejecutó de extremo a extremo; design.md lo indica.
- `docs/STATUS.md` dice 71 imágenes de referencia en `e2e/__visuals__/win32/`. Hay 102. El número del documento está desactualizado.

## Tests que faltan

- `scripts/conduct.ts` `runBrowserTests`: sin test para parar con fallo, con informe ausente, o con un reintento que pasa. Solo prueban `summarizeE2e` y `describeE2e` (`scripts/test/e2e-report.test.ts`).
- `summarizeE2e`: sin caso para un informe sin suites o con suites anidadas de varios niveles.

## Comprobaciones sin hallazgos

- Límites: el cliente solo habla con el world-server. Los journeys redirigen el WebSocket a un world-server propio de la prueba (`support/hotel.ts`). El world-server no llama a ningún modelo.
- Motor de prueba: `deliverBranch` en `packages/world-server/src/fake-engine.ts` no toca git. Solo cambia el estado en memoria.
- Portabilidad: sin `new URL(...).pathname` como ruta. Los scripts nuevos (`e2e:update-visuals`, `playwright test`) no usan bash. Las rutas usan `node:path` y `fileURLToPath`.
- Seguridad: no aparece "Habbo" en el código ni en la documentación de la rama. Las imágenes nuevas son capturas de la propia aplicación. No se imprimen secretos en los logs del conductor.

## Sugerencias no bloqueantes

1. `support/hotel.ts`: el proceso hijo hereda todo `process.env`, incluido `KIRO_API_KEY` si está en el entorno. Un `env` con solo las variables necesarias es el mínimo privilegio.
2. `.github/workflows/ci.yml`: `on.push` sin `branches` y `pull_request` ejecutan la suite dos veces en cada PR. Cumple el requisito 4.2 tal como está escrito; conviene limitar `push` a `main` si el coste de CI importa.
3. `scripts/conduct.ts`: si `sh` lanza una excepción antes de `rmSync(jsonFile)`, el informe queda en `tmpdir()`. Un `try/finally` lo evita.
4. La primera ejecución del job `browser` en un runner real de GitHub no se ha visto. Hasta entonces, la afirmación de STATUS sobre CI debe marcarse como pendiente.
