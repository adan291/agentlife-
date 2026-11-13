# Revisión: feat/furni-move (furni-move, tareas 1-3)

Fecha: 2026-11-13. Rama revisada: `feat/furni-move` (5 commits sobre `main`). Spec: `.kiro/specs/furni-move/`.

## Veredicto

**Aprobar.** No hay bloqueos. Quedan dos comprobaciones que esta revisión no cubre: el test Playwright (`e2e/furni-move.spec.ts`) no se ha vuelto a ejecutar aquí, y el modo arreglar no se ha mirado en un navegador.

## Bloqueos

Ninguno.

## Requisitos marcados como hechos y no cumplidos

Ninguno detectado en el código. Puntos a confirmar:

- Requisito 2.4 (los agentes siguen trabajando mientras el usuario arregla): no hay test que lo demuestre. El diseño dice que un andar en curso termina en su casilla anterior; eso se cumple por construcción, pero no está probado.
- Requisito 4.3 (Playwright): el spec existe, pero `pnpm check` no ejecuta e2e. El estado dice que pasó; no se repitió.
- Requisito 3.3: el texto se ha reformulado (los `home_*` no siguen al mueble) y coincide con `design.md` y con `layout.ts`.

## Comprobaciones realizadas

- `pnpm check`: pasa. shared 290, world-server 208, client 578, agent-engine 678 (7 omitidos), scripts 16.
- Límites: el cliente solo habla con world-server (arrange.ts importa `@agentlife/shared`, no sockets propios). world-server no llama a ningún modelo. agent-engine no cambia. Ninguna mención a tiles o sprites en el engine.
- Rutas: `layout-store.ts` usa `node:path` y `fileURLToPath`. No hay `new URL(...).pathname`.
- Archivos de datos: `data/layouts.json` queda cubierto por `data/` en `.gitignore`. El store escribe en un temporal y renombra; un archivo ilegible se mueve a `.bad-<tiempo>` y no se sobrescribe.
- Compatibilidad de ids: el regex de ids de proyecto de `LayoutsFileSchema` acepta todos los ids de `ProjectSchema` (`^[a-z0-9][a-z0-9-]*$`, máximo 60).
- Solo se mueven piezas del piso propio (`userRoom()`, `projectIdOfRoom`). El lobby y RR. HH. devuelven `not_editable` en `Hotel.moveFurniture` y `Hotel.resetLayout`.
- El fallo al guardar no cambia la sala (`save_failed`, con prueba).
- Las reglas se aplican también en el servidor, no solo en el cliente, y el cliente reutiliza las mismas reglas compartidas.

## Tests

Existen los tests que pide el spec:

- Propiedad (fast-check) en `packages/shared/test/layout.test.ts`: cualquier secuencia de movimientos deja todo alcanzable desde el ascensor y sin dos piezas en la misma casilla. Lo mismo para el modo arreglar en `packages/client/test/arrange.test.ts`.
- world-server (`layout.test.ts`): movimientos rechazados (fuera de la sala, ocupado, bloquea el camino, lobby, ascensor), persistencia tras reinicio, fallback si la plantilla cambia, archivo roto movido a un lado.

Falta: nada obligatorio. Ver la sugerencia 4.

## Sugerencias no bloqueantes

1. `packages/shared/src/layout.ts`, `makeCtx`: el conjunto `spots` incluye cualquier ancla sin `follows`. Una futura ancla fija quedará como punto de pie sin decirlo. Conviene un comentario o una lista explícita de prefijos `home_` y `door`.
2. `packages/shared/src/layout.ts`, `targetsOf`: solo excluye la interacción `elevator`, mientras que `isPinned` también incluye `door`. Hoy no hay piezas `door` en el catálogo, pero usar `isPinned` evita la divergencia.
3. `packages/world-server/src/gateway.ts`, `arrange`: el movimiento se confirma con `enqueue` después de los andares ya encolados. Un test que mueva una pieza mientras un agente camina hacia ella cubriría el requisito 2.4.
4. Añadir un test de gateway que compruebe que el mueble recibido en `room_layout` coincide con el estado persistido en `layouts.json` tras un reinicio con varios proyectos. Hoy el reinicio se prueba con un solo proyecto.
5. `packages/world-server/src/layout-store.ts`: cada cambio reescribe el archivo entero. Con pocos proyectos no importa; si el número de proyectos crece, conviene escribir solo el proyecto afectado.
