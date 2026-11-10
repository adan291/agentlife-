# Revisión: feat/room-ux (contra main)

Spec: `.kiro/specs/room-ux` (tareas 1 a 5, todas marcadas como hechas).

## Veredicto: solicitar cambios

Hay un bloqueante de seguridad: el texto de actividad no pasa por el filtro de secretos que usa el log. El resto cumple el spec y `pnpm check` pasa (shared 126, client 93, world-server 34, agent-engine 209 con 6 omitidos, scripts 14).

## Bloqueantes

1. **El texto de actividad puede llevar secretos a la base de eventos y al cliente.** `packages/agent-engine/src/activity.ts` (función `emit`) pasa el texto sólo por `sanitize` (`packages/shared/src/sanitize.ts:12-16`). Ese filtro quita rutas, `ksk_*`, `$env:*` y `NAME=valor`, pero no conoce el valor real de `KIRO_API_KEY`, `ENGINE_TOKEN` ni de otros secretos. `packages/agent-engine/src/log.ts` ya tiene `collectSecrets()` para redactar esos valores en los logs; el emisor de actividad no lo usa. Como `progress` viene de la salida del modelo y del repo (datos no fiables), un token que aparezca en una lectura de archivo llegaría a SQLite, a `activity` por WebSocket y a la terminal de todos los clientes. Corrección propuesta: pasar `collectSecrets()` al emisor (o al `sanitize` del motor) y reemplazar esos valores antes de guardar el evento. Añadir un test que meta `KIRO_API_KEY` de prueba en `progress` y compruebe que no aparece en el evento ni en `activity`. Además, `sanitize` no reconoce formatos habituales (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `Bearer `); conviene añadirlos a la misma lista.

## Requisitos marcados como hechos pero no cumplidos del todo

- Requisito 4.1: "como máximo un evento por agente por segundo". El throttle sólo aplica a `progress`; las líneas de hito (`line`) no tienen límite (`activity.ts`, método `line`). El diseño lo decide así (design.md, "Activity emitter"), pero el requisito no lo dice. Se debe anotar la excepción en requirements.md o limitar también los hitos.
- Requisito 1.1: el Builder no tiene modelo en la barra de equipo (ya conocido en STATUS.md). Queda abierto.
- Tareas 4 y 5: la comprobación en navegador sigue pendiente del usuario, como indica STATUS.md. No hay nada automatizado que valide la posición del toast ni la animación de la barra.

## Tests

- Los tests pedidos por el requisito 6 existen: mapeo del stepper por estado y propiedad fast-check (`room-ux.test.ts`), reglas del toast (funciones puras), colores de la barra de equipo, ring buffer de 300 y regla de auto-scroll (`readability.test.ts`), sanitize con propiedad (`sanitize.test.ts`, `activity.test.ts`), límite de 50 líneas en `welcome` (`world-server/test/activity.test.ts`).
- Falta un test de la propiedad de secretos sobre valores reales del entorno (ver bloqueante 1). La propiedad actual sólo usa patrones.
- Los toasts y la terminal no tienen pruebas de DOM. Las reglas se prueban como funciones puras, así que el cableado en `main.ts` no tiene cobertura.

## Límites y reglas

- Cliente: sólo habla con el world-server (`main.ts` usa `transport`). Sin cambios de frontera.
- world-server: no llama a ningún modelo.
- agent-engine: `activity.ts` y `crew.ts` no mencionan tiles ni sprites. Sin problemas.
- Windows: no hay `new URL(...).pathname` como ruta ni scripts con bash en el diff. Revisado con búsqueda en el diff.
- Seguridad de DOM: la terminal, el stepper, la barra de equipo y el toast usan `textContent` y `createElement`. El diff de `markdown.ts` construye las líneas de diff con nodos y no usa `innerHTML`. No hay `innerHTML` nuevo en el diff.

## Sugerencias no bloqueantes

1. `packages/agent-engine/src/jobs/runner.ts:317` y `:398`: la línea `this.note(...)` y la siguiente sentencia están en la misma línea (`;    this.store.saveArtifact(...`). Separarlas; también hay que comprobar el formato de la función `saveArtifact` del paso de revisión.
2. `packages/client/src/ui/terminal.ts`, método `render`: reconstruye hasta 300 filas en cada línea nueva. Con la ráfaga de `progress` de una run real puede costar frames. Añadir filas incrementales si se nota en el navegador.
3. `packages/client/src/scene/world-view.ts`, `focusAgent`: el tooltip fijado aparece en el centro de la pantalla + 24 px, no junto al agente. Está bien para 2 s, pero conviene que el texto del spec diga eso.
4. `packages/client/src/ui/team-bar.ts`: el `setInterval` de un segundo nunca se limpia. No es un problema en la app actual, pero un `dispose()` evitaría fugas si se monta dos veces en pruebas.
5. `packages/client/src/ui/stepper.ts`, `stepLabel`: usa `✓` y `✗` como marcas de estado. Son símbolos Unicode, no emojis, pero conviene revisar que la fuente del modo de pantalla los muestre en Windows.
