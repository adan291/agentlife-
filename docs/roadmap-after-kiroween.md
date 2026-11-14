# Roadmap después de Kiroween

Ideas decididas para después de la entrega (2026-12-04). No entran antes de la congelación del 2026-12-01. Cada una será una spec más del TASKMAP, hecha por el conductor.

## 1. Tickets room (Jira primero)

Propuesta del usuario (2026-11-14), que usa Jira en su trabajo. Una sala del hotel donde los tickets del equipo se convierten en trabajos de los agentes.

### Qué da
- Una sala "Tickets" con un tablón: lista los tickets de un proyecto de Jira (o de otra fuente), con su estado, prioridad y responsable.
- Elegir un ticket abre el formulario de trabajo con el objetivo ya rellenado (título y descripción del ticket) y la planta del proyecto del hotel que le corresponde.
- El informe y la rama entregada quedan enlazados al ticket (`agentlife/<task>` con la clave del ticket en el mensaje del commit, por ejemplo `PROJ-123`).
- Más adelante, y solo con la aprobación del usuario en el buzón: escribir un comentario en el ticket con el resumen y el nombre de la rama. Nunca cambia el estado del ticket ni lo cierra.

### Diseño
- **Adaptadores por fuente** detrás de una interfaz `TicketSource` en el agent-engine (como `AgentRuntime`): `jira`, `github-issues`, `local` (un fichero Markdown en `D:\AgentHotel`). La sala y el world-server no saben de qué fuente viene un ticket.
- **Solo lectura al principio.** La primera versión solo lee. La escritura (comentario) es una segunda fase, con una aprobación por comentario.
- **Red limitada.** El engine es el único que se conecta, solo a los dominios de `config/ticket-sources.json` (lista permitida, vacía por defecto, como `catalogue-sources.json`). Sin redirecciones, tiempo y tamaño máximos. Los agentes siguen sin red.
- **Secretos.** El token de Jira (API token de Atlassian o OAuth) viene de `.env` o variables de entorno, nunca del cliente ni de los logs. Permiso mínimo: lectura de los proyectos elegidos.
- **Texto no fiable.** Título, descripción y comentarios de un ticket son datos, nunca instrucciones: se pasan cercados (`fence`) al Architect, con las mismas comprobaciones de inyección que las importaciones de RR. HH., y el escáner de fugas antes de guardarlos.
- **Mapa ticket → proyecto.** Cada proyecto del hotel dice qué proyecto de Jira (clave) le corresponde. Un ticket de otro proyecto no se puede lanzar.

### Orden
1. Fuente `local` y la sala (sin red, sirve para la demo).
2. `github-issues` (el repositorio ya está en GitHub).
3. `jira` de solo lectura.
4. Comentario de vuelta con aprobación.

### Riesgos
- Prompt injection desde tickets escritos por otras personas: mitigado con el cercado, las comprobaciones fijas y la aprobación del plan, que sigue siendo obligatoria.
- Tokens de empresa en una máquina personal: el usuario decide qué token usar; el hotel solo pide lectura.
- Jira Cloud y Jira Data Center tienen APIs distintas: empezar por Cloud (REST v3).
