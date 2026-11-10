# Revisión: feat/agent-engine (contra main)

Spec: `.kiro/specs/agent-engine` (tareas 1 a 10, todas marcadas como hechas).

## Veredicto: solicitar cambios

Hay un bloqueante de seguridad pequeño. El resto del trabajo cumple el spec.

## Bloqueantes

1. **El motor puede escuchar en cualquier interfaz sin token.** `packages/agent-engine/src/main.ts:11` toma `HOST` del entorno y `ENGINE_TOKEN` es opcional (línea 13). Si alguien arranca con `HOST=0.0.0.0` sin token, cualquiera de la red puede crear jobs, aprobar planes y leer exportaciones. Hoy los agentes son fake, pero el spec (tarea 7) y `security.md` exigen 127.0.0.1 por defecto. Corrección propuesta: el arranque debe fallar si el host no es loopback (`127.0.0.1`, `::1`, `localhost`) y no hay `ENGINE_TOKEN`. Añadir un test de config.

## Requisitos marcados como hechos pero no verificados

- Tarea 10: la comprobación manual de dos procesos (motor y world-server) no está hecha. STATUS.md lo reconoce como pendiente del usuario; la tarea no debería marcarse como completa hasta entonces, o debe quedar anotado que solo está verificada en proceso.

## Tests

- Pasan: `pnpm check` (typecheck y tests: shared 106, client 30, world-server 29, agent-engine 61).
- Propiedades fast-check: presentes para store (fold, `store.test.ts:96`, `:113`) y runner (requisito 3.6, `runner.test.ts:292`). Falta una propiedad sobre la tabla de transiciones; la guía del proyecto pide fast-check para la máquina de estados.
- Faltan tests de `LlmRuntime` con endpoint caído: `runtimes.test.ts` debería cubrir el fallback con un puerto cerrado, como pide la tarea 5 (revisar si ya existe antes de cambiarlo).

## Límites y reglas

- Boundaries: el motor no menciona tiles ni sprites. El world-server no llama a ningún modelo. El cliente no se toca en este branch.
- Seguridad: los agentes de fake no escriben. Las rutas de `data/runs/<taskId>` se construyen a partir de ids que ya existen en la base de datos (`store.getJob` antes de leer). Los secretos se redactan en logs y exportaciones.
- Portabilidad: se usa `node:path` y `fileURLToPath`. No se encontró `new URL(...).pathname` usado como ruta de archivo.

## Sugerencias no bloqueantes

1. `packages/world-server/src/http-engine.ts` (`getJob`): cada actualización de estado descarga la exportación completa, incluido el contenido de los artefactos. Basta con el job y sus eventos de estado; si no, cachear por taskId.
2. `packages/agent-engine/src/http/server.ts`: `HOST` se comparte con el world-server bajo el mismo nombre. Usar `ENGINE_HOST` evita arrancar el motor en la interfaz equivocada por accidente.
3. `packages/world-server/src/gateway.ts:142`: `jobActive` se limpia solo en `cancelled` y `delivered`. Un job que falla en el paso de informe sin llegar a `delivered` deja la UI en "Job running..." hasta el siguiente job. Conviene limpiarlo también en `failed` terminal.
4. La nota de aprobación se acepta por la API pero no se guarda (ya documentado en STATUS). Quitar el campo o guardarlo en el evento antes del merge, para que la API no prometa algo que no hace.
5. Revisar en el próximo review: envío duplicado de `job_update` y `approval` en el gateway, y falta de estado en vuelo al aprobar (doble clic), ya anotados en STATUS.
