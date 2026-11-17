# Roadmap después de Kiroween

Ideas decididas para después de la entrega (2026-12-04). Cada una será una spec más del TASKMAP, hecha por el conductor. El objetivo: convertir AGENT LIFE en un hotel de agentes útil en el día a día, no solo para el hackathon.

---

## Principio de diseño

El hotel no debe depender de un único proveedor de IA ni de una única herramienta. El Architect, el Developer y el QA son roles; detrás de cada rol puede haber kiro-cli, Ollama local, OpenAI, Groq, Codex o cualquier API compatible. El usuario elige el proveedor por proyecto y por rol desde la interfaz de RR.HH.

---

## 1. Multi-runtime: agentes dinámicos (prioritario)

**Propuesta (2026-11-16):** hoy todos los agentes de trabajo usan `kiro-cli --v3`. Se quiere poder elegir el proveedor por rol y por proyecto.

### Nuevos runtimes

| Runtime | Proveedor | Coste | Sandboxing |
|---|---|---|---|
| `KiroCliRuntime` | kiro-cli (ya existe) | créditos Kiro | completo (`permissions.rules`) |
| `OllamaAgentRuntime` | Ollama local (llama3.1, qwen3.5...) | gratis | validación del diff del motor |
| `OpenAICompatRuntime` | OpenAI, Groq, Codex, cualquier API v1 | según proveedor | validación del diff del motor |

### Arquitectura

```
AgentRuntime (interfaz)
├── KiroCliRuntime   → kiro-cli --v3 (Architect, Developer, QA hoy)
├── OllamaAgentRuntime → POST /v1/chat/completions (loopback only)
└── OpenAICompatRuntime → POST https://<base>/v1/chat/completions
```

Todos comparten los mismos prompts (en `packages/agent-engine/prompts/`). El motor valida el diff siempre, independientemente del runtime.

### Fase 1: Architect y QA con Ollama (sin riesgo)

Son read-only: aunque un modelo local planifique mal, no puede escribir código. Desde RR.HH. se elegiría "Runs locally (Ollama)" al contratar. Configuración sugerida:

- Architect: `llama3.1:8b` o `qwen3.5:4b` (ya instalado)
- QA: `llama3.1:8b`
- Developer: `kiro-cli` (mantiene el sandboxing)

### Fase 2: Developer con OpenAICompat

El Developer puede usar cualquier API, pero pierde el sandboxing de `kiro-cli`. El motor compensa:
- validación del diff (rutas, tamaño, binarios, CI files)
- Docker con `--network none`
- aprobación humana del plan sigue siendo obligatoria

### Decisiones de seguridad pendientes

- El Developer con un runtime externo no tiene `permissions.rules`. Mitigación: diff validator + Docker. ¿Aceptable?
- Las claves de API (GROQ_API_KEY, OPENAI_API_KEY...) van en `.env` como KIRO_API_KEY. Nunca al cliente.
- `OllamaAgentRuntime` solo acepta `127.0.0.1` o `::1` como base URL.

### Spec: `multi-runtime`

Sessions estimadas: S42-S44. Sesiones: S42 (OllamaAgentRuntime + UI en RR.HH.), S43 (OpenAICompatRuntime), S44 (tests, baselines, docs).

---

## 2. Tickets room (Jira primero)

**Propuesta (2026-11-14):** sala del hotel donde los tickets del equipo se convierten en trabajos de los agentes.

### Qué da

- Una sala "Tickets" con un tablón: lista los tickets de un proyecto de Jira (o de otra fuente) con estado, prioridad y responsable.
- Elegir un ticket abre el formulario de trabajo con el objetivo ya rellenado.
- El informe y la rama entregada quedan enlazados al ticket.
- Más adelante, con aprobación del usuario: añadir un comentario al ticket con el resumen y el nombre de la rama.

### Diseño

- **Adaptadores por fuente** detrás de `TicketSource` en el agent-engine: `local`, `github-issues`, `jira`. El hotel no sabe de qué fuente viene un ticket.
- **Solo lectura al principio.** La escritura de vuelta (comentario) es una segunda fase.
- **Red limitada.** Solo el motor se conecta, solo a dominios en `config/ticket-sources.json`.
- **Texto no fiable.** Título y descripción cercados al Architect, comprobaciones fijas de inyección y escáner de secretos.
- **Token de Jira** en `.env` con permiso mínimo (lectura de los proyectos elegidos).

### Orden de implementación

1. Fuente `local` (fichero Markdown, sin red, sirve para la demo).
2. `github-issues`.
3. `jira` de solo lectura.
4. Comentario de vuelta con aprobación.

### Spec: `ticket-room`

Sessions estimadas: S45-S47.

---

## 3. Multiplataforma y distribución

- **Instalador de escritorio** (Electron o Tauri) para que el hotel arranque con doble clic sin instalar Node ni Docker.
- **Docker Compose** (`compose.yml`) para que el hotel entero arranque con `docker compose up`.
- **Modo cloud** (opcional, largo plazo): motor en un servidor propio, el cliente en el navegador de cualquier equipo.

---

## 4. Mejoras de la demo

- **Baselines de CI en Linux:** tras el primer push verde en el runner de Linux, ejecutar `e2e:update-visuals` y commitear las baselines. CI detectará regresiones visuales en ambas plataformas.
- **Re-grabar el replay con kiro-cli real** cuando los créditos se renueven (~1 de diciembre).
- **Vídeo actualizado** con multi-runtime y la tickets room.

---

## 5. Calidad y mantenimiento

- **Night-shift noche real:** dejar el motor encendido una noche con un trabajo programado. Verificar el resumen matutino en el buzón.
- **hr-desk importaciones reales:** probar el flujo completo con una fuente real en `config/catalogue-sources.json`.
- **ghost-skins check visual:** ver cada parte a 1x en cada color de rol.
- **`pnpm bugsack`** como alias de `pnpm run bugs` para que sea más fácil de recordar.

---

## Prioridad

1. `multi-runtime` — transforma el hotel de "depende de Kiro" a "elige tu proveedor".
2. `ticket-room` — conecta el hotel con el flujo de trabajo diario.
3. Distribución — reduce la fricción de instalación.
4. Calidad y noche real.
