# AGENT LIFE — Auditoría de viabilidad

Fecha: 2026-11-10. Estado: pendiente de revisión y aprobación. No se ha escrito código de aplicación.

Etiquetas usadas en todos los documentos:

- **[Verificado]**: comprobado leyendo código, ejecutando comandos en esta máquina o en documentación oficial.
- **[Supuesto]**: razonamiento propio no comprobado.
- **[Por verificar]**: dato necesario que todavía no se ha confirmado.

## Recomendación

**Cliente web propio en TypeScript + PixiJS v8, con un backend Node.js/TypeScript dividido en dos procesos (World Server y Agent Engine). Los agentes Developer y QA ejecutan su trabajo a través de `kiro-cli` en modo headless, dentro de un git worktree aislado. Las pruebas se ejecutan de forma determinista en un contenedor Docker sin red.**

- **The Grand no se usa como base.** Se usa como referencia técnica (licencia MIT) y, como mucho, se copian módulos pequeños con atribución y declarándolo en la entrega.
- **Godot queda descartado** para este proyecto.
- **Categoría de Kiroween recomendada:** *Resurrection*. El argumento es traer de vuelta los hoteles sociales isométricos de la era Shockwave como oficina de agentes de IA.

Detalle de la comparación en [technology-comparison.md](technology-comparison.md) y de las decisiones en [risks-and-decisions.md](risks-and-decisions.md).

## Restricción dominante: las bases de Kiroween 2026

