# AGENT LIFE — MVP y hoja de ruta

## Decisión

Un MVP de **una sola habitación y un único flujo real** (Architect → aprobación → Developer → pruebas → QA → buzón) sobre un repositorio de prueba propio. Se publica en modo demo antes del 3 de diciembre y la funcionalidad se congela el 1 de diciembre.

## Incluido

| Área | Alcance |
|---|---|
| Habitación | Una habitación isométrica fija, definida en JSON: suelo con heightmap plano o de 2 niveles, dos paredes y unos 10 muebles colocados. Sin editor. |
| Avatar del usuario | Uno, controlable con clic para caminar (pathfinding A*), en 4 direcciones con espejo y animaciones idle y walk. |
| Agentes | Architect, Developer y QA como avatares con nombre, color de rol e indicador de estado sobre la cabeza (icono y texto corto). Caminan a anclas (escritorio, tablón, buzón) según los eventos. |
| Muebles interactivos | **Ordenador** (nuevo trabajo), **buzón** (aprobaciones e informes) y **tablón** (línea temporal del trabajo). El resto es decoración. |
| Flujo real | Un repositorio de prueba de la lista permitida. Architect propone de 1 a 5 tareas y el usuario aprueba una. Developer la implementa en un worktree. El motor ejecuta las pruebas en Docker y QA revisa. Al final llega un informe con el plan, el diff, el log de pruebas y el veredicto. |
| Agent Engine | Pipeline, `KiroCliRuntime`, SQLite con registro de eventos, API HTTP + SSE, tiempos máximos y cancelación. |
| Diálogo de ambiente | Frases de los agentes con Ollama si está disponible y frases predefinidas si no. |
| Modo demo | Reproductor de una ejecución real grabada, publicado en una URL pública. |
| Temática Kiroween | Skin nocturna o "encantada" del hotel: paleta, iluminación y nombres. Barata de hacer y necesaria para pasar la primera fase. |
| Uso de Kiro | `/.kiro` con steering, 4 specs, hooks, custom agents y pruebas PBT de geometría y máquina de estados. |

## Excluido de forma explícita

- Más habitaciones, puertas, navegador de salas y edificios.
- Multijugador, cuentas, login y chat entre usuarios.
- Researcher, Reviewer y Coordinator como agentes LLM (el Coordinator es una plantilla).
- Nevera, biblioteca/RAG, televisión, laboratorio y memoria a largo plazo.
- Repositorios arbitrarios por URL, push, PR automáticos y merges.
- Integración de Discord o GitHub **dentro del producto** (sí se usan en el flujo de desarrollo).
- Editor de habitaciones, catálogo de muebles e inventario.
- Creador de avatares y ropa.
- Despliegue del modo en vivo en un servidor público.
- Selección de modelo desde la UI (se configura en `agents.yaml`).

## Calendario (hoy es 10 de noviembre y la entrega es el 4 de diciembre)

| Fase | Fechas | Entregable | Criterio de salida |
|---|---|---|---|
| 0. Base | 11–12 nov | Repositorio público con MIT y `/.kiro` con steering. Monorepo con `shared`, `client`, `world-server` y `agent-engine` vacíos. CI con typecheck y pruebas. **Solicitar los créditos de Kiro.** Prueba de estilo visual: un mueble y un personaje. | `pnpm test` en verde en CI. Estilo visual decidido. |
| 1. Mundo | 13–18 nov | Habitación, avatar con clic para caminar, muebles, WebSocket con el World Server, agentes que caminan a anclas con eventos simulados y paneles de ordenador, buzón y tablón (vacíos). | El flujo completo se ve con un Agent Engine falso que emite eventos. |
| 2. Motor | 17–23 nov (se solapa con la fase 1) | Agent Engine con máquina de estados, SQLite, HTTP + SSE y `KiroCliRuntime`. Architect real sobre el repositorio de prueba. Aprobación en el buzón. | Un plan real aparece en el buzón y la aprobación desbloquea el paso siguiente. |
| 3. Flujo completo | 24–29 nov | Developer en worktree, validación del diff, pruebas en Docker, QA, informe, cancelación y tiempos máximos. Exportación de eventos. | 3 ejecuciones seguidas de principio a fin sin intervención manual, salvo la aprobación. |
| 4. Pulido | 30 nov – 1 dic | Skin Kiroween, sonido opcional, modo demo publicado, README en inglés y atribuciones. **Congelación de funcionalidad el 1 de diciembre.** | La URL pública funciona en un navegador limpio. |
| 5. Entrega | 2–4 dic | Vídeo de menos de 3 minutos, write-up del uso de Kiro, descripción en Devpost y post o blog opcionales para los premios extra. | Entregado antes del 4 de diciembre a las 14:00 PT. Margen: entregar el día 3. |

## Si el tiempo no llega, se recorta en este orden

1. Ollama para el diálogo de ambiente: se queda solo con frases predefinidas.
2. El reintento de QA a Developer.
3. El tablón: el estado se ve solo sobre las cabezas.
4. Las animaciones de caminar de los agentes: pasan a teletransporte con fundido.

**No se recorta:** el flujo real, la aprobación humana, el modo demo ni `/.kiro`.

## Después del hackathon (orden orientativo)

1. Researcher + televisión, y biblioteca con RAG (`nomic-embed-text`).
2. Codex como Reviewer independiente.
3. Discord en el producto: aprobaciones y avisos vía Kiro Crew. Valorar empaquetarlo como app de Kiro Crew.
4. Más habitaciones y departamentos, puertas y multijugador.
5. PR reales en GitHub con aprobación.
