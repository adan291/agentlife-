# Plan de sesiones

Cada sesión es una conversación nueva de Kiro. El repositorio es la memoria: el steering `workflow.md` obliga a leer `docs/STATUS.md` al empezar y a actualizarlo al terminar. Copia el prompt de la sesión tal cual.

Reglas generales:
- Una sesión = un bloque de tareas de una spec. No mezclar specs en la misma sesión.
- Abre la sesión desde la spec en el panel Specs de Kiro si aparece; si no, en una sesión Vibe con el prompt.
- Al acabar cada sesión: revisión (sesión R), tú fusionas.

## Calendario

| Sesión | Fecha objetivo | Spec y tareas | Prompt |
|---|---|---|---|
| S1 | 11 nov | world-room 1–4 | `Implement tasks 1 to 4 of the world-room spec (.kiro/specs/world-room). Follow workflow.md.` |
| S2 | 12–13 nov | agent-pipeline 1 (spike kiro-cli) | `Do task 1 of the agent-pipeline spec: the kiro-cli spike. Document findings in docs/spikes/kiro-cli.md. Stop and report if any check fails.` |
| S3 | 13–14 nov | world-room 5–7 | `Implement tasks 5 to 7 of the world-room spec. Follow workflow.md.` |
| S4 | 15–17 nov | world-room 8–10 | `Implement tasks 8 to 10 of the world-room spec. Follow workflow.md. Show me how to run the client when done.` |
| S5 | 17–18 nov | world-room 11–12 | `Implement tasks 11 and 12 of the world-room spec. Follow workflow.md.` |
| S6 | 18–20 nov | agent-engine 1–5 | `Implement tasks 1 to 5 of the agent-engine spec. Follow workflow.md.` |
| S7 | 20–23 nov | agent-engine 6–10 | `Implement tasks 6 to 10 of the agent-engine spec. Follow workflow.md.` |
| S8 | 24–25 nov | agent-pipeline 2–5 | `Implement tasks 2 to 5 of the agent-pipeline spec, using the findings in docs/spikes/kiro-cli.md. Follow workflow.md.` |
| S9 | 26–27 nov | agent-pipeline 6–10 | `Implement tasks 6 to 10 of the agent-pipeline spec. Follow workflow.md.` |
| S10 | 28–29 nov | agent-pipeline 11–13 | `Implement tasks 11 to 13 of the agent-pipeline spec. Run the live runs with me.` |
| S11 | 30 nov | demo-replay 1–4 | `Implement tasks 1 to 4 of the demo-replay spec. Follow workflow.md.` |
| S12 | 1 dic (congelación) | demo-replay 5–6 + Kiroween polish | `Implement tasks 5 and 6 of the demo-replay spec, then list visual polish items for the Kiroween look and do the top three.` |
| S13 | 2–3 dic | demo-replay 7 | `Do task 7 of the demo-replay spec: README, docs/kiro-usage.md and docs/video-script.md, in English.` |

Si una sesión se retrasa: aplicar el orden de recorte de `docs/mvp-roadmap.md`, nunca saltarse agent-pipeline ni demo-replay.

## Sesión R: revisión de una rama (tras cada sesión S)

Dos revisiones independientes:

1. Kiro, con el agente de solo lectura: selecciona el agente `agentlife-reviewer` (o `kiro-cli --agent agentlife-reviewer`) y escribe:
   `Review the current branch against main.`
   Resultado en `docs/reviews/<rama>.md`.
2. Codex, como segunda opinión (app, extensión o `codex review`):
   `Review the diff of this branch against main. Read .kiro/steering/*.md and the matching spec in .kiro/specs first. Report blocking issues with file:line. Do not edit files.`

Después, en la misma sesión S o en una nueva: `Fix the blocking issues listed in docs/reviews/<rama>.md.` Luego fusionas tú.

## Kiro Crew + Discord (opcional, para seguir el proyecto desde el móvil)

Configurar una vez, siguiendo https://kiro.dev/docs/crew/interfaces/discord.md (bot token y tu usuario en `allowed_users`). Usos útiles:
- Cron diario a las 21:00: `Read d:\Kiroween\docs\STATUS.md and the unchecked tasks in .kiro/specs/*/tasks.md. Send me a 5-line summary: done today, next session, risks, days left to Dec 4.`
- Consultas por DM: "¿qué sesión toca hoy?", "¿cuántas tareas quedan?".

Tienes además el premio extra "Best Kiro Crew App"; solo merece la pena si sobra tiempo tras la congelación.

## Fuera de sesiones: tareas tuyas

| Cuándo | Qué |
|---|---|
| Antes de S1 | Crear el repositorio público en GitHub y subir `main` (o instalar `gh` y pedírmelo) |
| Antes de S2 | Generar `KIRO_API_KEY` y ponerla en `.env` (no se sube) |
| Antes de S9 | Docker Desktop arrancado |
| 30 nov – 3 dic | Grabar el vídeo (<3 min), subirlo a YouTube público |
| Antes del 3 dic | Rellenar Devpost: categoría Resurrection, URL demo, repo, vídeo, write-up |
