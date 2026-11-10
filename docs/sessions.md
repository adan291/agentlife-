# Roadmap de sesiones, prompts y modelos

## Modo automático (recomendado)

El plan de modelos está en `scripts/sessions.json` y lo ejecuta `scripts/run-session.ts` con `kiro-cli`, usando el agente `agentlife-builder`:

```powershell
pnpm session list              # sesiones y estado
pnpm session next --dry-run    # ver qué se va a ejecutar, sin gastar
pnpm session next              # ejecutar la siguiente con su modelo y effort
pnpm session next --review     # y después la revisión con agentlife-reviewer (Haiku)
```

- Fija `--model` y `--effort` de cada sesión (con Auto no hay effort: Auto lo decide). Si tu cuenta no tiene ese modelo, **se detiene antes de gastar** y no lo sustituye por otro.
- Se niega a arrancar con cambios sin commit.
- Al terminar ejecuta `pnpm check` y apunta el resultado en `data/sessions/log.md` (local, no se sube). `next` salta las sesiones marcadas como `ok`.
- Si una sesión falla, no sigas con la siguiente: lee `docs/STATUS.md` y usa la sesión X (rescate).
- S10 es interactiva (ejecuciones en vivo contigo): el script abre un chat normal con su modelo.
- Para cambiar un modelo, edita `scripts/sessions.json`, no este documento.

Las tablas siguientes explican el porqué de cada elección y sirven para trabajar a mano desde el IDE.

Cada sesión es una conversación **nueva** de Kiro. El repositorio es la memoria: el steering `workflow.md` hace que cada sesión lea `docs/STATUS.md` al empezar y lo actualice al terminar. Copia los prompts tal cual.

## Cómo ahorrar créditos

