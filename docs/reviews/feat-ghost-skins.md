# Revisión: feat/ghost-skins (spec ghost-skins, tareas 1 y 2)

Fecha: 2026-11-14. Commits: 214270f, 8f4f26d, f6c01f9, f4de160 (39 ficheros, +4138 / -86).

## Veredicto

Aprobar. No hay problemas bloqueantes.

## Bloqueantes

Ninguno.

## Requisitos marcados como hechos y no cumplidos

Ninguno encontrado en la lectura. Comprobado contra `requirements.md` y `tasks.md`:

- 1.1 Al menos 20 partes en `config/outfits.json`, con la lista pedida (gorra, chaleco, pañuelo, clavel, calabaza, sombrero de bruja, pajarita murciélago, vela). Test "pass every check: 20 or more".
- 1.2 Dibujo en cuatro direcciones y orden de profundidad: tests de `outfit-parts` y de la figura del usuario.
- 2.1 Compra en la tienda con comprobación en servidor y `data/wardrobe.json`: `Economy`, tests de compra y rechazo.
- 2.2 Desbloqueo por insignia una vez, con aviso: test de desbloqueo al bienvenido y durante la sesión.
- 3.1 Sección Look en la ficha de miembro de RR. HH.: test de `look-picker` y del panel HR.
- 3.2 Pestaña Look en el Perfil: test "adds a Look tab".
- 3.3 Cambio visible a todos, persistencia tras reinicio, miembro despedido pierde el atuendo: tests de `wear-outfits` (reinicio, despido, despido fuera del hotel).
- 3.4 La demo no lleva atuendos: test "never carries a wardrobe".
- 4.1 a 4.3: presentes.
- 4.4 Playwright (comprar la gorra, ponérsela al Developer, recargar): existe `packages/client/e2e/outfits.spec.ts`. No lo ejecuté en esta revisión, porque `pnpm check` no incluye e2e.

## Comprobaciones de límites y seguridad

- Cliente solo habla con world-server: los mensajes nuevos van por el protocolo de `@agentlife/shared`, validados con zod en `ClientMsgSchema` y `ServerMsgSchema`.
- world-server no llama a ningún modelo: sin cambios en ese sentido.
- agent-engine no conoce tiles ni sprites: el diff no toca `agent-engine`.
- Sin assets de terceros: las partes se dibujan en código. `ASSETS.md` no cambia y no hay ficheros binarios nuevos.
- Sin secretos en logs: los logs solo muestran rutas de ficheros y motivos de error.
- Portabilidad: los ficheros se construyen con `join(here, ...)` y `fileURLToPath`. No hay `new URL(...).pathname` ni scripts que dependan de bash.
- Un miembro solo se viste si está en el equipo del proyecto (`hr.team`), y solo en la oficina de RR. HH. Un fallo al leer el equipo devuelve error y no cambia nada.
- Un fallo al escribir `data/outfits.json` devuelve error y mantiene el estado anterior (tests "changes nothing when the file cannot be written").

## Tests

`pnpm check` pasa (typecheck y tests de los cinco paquetes):

- shared: 485 tests.
- client: 759 tests.
- world-server: 453 tests.
- agent-engine: 682 tests (7 omitidos, ya omitidos en `main`).
- scripts: 16 tests.

Propiedades fast-check: hay 6 usos en los tests de atuendos. Cubren la compra (saldo no negativo, una vez por parte, nunca se compra una parte de insignia) y el ponerse y quitarse (cada parte puesta sigue en propiedad y en su ranura).

## Sugerencias no bloqueantes

1. `WornStore.setSlot` (`packages/world-server/src/outfit-store.ts`) no lo usa ningún código de producción. Quitarlo o usarlo.
2. `WornStore.pruneProject` compara por prefijo `proyecto/`. Si un id de proyecto o de miembro pudiera contener `/`, dos claves podrían chocar. Conviene confirmar en el esquema de `WearWho` que los ids no llevan `/`.
3. `gateway.ts` ya tiene más de mil líneas y sigue creciendo con cada spec. Valdría la pena extraer el bloque de atuendos a un módulo propio antes de la siguiente spec.
4. Lo que queda sin prueba automática es la legibilidad de cada parte a 1x sobre los colores de cada rol. Ya figura en `STATUS.md` como comprobación humana.
5. Antes de la demo final, ejecutar `outfits.spec.ts` con los cuatro servidores de prueba parados (puertos 8795 a 8798), como indica `STATUS.md`.
