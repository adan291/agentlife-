VERDICT: PASS

# Verificación de aceptación: feat/team-progress (spec team-progress, tareas 1-2)

Rama: `feat/team-progress` (3 commits: design, tarea 1, tarea 2). 44 archivos, +3653/-49 frente a `main`.

## Comandos ejecutados
- `pnpm check`: salida 0. shared 419 tests, world-server 353, client 651, agent-engine 678 (7 omitidos), scripts 16. Typecheck incluido.
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e team-progress`: 2 passed (15.5 s).
- Nota: existe `docs/reviews/feat-team-progress.md` sin seguimiento en git (otra revisión). No se ha tocado.

## Criterios

| Criterio | Resultado | Evidencia |
|---|---|---|
| 1.1 XP desde eventos del engine: paso ok, job entregado con pass, review pass, rama entregada, plan aprobado | PASS | `world-server/src/progress-tracker.ts:81-86` (plan_approved, branch_delivered), `:87+` (job_passed, review_passed, job_not_passed, review_finished), `agent.state_changed` a `done` (step_done). Importes en `world-server/config/progress.json` (cinco fuentes). Tests: `progress-tracker.test.ts` ("makes a step_done...", "makes job_passed...", "makes review_finished and review_passed...", "makes plan_approved...", "makes branch_delivered..."). |
| 1.1 Idempotente por tarea como en furni-shop | PASS | `shared/src/progress.ts:221-` `applyFact` guarda la clave `<source>:<ref>` en `counted`. Tests: `shared/test/progress.test.ts` "counts a fact once", "property: replaying the same facts changes nothing" (l.265); `progress-store.test.ts` "survives a restart, and a replay of the same facts adds nothing"; `progress-gateway.test.ts` "counts nothing again when a new gateway on the same file sees the same events". |
| 1.2 Curva fija: nivel n necesita 50·n·(n+1)/2 | PASS | `shared/src/progress.ts:16-18` `xpForLevel = 25·n·(n+1)`; `:24` `levelOf`. Test `progress.test.ts` "follows 50·n·(n+1)/2" (l.41) y property de nivel (l.60). |
| 1.2 Guardado en `data/progress.json`, reglas de archivo como furni-shop | PASS | `progress-store.ts` `defaultProgressFile` (`data/progress.json`), `readJsonFile`/`writeJsonFile`. Tests `progress-store.test.ts`: archivo roto apartado, fallo de esquema apartado, escritura fallida deshecha en memoria, archivo creado al arrancar. |
| 1.3 Stats por miembro: jobs, tasa de pase, tiempo medio de paso | PASS | `shared/src/progress.ts` `statsOf` (jobs, passed, steps, passRate, avgStepMs); tests `progress.test.ts` "gives levels and stats for the user and each member", "adds the time of a step..." (l.142). |
| 1.3 Team bar muestra nivel y XP al siguiente | PASS | `client/src/ui/team-bar.ts:330-332`; e2e `team-progress.spec.ts:35` espera `.al-team-level` = "Lv 0 · 15 XP to Lv 1" para Developer y QA. |
| 1.3 Team bar muestra las stats | PASS (ver Human checks) | Las stats van en el `title` de la línea de nivel (`team-bar.ts:332`, `progressLines`), no en texto visible. Coincide con design.md. No hay test de esa línea de `title`. |
| 1.3 Tooltip del agente muestra nivel, XP y stats | PASS | `client/src/ui/tooltip.ts` (`extra` añadido a `agentTooltip` y `guestTooltip`), `main.ts` `progressLines`. Test `team-progress.test.ts` "add the level lines to a desk ghost and to a member who stands on the floor" (l.99). |
| 1.3 Panel HR muestra nivel, XP y stats | PASS | `client/src/ui/hr.ts` línea `al-hr-level` con `levelLine` y `statsLine`. Test `team-progress.test.ts` "shows each member's level, XP to the next level and stats" (l.130) y "shows no level line when the hotel has no progress" (l.135). |
| 1.4 Level-up: efecto corto sobre el agente (arte propio) | PASS (aspecto visual en Human checks) | `client/src/scene/levelup-fx.ts`: ocho estrellas dibujadas con `Graphics`, 1.6 s, sin imágenes; `world-view.ts` `levelUp(slot)` y bucle de actualización; `main.ts:446`. Test `team-progress.test.ts` "rises and fades over its time" (l.151), "does not move with reduced motion" (l.163), "draws a four-point star" (l.171). Servidor: `progress-gateway.test.ts` "announces a level-up with the ghost to play the effect over..." (l.146). |
| 1.4 Level-up: toast | PASS | `client/src/main.ts:444-445` (`hud.toast(levelUpText(...))`); texto probado en `team-progress.test.ts` "words a level-up for the user and for a member" (l.29). El cableado de `main.ts` no tiene test propio, solo lectura de código. |
| 2.1 Al menos 12 badges en `config/badges.json` con regla e icono propio dibujado en código | PASS | `world-server/config/badges.json`: 18 badges (10 user, 8 member) incluidos First delivery, Ten deliveries, First branch review, Night owl, Librarian, Clean streak. `shared/src/badges.ts` `checkBadges` exige >= 12 (`BADGE_MIN`) y formas de `BADGE_SHAPES`. Iconos en `client/src/ui/badge-icons.ts` con `createElementNS`, sin imágenes. Tests: `progress-quests.test.ts` "has at least twelve...", `it.each` por badge "is earned exactly when its rule is met"; `profile.test.ts` "draws every shape the protocol allows". Observación: hay 12 formas para 18 badges, combinadas con colores. `night_shift` y `night_owl` comparten forma y color, pero son de ámbitos distintos (Profile y tarjeta HR) y nunca aparecen juntos. |
| 2.2 Un badge se concede una sola vez | PASS | `shared/src/badges.ts:73-74` `evaluateBadges` (solo los que no tiene). Test `badges.test.ts` "grants a badge once: the same entity comes back untouched the second time" (l.96). |
| 2.2 Se muestra en la pestaña Badges del panel Profile (usuario) | PASS | `client/src/ui/profile.ts`, `panels.ts` (`state.open === "profile"`). Tests `profile.test.ts` "lists the badges with a picture, earned ones with their date and locked ones..." (l.86); e2e `team-progress.spec.ts:35` comprueba `[data-badge="approver"][data-earned="true"]` con un `svg`. |
| 2.2 Se muestra en la tarjeta HR del miembro | PASS | `client/src/ui/hr.ts` tira `al-hr-badges`. Test `profile.test.ts` "shows the badges a member earned as pictures with their names" (l.163). |
| 3.1 Tres quests por día de un pool fijo, con la fecha como semilla, con recompensa en Ecto | PASS | `shared/src/badges.ts:143` `pickQuests` (FNV-1a + mulberry32 + Fisher-Yates parcial, 3 distintas). `config/quests.json`: 8 quests, incluidas las 4 del spec, cada una con `reward`. Tests `badges.test.ts` "picks three different quests, the same ones for the same date..." (l.127) y "property: three distinct quests..." (l.136). |
| 3.2 Progreso desde los mismos eventos; completa una vez y paga una vez | PASS | `shared/src/progress-rules.ts:44-` `applyFactWithRules` (solo hechos de hoy, `done`, `payouts` con `ref` `<día>.<id>`); `gateway.ts:975` `payQuests` usa `economy.grant("quest_done", ref, ...)` idempotente. Tests `progress-quests.test.ts` `it.each` por quest "completes after N facts of its counter and pays once", gateway "pays each of today's quests once into the wallet...", "pays nothing twice when a new gateway on the same files sees the same events", "pays a payout that was left unpaid...", "only takes a payout off the list when the wallet already holds it". |
| 3.2 El panel Profile lista las quests de hoy con progreso | PASS | `profile.test.ts` "opens the Quests tab with today's three quests, their progress and their reward" (l.99); e2e `team-progress.spec.ts:35` (3 `[data-quest]`, 3 con `data-done="true"`). |
| 4.1 Property tests: XP y niveles monótonos y a prueba de replay | PASS | `shared/test/progress.test.ts` l.60, l.265 "replaying the same facts changes nothing", l.275 "XP and levels never go down, and stay inside the limits"; `badges.test.ts` l.264 con badges y quests. |
| 4.1 Property test: elección de quests determinista por fecha | PASS | `shared/test/badges.test.ts` l.136. |
| 4.2 Tests world-server: cada fuente de XP | PASS | `progress-tracker.test.ts` (step, job, review, plan, rama); `progress-store.test.ts` "adds XP once per fact and reports the levels that went up"; `progress-gateway.test.ts` l.126 y l.164. |
| 4.2 Tests world-server: cada regla de badge | PASS | `progress-quests.test.ts` `it.each(BADGES)` "is earned exactly when its rule is met", con el ámbito correcto. |
| 4.2 Tests world-server: quest completa y pago una vez | PASS | Ver 3.2. |
| 4.2 Tests world-server: archivos sobreviven a un reinicio | PASS | `progress-store.test.ts` "survives a restart..." (l.67), `progress-quests.test.ts` "keeps an unpaid payout across a restart..." (l.96), gateway "pays a payout that was left unpaid when the program stopped, at start, once". |
| 4.3 Playwright: un job con guion sube la XP del Developer en la team bar y completa una quest | PASS | `client/e2e/team-progress.spec.ts:35`: pasa en Edge. Comprueba "Lv 0 · 15 XP to Lv 1" en Developer, badge `approver`, 3 quests hechas y Ecto pagado. Test de recarga l.82 también pasa. |

## To fix
Ninguno. No hay criterios FAIL.

## Human checks
- Navegador: el efecto de level-up (anillo de ocho estrellas sobre el fantasma, 1.6 s, y con movimiento reducido) se ve bien y es legible (1.4). Solo hay tests de la función pura `levelUpFrame` y de la forma de la estrella.
- Navegador: la línea "Lv N · X XP to Lv N+1" de cada fila de la team bar cabe en la barra lateral. Pasar el ratón por ella debe mostrar las stats (jobs, % pasados, tiempo medio de paso) (1.3). Si el usuario quiere las stats visibles sin hover, hay que añadirlas al texto de la fila.
- Navegador: el chip "Lv N" junto al chip de Ecto, el panel Profile (pestañas Badges y Quests, iconos, barras de progreso) y las tiras de badges en la tarjeta HR (2.2, 3.2). El e2e solo comprueba existencia, `data-*` y texto.
- Ya anotado en `docs/STATUS.md`: ejecutar con el engine real (`data/progress.json` real) para confirmar que Developer y QA suben de nivel con un job de verdad, y que no se muestran niveles con el motor de guion ni en la demo grabada.
