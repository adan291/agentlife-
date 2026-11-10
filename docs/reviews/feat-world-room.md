# Revisión: feat/world-room (contra main)

Spec: `.kiro/specs/world-room` (tareas 1 a 12).
Commits: 16, uno por tarea más commits de estado. Diff: 59 archivos, +5235 / -35.
Nombre de archivo: la rama contiene una barra, así que el informe usa `feat-world-room.md`.

## Veredicto

Solicitar cambios (menores). `pnpm check` pasa (typecheck y tests: shared 103, client 30, world-server 20). La tarea 12 está marcada como hecha, pero su criterio de aceptación no se cumple del todo (ver bloqueantes).

## Bloqueantes

1. **Tarea 12 marcada como hecha sin verificación en navegador.** `.kiro/specs/world-room/tasks.md` (tarea 12) pide recorrer computer, start job, approve y reporte, y corregir defectos. `docs/STATUS.md` reconoce que los paneles no se probaron en navegador; solo hubo un cliente WebSocket scripted contra `ENGINE=fake`. Requisitos 8.1 a 8.3 no están verificados visualmente. Corrección: dejar la tarea 12 como pendiente hasta la comprobación manual, o marcarla explícitamente como verificada solo por WebSocket.

2. **El buzón conserva aprobaciones y reportes de jobs anteriores.** `packages/world-server/src/gateway.ts:130-131` limpia `approvals` y `reports` solo al llegar `task.created` del siguiente job. Entre jobs, el buzón sigue mostrando aprobaciones antiguas (incluidas pendientes de un job rechazado o ya terminado). La lista de comprobación manual del punto 8 en STATUS espera que desaparezcan. Corrección: limpiar al terminar el job (`task.completed` / `task.failed`) o filtrar por `taskId` actual al abrir el buzón.

## Revisión por reglas

- **Límites de módulos.** `world-server` no llama a ningún modelo. El cliente solo habla con world-server (`transport.ts` usa `ws://127.0.0.1:8787`, sobrescribible por `VITE_WORLD_URL`). `shared` maneja tiles y anclas, correcto para world-server y cliente. No hay código de agent-engine en esta rama.
- **Seguridad.**
  - Markdown: `ui/markdown.ts` renderiza con `createElement` y `textContent`, sin `innerHTML`. El test de `panels.test.ts` cubre el escape de HTML.
  - Motor fake: sin red ni secretos.
  - Límite de 16 KB y de 20 mensajes/s en `gateway.ts`, con tests.
  - Sin activos de Habbo visibles en el diff. Las texturas son procedurales. No he revisado las recetas de `palette.ts` y `recipes.ts` para descartar trade dress de Habbo.
- **Portabilidad.** Rutas con `fileURLToPath` y `node:path` (`load-room.ts`, tests). No se usa `new URL(...).pathname`. No hay parameter properties ni enums en los paquetes de servidor (la clase `TokenBucket` lo indica en un comentario). `package.json` de world-server cambia; no lo he revisado en detalle.
- **Mensajes de error del motor.** `gateway.ts:195` reenvía al cliente hasta 200 caracteres del mensaje de error del motor. Si ese mensaje incluyera una credencial, llegaría al cliente. Riesgo bajo, pero las reglas de secretos piden no enviarlos al cliente.

## Requisitos marcados como hechos y no cumplidos

- Tarea 12: ver bloqueante 1.
- Requisito 8.4 (mensajes de markdown seguros): cubierto por test de escape, pero no se probó la renderización real en navegador.

## Tests

- Propiedades presentes como pide el spec: proyección (round-trip, `geometry.test.ts`), orden de profundidad para huellas no solapadas (`geometry.test.ts`), pathfinding (adyacencia y nulo cuando no hay ruta, `pathfind.test.ts`), invariante del sim con avatares siempre en tiles caminables (`sim.test.ts`), y markdown y tiempos de burbuja (client).
- Falta un test de gateway que cubra la limpieza de aprobaciones entre jobs (bloqueante 2).
- No he revisado en detalle si `sim.test.ts` cubre `use` con paso diferido del panel `open_panel`.

## Sugerencias no bloqueantes

1. Deduplicar mensajes en el gateway. STATUS indica que el motor envía `job_update` y `approval` repetidos. El cliente los absorbe, pero conviene resolverlo en la integración con agent-engine.
2. `resolveApproval` (`gateway.ts`) no marca la aprobación como "resolviendo" al enviarla. Un doble clic envía dos veces; la segunda recibe `bad_message`. Un estado intermedio evitaría el error visible.
3. `startJob` pone `jobActive = true` antes de la respuesta del motor (`gateway.ts:189`). Si el motor nunca emite un evento terminal tras un inicio correcto, el servidor queda bloqueado hasta reiniciar. Conviene un timeout.
4. Sanear el texto de `say` antes de mostrarlo en burbujas, aunque Pixi renderiza en canvas y no interpreta HTML.
5. Mantener el número de versión del protocolo (`version.ts`) sincronizado con los cambios de `protocol.ts` cuando se integre agent-engine.