Estas condiciones pesan más que cualquier preferencia técnica. Fuente: [bases oficiales](https://kiroween.devpost.com/rules) y [página del hackathon](https://kiroween.devpost.com/). [Verificado]

| Regla | Consecuencia para AGENT LIFE |
|---|---|
| Plazo de entrega: 4 de diciembre de 2026, 14:00 PT. Hoy es 10 de noviembre. | Quedan unos 24 días. El MVP tiene que caber en unas 3 semanas de desarrollo y unos 3 días de vídeo y textos. |
| Solo proyectos nuevos creados en el periodo. Se puede usar código abierto, pero hay que declarar el código previo y la entrega debe "mejorar y construir sobre" él. | Hacer un fork de un juego de 30.000 líneas ajeno deja la mayor parte del trabajo fuera del periodo y fuera de tu autoría. Es un riesgo alto en elegibilidad y en el criterio "Technological Implementation". |
| La entrega debe ser obra original del participante y no infringir propiedad intelectual. | Ningún recurso de Habbo. Los recursos de terceros, solo con licencia CC0 o MIT y con atribución. |
| Repositorio público en GitHub, con licencia open source visible y carpeta `/.kiro` en la raíz (specs, hooks, steering). | Se trabaja con specs, hooks y steering desde el primer día, porque eso también se evalúa. |
| URL de una aplicación funcional que los jueces puedan probar, y vídeo de menos de 3 minutos. | Los jueces no pueden usar tu Ollama local ni tus credenciales de Kiro. Hace falta un **modo demo reproducible** que funcione sin backend (ver [architecture-proposal.md](architecture-proposal.md)). |
| Materiales de la entrega en inglés. | La UI, el README, el vídeo y el write-up deben estar en inglés. Los documentos internos pueden quedarse en español. |
| Créditos de Kiro: 4.000 por participante. Se solicitan antes del 1 de diciembre a las 12:00 PT. | Solicitarlos ya. Medir cuántos créditos consume cada ejecución de agente. |
| Criterios: impacto, implementación con Kiro, diseño, innovación y presentación, con un 20 % cada uno. La primera fase eliminatoria exige encajar en la temática. | Además de que funcione, el producto necesita una capa visual "de Halloween" coherente y un vídeo que muestre el flujo completo. |

## Auditoría de The Grand (jt-habbo-hotel)

Clonado en `%TEMP%\jt-habbo-hotel`, fuera del workspace, y probado en esta máquina (Windows, Node 22.15). [Verificado]

### Lo que es

- **Qué es:** un mundo social isométrico de temática casino-resort, de Josh Taylor, con licencia MIT.
- **Historial:** 353 commits entre el 3 y el 14 de agosto de 2026. No hay actividad desde el 14 de agosto. El trabajo lo hacían agentes de IA ("runner workers") siguiendo `CLAUDE.md`.
- **Estructura:** monorepo pnpm con cinco piezas:
  - `client`: Vite + PixiJS 8, sin framework de UI. `main.ts` concentra 1.455 líneas.
  - `server`: Node, `ws`, `better-sqlite3` y `zod`, con REST en `/api` y WebSocket en `/ws`.
  - `shared`: protocolo y lógica isométrica.
  - `generator`: pipeline de assets.
  - `tools`: Blender y decoración.
- **Tamaño:** unas 30.600 líneas de TypeScript, incluidas las pruebas.

### Lo que tiene de valor

| Área | Hallazgo |
|---|---|
| Render isométrico | Proyección, heightmap con alturas, ordenación por profundidad, paredes, decoración de suelo y zoom ×1/×2 con muestreo nearest. |
| Muebles | Catálogo tipado (`FurniDefSchema`) con huella, alturas de apilado, asientos e interacciones mediante un único verbo `use` (`vend`, `read`, `toggle`…). Ese modelo encaja con "mueble como interfaz". |
| Avatares | Sistema de figuras por capas en 8 direcciones, con creador de avatar. |
| Servidor | Autoritativo: pathfinding en el servidor, mensajes validados con zod, límites de payload, rate limit, lista de orígenes permitidos, tokens con hash y TTL. |
| NPC | `npc.ts` (900 líneas): NPC con rutas, asientos, saludos y respuestas por LLM a través de un endpoint compatible con OpenAI (por defecto Ollama `gemma3:4b`). Tiene topes diarios de llamadas, filtro de salida, mitigación de prompt injection y vuelta a frases predefinidas si el LLM falla. |
| Assets | Generados por pipeline propio: render de Blender y cuantización a paleta. Usa mallas del Furniture Kit de Kenney (CC0), sin texturas. La documentación prohíbe explícitamente copiar implementaciones de Habbo derivadas (Havana AGPL, nitro). No se ha encontrado ningún recurso de Habbo. |
| Pruebas | Muchas: 255 pruebas en `shared` y 16 ficheros en el cliente, que pasan en Windows. El build del cliente funciona (bundle principal de 606 kB). |

### Lo que no sirve o bloquea

| Problema | Evidencia |
|---|---|
| **Dominio equivocado** | La mayor parte del servidor es economía de casino: blackjack, ruleta, tragaperras, intercambios, libro contable de "Stars", colecciones y museo. Los módulos exclusivos de economía suman unas 1.900 de las 6.080 líneas del servidor, y además hay lógica mezclada en `room.ts` y `server.ts`. Todo eso habría que quitarlo. |
| **Los NPC no son agentes** | Solo generan una línea de diálogo (máximo 60 tokens). No tienen herramientas, tareas, memoria ni estado de trabajo. El Agent Engine habría que hacerlo desde cero de todas formas. |
| **El servidor no arranca en Windows** | En 18 sitios usa `new URL(...).pathname` en lugar de `fileURLToPath`. Al arrancar falla con `ENOENT ... 'C:\C:\Users\...'`, y 34 suites del servidor y 2 del generador fallan por esa causa. El `Makefile` necesita bash (`trap`, `rm -f`) y el script de pruebas `"true"` de `tools` no existe en Windows. Se arregla con poco trabajo o usando WSL, pero no funciona tal cual. |
| **Acoplamiento a infraestructura privada** | `CLAUDE.md` y `.mcp.json` dependen de un bug tracker privado (`jtbug`) y de un VPS propio. |
| **Elegibilidad en Kiroween** | Ver la tabla anterior. El hotel, el render y los avatares, que son lo más visible, serían trabajo previo ajeno. |
| **Mantenimiento** | Un solo autor, proyecto inactivo desde hace 3 meses, código generado por IA con muchas referencias a issues internos (`#423`, `#451`…) difíciles de seguir sin su tracker. |

### Veredicto sobre The Grand

**No usarlo como base.** Sirve como referencia de diseño. Si ahorra tiempo de verdad, se pueden incorporar ficheros pequeños y autocontenidos de `packages/shared` (proyección, heightmap, ordenación por profundidad, pathfinding), respetando la licencia MIT (copyright y aviso de licencia) y declarándolos en el README y en Devpost.

## Viabilidad del MVP

| Pregunta | Respuesta |
|---|---|
| ¿Puede una persona con herramientas de IA tener una habitación isométrica, un avatar, muebles clicables y estados de agentes en unos 6 días? | Sí, con alcance cerrado: una habitación fija, sprites sencillos y 4 direcciones con espejo. [Supuesto basado en el tamaño de los módulos equivalentes de The Grand] |
| ¿Puede tener tres agentes reales colaborando en unos 10 días? | Sí, siempre que el flujo sea un pipeline fijo (Architect → Developer → QA) y no una conversación libre entre agentes, y que el trabajo de código lo haga una herramienta existente (`kiro-cli`) en lugar de un agente programador hecho desde cero. |
| ¿Puede probarlo un juez sin tu máquina? | Solo con el modo demo: el cliente reproduce un registro de eventos grabado de una ejecución real. El modo en vivo se enseña en el vídeo y funciona en local. |
| ¿Qué lo haría inviable? | Ampliar el alcance (más salas, multijugador, RAG, Discord dentro del producto), producir arte desde cero sin herramienta ni estilo cerrado, o intentar que el LLM local haga el trabajo de programación. |

## Herramientas disponibles en esta máquina [Verificado]

| Herramienta | Estado |
|---|---|
| Git 2.45, Node 22.15, pnpm, Python 3.13, Docker 29.4, WSL | Instalados |
| `kiro-cli` 2.34 | Instalado. Soporta `chat --no-interactive`, `--agent`, `--trust-tools`, `--output-format stream-json` y `acp` (documentado en kiro.dev). |
| Ollama 0.40.13 | Instalado y parado. Modelos: `qwen3.5:4b`, `llama3.1`, `phi3.5`, `glm-4.7-flash` (17,7 GB), `nomic-embed-text`. |
| GPU | RTX 4060 Ti con 16 GB de VRAM y 32 GB de RAM. `glm-4.7-flash` no cabe entero en VRAM. |
| GitHub CLI (`gh`) | No instalado |
| Codex CLI | No está en el PATH. Puede que lo tengas como extensión o app. [Por verificar] |
