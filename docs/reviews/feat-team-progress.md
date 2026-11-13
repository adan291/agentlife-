# Revisión: feat/team-progress (spec team-progress, tareas 1-2)

Fecha: 2026-11-13. Rama revisada: `feat/team-progress` contra `main` (3 commits: diseño, tarea 1, tarea 2).

## Veredicto

**Aprobar.** No hay problemas bloqueantes. Antes de fusionar, ejecutar los tests e2e de Playwright (`E2E_CHANNEL=msedge`), porque `pnpm check` no los incluye y esta revisión no los ha ejecutado.

## Verificación

- `pnpm check`: pasa. shared 419 tests, world-server 353, client 651, agent-engine 678 (7 omitidos), scripts 16.
- Límites: `pnpm check` no ejecuta `packages/client/e2e/team-progress.spec.ts`.

## Problemas bloqueantes

Ninguno.

## Requisitos de tasks.md y requirements.md

- 1.1 XP por fuente, idempotente por clave: cumplido (`progress-tracker.ts`, `progress-store.ts`, `applyFactWithRules`).
- 1.2 Curva fija 50·n·(n+1)/2: cumplido (`shared/src/progress.ts`, `levelOf` con comprobación exacta en los bordes).
- 1.3 Stats y su visualización en barra de equipo, tooltip y HR: cumplido según design.md; no verificado a fondo en navegador.
- 1.4 Efecto de subida de nivel y aviso: cumplido (`scene/levelup-fx.ts`, `hud.toast`).
- 2.1 Al menos 12 insignias con icono dibujado en código: cumplido (18 en `config/badges.json`, formas en `badge-icons.ts`).
- 2.2 Una sola concesión, pestaña Badges del Profile y tarjeta HR: cumplido según design.md.
- 3.1 Tres misiones diarias según la fecha: cumplido (`pickQuests`, determinista, probado con fast-check).
- 3.2 Misión completada una vez, pago una vez: cumplido (`payouts`, `settlePayout`, `economy.grant` con `quest_done`).
- 4.1 Propiedades: cumplido en `shared/test/progress.test.ts` y `badges.test.ts`.
- 4.2 Tests de world-server por fuente, insignia, misión y reinicio: cumplido en `progress-tracker`, `progress-store`, `progress-quests` y `progress-gateway` tests.
- 4.3 Playwright: existe el spec; no ejecutado en esta revisión.

## Límites de frontera y seguridad

- El cliente solo habla con world-server. Ningún mensaje del cliente cambia progreso (hay test).
- world-server no llama a un modelo. El cálculo de XP lee eventos del motor y `GrantTracker`.
- agent-engine no cambia en esta rama.
- Portabilidad: sin `new URL(...).pathname` como ruta, sin scripts de bash. Las rutas usan `node:path` y `fileURLToPath`.
- Textos del servidor: en los archivos nuevos del cliente no aparece `innerHTML`.
- Secretos: no hay secretos ni claves nuevas.

## Pruebas que faltan o son débiles

- No hay prueba de que un fallo de escritura en el archivo de Economy deshaga la concesión de `payQuests` cuando `grantEcto` devuelve `undefined` por fallo de escritura (solo se cubre el caso "ya concedido").
- La prueba de "miembro 301" (límite `MEMBERS_MAX`) no aparece en los tests revisados. Revisar si existe.

## Sugerencias no bloqueantes

1. `progress-tracker.ts`, `approval.requested`: la detección de planes automáticos depende del texto `"approved automatically"` del resumen. Un cambio de texto en el motor rompería la regla en silencio. Mejor un campo explícito.
2. `gateway.ts`, `recordFact` / `seatOfRole`: si la sala aún no tiene plantilla, cada hecho puede hacer una lectura HTTP `engine.hr.team` dentro de la cola de eventos. Con muchos eventos seguidos, esto retrasa el resto. Una caché por proyecto con invalidación al cambiar el equipo sería más seguro.
3. `gateway.ts`, `night_scheduled`: la referencia usa un contador en memoria que se reinicia con el proceso. Es único por la marca de tiempo, pero conviene dejarlo escrito en el diseño.
4. `payQuests` se ejecuta en cada hecho y al arrancar. Si `progress.payouts()` tiene muchos elementos pendientes por fallos repetidos de escritura, se reintenta todo cada vez. Limitar o registrar el error.
5. `docs/STATUS.md`: la línea del spec menciona "2 new tests on a second test server" sin indicar que los tests e2e no están en `pnpm check`. Añadirlo evita confusiones en la siguiente sesión.
