# Revisión: feat/project-registry (tareas 1–5)

Fecha: 2026-11-11. Alcance: `git diff main...HEAD` (6 commits), enfocada en rutas, rutas absolutas, reglas de secretos y entrega.

## Veredicto

Pedir cambios. Hay un bloqueante pequeño (una ruta absoluta puede llegar al cliente en un fallo de clonado). Lo demás es correcto o son mejoras no bloqueantes.

`pnpm check` pasa: shared 156, world-server 76, client 314, agent-engine 279 (6 omitidos), scripts 14.

## Bloqueante

1. **Ruta absoluta del usuario en el texto de fallo del trabajo.**
   `packages/agent-engine/src/steps/materialise.ts`, `cloneProject`: `git clone ... -- <sourcePath> <target>` no está envuelto en try/catch. Si la carpeta desaparece entre `revalidate` y el clon, o git falla, el mensaje de `GitError` incluye las últimas líneas de stderr, que pueden contener `D:\AgentHotel\...`.
   `packages/agent-engine/src/jobs/runner.ts` pasa ese texto por `errorText` y lo guarda en `transition(..., reason)` y en `task.failed`. Esos eventos llegan al cliente. La regla de seguridad dice que las rutas absolutas no salen del motor.
   Corrección: envolver el clon en `MaterialiseError` con un mensaje fijo (como ya se hace con `rev-parse`), y añadir un test que compruebe que el fallo de clon no contiene la ruta.

## Comprobado y correcto

- **Validación de rutas.** `register` usa `realpathSync.native` sobre la ruta recibida, exige que sea absoluta y rechaza la raíz misma (`isInsideRoot`, `roots.ts`). Compara sin distinguir mayúsculas en Windows. `revalidate` repite la comprobación en cada trabajo, así que un enlace o unión cambiado después del registro se rechaza. Hay tests de unión (`roots.test.ts`, `projects.test.ts`) y una propiedad con fast-check.
- **Rutas absolutas fuera del motor.** `ProjectSchema` no tiene campo `path` y las respuestas pasan por `sendJson`, que quita los campos extra. `list()` no devuelve la ruta. Los hallazgos del escáner usan rutas relativas del árbol y valores enmascarados con hash. `project-jobs.test.ts:152-157` y `projects.test.ts:159-162` comprueban que la ruta no aparece en exportaciones ni en la lista.
- **Clonado.** Copia solo el `HEAD` confirmado, sin remoto, con `--no-hardlinks`, y rechaza enlaces simbólicos y archivos `agentlife-*` en `.kiro/agents`. Si las comprobaciones fallan, borra el clon antes de que un agente lo vea.
- **Entrega.** `deliverBranch` ejecuta un único `git fetch <clon> ref:ref` sin `+`, sin checkout, sin push ni merge. Comprueba antes que la rama no exista (`show-ref`) y que el commit recibido coincida. Un fallo deja el repositorio igual.
- **Reglas de secretos.** Architect, Developer y QA deniegan lectura de `.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `credentials*`, `secrets*`, `.npmrc`, `.aws/**`, `.ssh/**` y `.git/**`, en la raíz y en subcarpetas. Developer no puede escribir en rutas protegidas: `pathProblem` en `validate-diff.ts` rechaza `.env*`, `.git`, `package-lock.json` y similares.

## Requisitos marcados como hechos que no se cumplen del todo

- El requisito de "denegar lectura de secretos" se prueba solo por forma del JSON (`agents.test.ts`). La denegación la aplica kiro-cli, no el motor. Ningún test lo ejecuta contra un archivo real con un agente.

## Tests que faltan

- Fallo de clon con ruta en el mensaje (el bloqueante).
- Prueba de que cada rol deniega el mismo conjunto de secretos (hoy solo se comprueba la forma).
- Prueba con `cp` del script de tests: un `.env` aceptado como hallazgo se copia al contenedor (ver no bloqueantes).

## No bloqueantes

1. **Reglas de denegación incompletas.** Faltan `.netrc`, `.pypirc`, `.docker/config.json`, `.kube/**`, `*.jks`, `*.keystore` y variantes como `config.env` (solo se cubre el prefijo `.env`).
2. **Secretos aceptados llegan a los tests.** El script del contenedor de tests (`steps/test.ts`, `buildRunArgs`) hace `cp -r /src/.`, así que un `.env` que el usuario aceptó sigue dentro. Si un test lo imprime, el registro llega al prompt de QA y al informe. Conviene excluir los archivos con patrón de secreto de la copia.
3. **`maskLeak` muestra 6 caracteres** (4 al inicio y 2 al final) en `shared/src/leaks.ts`. Para claves con prefijo fijo, los primeros caracteres no revelan nada, pero para tokens sin prefijo es una filtración parcial. Valor más seguro: mostrar solo la longitud y el tipo.
4. **Raíces permitidas en el mensaje `outside_allowed_roots`.** Se envían al cliente `D:\AgentHotel`. Son configuración, no rutas de proyecto, pero conviene decidir si el cliente debe verlas.
5. **`git fetch` escribe `.git/FETCH_HEAD`** en el repositorio del usuario. Añadir `--no-write-fetch-head` para que la única escritura sea la rama nueva.