Datos de [kiro.dev/docs/models](https://kiro.dev/docs/models/available-models.md) y [billing](https://kiro.dev/docs/billing.md). Se paga por petición, con un multiplicador por modelo (Auto = 1x).

| Modelo | Coste | Para qué lo usamos |
|---|---|---|
| **Auto** | 1x | Implementación normal. Es el modelo por defecto en casi todas las sesiones. |
| **Claude Sonnet 5.5 / 5** | 1.3x | Solo en código delicado: seguridad, procesos hijo y concurrencia |
| **Claude Opus 5.5** | 2x | Solo como **rescate**: un bug que Auto no resuelve en 2 intentos o un cambio de diseño. Nunca para escribir código rutinario. |
| **Claude Haiku 5.5** | 0.4x | Revisiones, documentación, README y preguntas sobre el proyecto |
| **Haiku 5.5** (si te aparece) | 0.06x | Lo mismo que Haiku 5.5, más barato |
| **Qwen3 Coder Next** | 0.05x | Preguntas rápidas ("¿qué toca hoy?", "¿cuántas tareas quedan?") y cambios triviales |

Reglas:
1. **Una sesión por fila de la tabla.** Las conversaciones largas arrastran contexto y cada petición cuesta más. Cuando acabes la fila, abre una sesión nueva.
2. **Effort bajo o medio por defecto.** Usa `high` solo donde la tabla lo indica. El slider "Effort" está en el panel del modelo.
3. **No pegues documentos en el chat.** Los prompts ya apuntan a las specs y el steering se carga solo.
4. **Si algo falla dos veces con Auto, no insistas.** Abre una sesión con Opus 5.5 y el prompt de rescate (al final de este documento).
5. **Revisa el panel de uso tras S1.** Si S1 gasta más de 150 créditos, avísame y recortamos tareas.
6. Las revisiones con **Codex no gastan créditos de Kiro**. Úsalo como revisor principal y deja `agentlife-reviewer` como segunda revisión barata.

## Presupuesto

Total: 4.000 créditos del hackathon más los de tu plan. Reserva el 20 % para imprevistos.

| Fase | Sesiones | Tope orientativo |
|---|---|---|
| 1. Mundo | S1, S3, S4, S5 | 900 |
| 2. Spike + motor | S2, S6, S7 | 800 |
| 3. Agentes reales (incluye las ejecuciones de agentes del producto) | S8, S9, S10 | 1.000 |
| 4. Demo y entrega | S11, S12, S13 | 400 |
| Revisiones y rescates | R, X | 300 |
| Reserva | | 600 |

Los topes son estimaciones [Supuesto]. Recalcúlalos con lo que gaste S1.

## Fase 1: Mundo (11–18 nov)

| Sesión | Fecha | Modelo | Effort | Prompt |
|---|---|---|---|---|
| S1 | 11 nov | Auto | medium | `Implement tasks 1 to 4 of the world-room spec (.kiro/specs/world-room). Follow workflow.md.` |
| S3 | 13–14 nov | Auto | medium | `Implement tasks 5 to 7 of the world-room spec. Follow workflow.md.` |
| S4 | 15–17 nov | Auto | medium | `Implement tasks 8 to 10 of the world-room spec. Follow workflow.md. Show me how to run the client when done.` |
| S5 | 17–18 nov | Auto | low | `Implement tasks 11 and 12 of the world-room spec. Follow workflow.md.` |

Lo que haces tú: en S4 y S5, abrir el cliente y decir qué se ve mal. Describe lo que ves en lugar de pedir "mejóralo"; es más barato y más preciso.

## Fase 2: Spike y motor (12–23 nov)

| Sesión | Fecha | Modelo | Effort | Prompt |
|---|---|---|---|---|
| S2 | 12–13 nov | Auto | low | `Do task 1 of the agent-pipeline spec: the kiro-cli spike. Use claude-haiku-5.5 as --model for every kiro-cli call in the spike. Document findings in docs/spikes/kiro-cli.md. Stop and report if any check fails.` |
| S6 | 18–20 nov | Auto | medium | `Implement tasks 1 to 5 of the agent-engine spec. Follow workflow.md.` |
| S7 | 20–23 nov | Sonnet 5.5 | medium | `Implement tasks 6 to 10 of the agent-engine spec. Follow workflow.md.` |

S7 usa Sonnet por la máquina de estados con cancelación y el SSE sin huecos: ahí los errores sutiles salen caros de depurar.

## Fase 3: Agentes reales (24–29 nov)

S9B (build-crew 1–4, Auto): el fantasma Builder muestra en la habitación las sesiones que construyen el proyecto. Tarea 5 es una comprobación manual.

| Sesión | Fecha | Modelo | Effort | Prompt |
|---|---|---|---|---|
| S8 | 24–25 nov | Sonnet 5.5 | medium | `Implement tasks 2 to 5 of the agent-pipeline spec, using the findings in docs/spikes/kiro-cli.md. Follow workflow.md.` |
| S9 | 26–27 nov | Sonnet 5.5 | high | `Implement tasks 6 to 10 of the agent-pipeline spec. Follow workflow.md.` |
| S10 | 28–29 nov | Auto | low | `Implement tasks 11 to 13 of the agent-pipeline spec. Run the live runs with me.` |

S9 lleva effort high porque contiene la validación del diff y Docker, que son las reglas de seguridad del producto.

### Modelos de los agentes del producto

Los agentes del producto también gastan créditos en cada ejecución. Se configuran en `packages/agent-engine/config/agents.json`.

| Rol | Modelo inicial | Si la calidad no basta |
|---|---|---|
| Architect | `claude-haiku-5.5` | `auto` |
| Developer | `auto` | `claude-sonnet-5.5` |
| QA | `claude-haiku-5.5` | `auto` |
| Frases de ambiente | Ollama local (`qwen3.5:4b`), sin coste | Frases predefinidas |

Durante el desarrollo, usa `RUNTIME=fake` (sin coste). Ejecuta agentes reales solo en S2, S10 y para grabar la demo. Con 3 o 4 ejecuciones completas basta.

## Fase 4: Demo y entrega (30 nov – 3 dic)

| Sesión | Fecha | Modelo | Effort | Prompt |
|---|---|---|---|---|
| S11 | 30 nov | Auto | medium | `Implement tasks 1 to 4 of the demo-replay spec. Follow workflow.md.` |
| S12 | 1 dic (congelación) | Auto | low | `Implement tasks 5 and 6 of the demo-replay spec, then list visual polish items for the Kiroween look and do the top three.` |
| S13 | 2–3 dic | Haiku 5.5 | low | `Do task 7 of the demo-replay spec: README, docs/kiro-usage.md and docs/video-script.md, in English.` |

## Sesiones de apoyo

| Sesión | Cuándo | Modelo | Prompt |
|---|---|---|---|
| **R** (revisión) | Al terminar cada sesión S | Codex (sin coste de Kiro) | `Review the diff of this branch against main. Read .kiro/steering/*.md and the matching spec in .kiro/specs first. Report blocking issues with file:line. Do not edit files.` |
| **R2** (revisión barata) | En S6–S9, como segunda opinión | Agente `agentlife-reviewer` (fijado a Haiku 5.5) | `Review the current branch against main.` |
| **F** (arreglos) | Tras R/R2 si hay bloqueantes | Auto, effort low | `Fix the blocking issues listed in docs/reviews/<branch>.md. Follow workflow.md.` (si la revisión fue de Codex, pega su lista) |
| **X** (rescate) | Algo falla 2 veces seguidas | Opus 5.5, effort high | `Problem: <qué falla, comando y error exacto>. Already tried: <qué se intentó>. Read docs/STATUS.md and the relevant spec design. Find the root cause and fix it with the smallest change.` |
| **Q** (pregunta) | Cuando quieras | Qwen3 Coder Next | `Read docs/STATUS.md. What is the next session and what do I need to do before it?` |

## Lo que haces tú fuera de las sesiones

| Cuándo | Qué |
|---|---|
| Antes de S1 | Crear el repositorio público en GitHub y subir `main`, o instalar `gh` y pedírmelo |
| Antes de S2 | Generar `KIRO_API_KEY` y ponerla en `.env`. Comprobar en qué cuenta están los créditos (ver nota) |
| Antes de S9 | Arrancar Docker Desktop |
| 30 nov – 3 dic | Grabar el vídeo (menos de 3 min) y subirlo a YouTube como público |
| Antes del 3 dic | Rellenar Devpost: categoría Resurrection, URL de la demo, repositorio, vídeo y write-up |

**Nota sobre cuentas:** `kiro-cli` debe tener la sesión iniciada con la misma cuenta que el IDE, que es la que tiene los créditos del hackathon. Compruébalo con `kiro-cli whoami`. Si `kiro-cli chat --list-models` solo muestra los modelos del plan Free (sin Opus), está en otra cuenta.

## Discord: avisos gratis y control desde el móvil

Hay dos piezas distintas. Usa la gratuita siempre que puedas.

### 1. Avisos y estado: `pnpm notify` (0 créditos)

Usa el bot de Kiro Crew y te escribe por **mensaje directo**. No pasa por ningún modelo de Kiro.

```powershell
pnpm notify "texto"              # manda el texto tal cual
pnpm notify --status             # estado: tareas por spec, siguiente sesión y días restantes,
                                 # más un resumen corto escrito por Ollama (qwen3.5:4b, local)
pnpm notify --status --dry-run   # ver el mensaje sin enviarlo
```

- Los números (tareas, sesión, días) se calculan en el script y no los inventa el modelo. Ollama solo redacta el resumen. Si Ollama está parado, el mensaje sale sin resumen.
- `pnpm session` avisa solo al terminar cada sesión, tanto si sale bien como si falla. Para desactivarlo: `$env:AGENTLIFE_NOTIFY="0"`.
- Para el resumen hay que tener Ollama arrancado (`ollama serve`).
- Si quieres un resumen diario, crea una tarea programada de Windows que ejecute `pnpm notify --status` en `D:\Kiroween`. No uses un cron de Crew para esto, porque gasta créditos.

### 2. Trabajar desde el móvil: Kiro Crew (gasta créditos)

Escribes al bot por DM y Crew abre una sesión de Kiro con herramientas. Úsalo solo cuando estés fuera.

- Crew tiene un steering propio (`~/.kiro/crew/workspace/.kiro/steering/kiroween-project.md`) que le indica trabajar en `D:\Kiroween`, leer `STATUS.md` y el steering del proyecto, y lanzar las sesiones con `pnpm session`.
- Requisitos: PC encendido, app KiroCrew abierta y Ollama arrancado si quieres resúmenes.
- Mensajes útiles:
  - `pnpm notify --status`: Crew solo ejecuta el comando y el resumen lo hace Ollama, lo más barato.
  - `Lanza la siguiente sesión del proyecto` → ejecuta `pnpm session next` (gasta según el plan de esa sesión).
  - `!stop` → cancela el turno en curso.
- Crew no hace push, merge ni reescribe el historial desde el chat.
- Las aprobaciones de Crew están en modo `auto` (`agent.approval_mode`), así que las herramientas se ejecutan sin pedirte confirmación. Si prefieres botones de aprobar o rechazar en el móvil, cámbialo a `interactive` en Settings → Security de Crew.
