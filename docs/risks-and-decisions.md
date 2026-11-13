# AGENT LIFE — Riesgos y decisiones

## Decisión final

**AGENT LIFE se construye con un cliente web propio: TypeScript + PixiJS v8 + Vite, con un World Server y un Agent Engine en Node.js/TypeScript comunicados por HTTP + SSE. Los agentes Developer y QA trabajan con `kiro-cli` headless.** The Grand se usa solo como referencia y Godot queda descartado.

## Registro de decisiones

### D1. Base visual: cliente web propio

- **Recomendación:** opción C, con PixiJS v8 y lógica isométrica propia.
- **Por qué:** cumple las reglas de Kiroween (proyecto nuevo y obra original), da una URL que los jueces pueden abrir, usa un solo lenguaje y Kiro trabaja bien con TypeScript en texto plano.
- **Alternativas:** fork de The Grand, Godot 4, Phaser, Canvas a mano, Three.js ortográfico y forks de emuladores de Habbo.
- **Compromiso:** se reescriben render, muebles y avatares en lugar de heredarlos maduros. Se pierde calidad visual inicial a cambio de alcance propio y elegibilidad.
- **Cambiaría si:** la organización de Kiroween confirma por escrito que un fork declarado de un proyecto MIT de terceros no penaliza, y el plazo fuese mayor. Incluso así, habría que quitar el casino.

### D2. The Grand: referencia, no base

- **Recomendación:** leer su código para resolver isometría, profundidad y pathfinding. Si se copia algún fichero, mantener el aviso MIT y declararlo.
- **Por qué:** dominio equivocado (casino), NPC que no son agentes, el servidor no arranca en Windows, inactivo desde el 14 de agosto y riesgo de elegibilidad.
- **Compromiso:** se escribe más código propio, aunque son piezas pequeñas.
- **Cambiaría si:** no hubiera hackathon de por medio. Fuera de Kiroween, un fork recortado sería una opción seria.

### D3. Backend en Node.js/TypeScript, no Java ni Python

- **Por qué:** un lenguaje en todo el stack, protocolo compartido con zod y procesos hijo sencillos de lanzar.
- **Alternativas:** Spring Boot (experiencia previa del desarrollador) y Python (ecosistema de agentes).
- **Compromiso:** no se aprovecha la experiencia en Java.
- **Cambiaría si:** el Agent Engine pasa a ser un servicio multiusuario con colas y transacciones. La frontera HTTP + SSE permite reescribirlo en Spring Boot.

### D4. Orquestación: máquina de estados propia, sin framework

- **Por qué:** el flujo del MVP es fijo y lineal, y un framework añade abstracciones y dependencias sin resolver nada concreto.
- **Alternativas:** LangGraph (Python o JS), CrewAI, Mastra y AI SDK.
- **Compromiso:** si el flujo se vuelve un grafo dinámico con muchos agentes, habrá que construir más.
- **Cambiaría si:** se añaden más de 5 roles con rutas condicionales, o hace falta planificación dinámica entre agentes.

### D5. El trabajo de código lo hace `kiro-cli`, no un agente propio

- **Por qué:** escribir un agente programador fiable (bucle de herramientas, edición de ficheros, contexto) no cabe en 3 semanas. `kiro-cli` ya lo hace, admite permisos por agente y salida JSON, y demuestra un uso avanzado de Kiro, que es el 20 % de la nota.
- **Alternativas:** LLM local con herramientas propias, Codex como runtime principal y API directa de un proveedor.
- **Compromiso:** depende de los créditos y la sesión de Kiro, y el modo en vivo no es portable para los jueces. Se compensa con el modo demo.
- **Cambiaría si:** el consumo de créditos por ejecución resulta inasumible (medirlo en la fase 2) o `stream-json` no da progreso suficiente.

### D6. Pruebas deterministas en Docker, no ejecutadas por el LLM

- **Por qué:** es lo que hace el resultado "verificable" y separa la autoridad: el LLM propone y el motor comprueba.
- **Compromiso:** necesita Docker en local y una imagen con dependencias preinstaladas.

### D7. Modo demo reproducible

- **Por qué:** las bases exigen una URL funcional, y exponer en público un servidor que ejecuta agentes con tus credenciales es caro e inseguro.
- **Compromiso:** el juez ve una ejecución real grabada, no una en vivo. Se dice claramente en pantalla y en Devpost.

### D8. Categoría: Resurrection

- **Por qué:** los hoteles sociales isométricos de la era Shockwave son tecnología "muerta". Reimaginarlos como oficina de agentes de IA encaja en la definición de la categoría.
- **Alternativas:** Frankenstein (juego + agentes + Docker + Discord) y Costume Contest.
- **Cambiaría si:** la estética final destaca más que el concepto. Entonces, Costume Contest.

### D9. Importar plantillas de agentes de fuentes de confianza (spec hr-desk)

- **Decisión:** solo se importan plantillas desde direcciones HTTPS listadas en `config/catalogue-sources.json` (vacío por defecto). Se copian únicamente `id`, `name`, `role`, `persona`, `description` y `defaultModel`; `tools`, `permissions`, `mcpServers`, `hooks`, `resources` y cualquier campo desconocido se descartan y se muestran como "ignorado por seguridad". Los permisos salen siempre de los tiers fijos del repositorio (`agents/tiers/*.json`), nunca de una plantilla.
- **Aprobación:** la plantilla importada solo se puede contratar tras la aprobación del usuario, que se guarda con el hash sha256 del contenido; cualquier cambio exige una aprobación nueva.
- **Por qué:** el texto de internet es dato no confiable (prompt injection). Una plantilla puede cambiar quién es el agente, no lo que puede hacer.
- **Compromiso:** hay una revisión manual por plantilla y la lista de fuentes la mantiene el usuario.

### D10. Revisor de importaciones propio (`agentlife-import-review`) en lugar de `agentlife-security`

- **Decisión:** la revisión de inyección de prompts de una plantilla importada la hace `agentlife-import-review`, un agente con el tier `read-only`, ejecutado en un directorio vacío (`team/service-agents.ts`, `team/import-review.ts`). El requisito 3.3 decía `agentlife-security`; se actualizó el requisito.
- **Por qué:** `agentlife-security` puede escribir en `data/security` y ejecutar git, y no debe recibir texto de internet. Con el tier de solo lectura, un texto malicioso no puede producir efectos aunque engañe al revisor.
- **Compromiso:** hay dos agentes de seguridad que mantener. Además de la revisión del agente, el motor aplica patrones fijos de inyección, topes de tamaño y el escáner de secretos.
- **Pendiente del usuario:** ratificar este cambio (se tomó durante la implementación sin consultarlo). Si prefiere el agente original, hay que dar a `agentlife-security` un tier de solo lectura para esta tarea.

### D11. Segundo runtime de modelo local (`OllamaRuntime`) y agentes de servicio de solo lectura

- **Decisión:** el "Night intern" corre en `runtimes/ollama.ts` (`OllamaRuntime`), no en `LlmRuntime`, con `InternRuntime` como envoltorio que cae a `claude-haiku-5.5` por kiro-cli si Ollama no responde y deja la nota en el informe. Solo acepta direcciones de este equipo (loopback, sin credenciales) y solo los pasos sin herramientas `summary`, `overview`, `memory` y `classify`; el motor rechaza plan, develop y review. Se añaden dos agentes de servicio de solo lectura, `agentlife-import-review` y `agentlife-hr` (sugiere equipos; solo propone, no contrata).
- **Por qué:** `LlmRuntime` es el diálogo de ambiente (una línea, 60 tokens) y no sirve para respuestas completas. El prompt lleva texto del proyecto, por eso no puede salir de la máquina.
- **Compromiso:** dos caminos de modelo local en el motor. Las notas del informe se guardan en memoria y se pierden si el motor se reinicia.
- **Sin probar en vivo:** Ollama con `qwen3.5:4b` y el fallback con `kiro-cli` real.

### D12. Todo miembro contratado se ve en la planta de su proyecto (spec hr-desk, requisito 4.3)

- **Decisión (del usuario, opción A):** el primer miembro de cada rol con mesa (architect, developer, qa) trabaja esa mesa; los demás (un segundo developer, QA, un reviewer, un researcher, el Night intern) están de pie en uno de seis puestos de la planta (`home_guest1`..`home_guest6` en `rooms/project-template.json`). Un equipo de 8 miembros se ve entero: 3 mesas y hasta 5 puestos (hasta 6 si falta el QA).
- **Cómo:** los puestos son avatares de la simulación con id `guest1`..`guest6` (`GUEST_IDS`, `AvatarIdSchema`), no agentes: no tienen estado, trabajo ni eventos, y las listas de agentes (`welcome.agents`, barra de equipo) no cambian. El world-server decide quién ocupa cada puesto y lo manda en `team_view.guests`; `agent_presence` admite ids de puesto. El motor y el contrato de eventos no cambian.
- **Por qué no ids de agente dinámicos:** habría tocado `AGENT_IDS`, los eventos del motor (`ScopedAgentId`), la barra de equipo y los estados por agente, para unas figuras que hoy no trabajan. Los puestos son una capa de solo presencia.
- **Compromiso:** un puesto no es un agente: el segundo developer no hace trabajo visible hasta que pipeline-editor le dé tareas. Si el titular de una mesa se despide y otro del mismo rol toma la mesa, el que estaba de pie sale por el ascensor y el de la mesa entra por él (no camina del puesto a la mesa).

## Riesgos

| # | Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Alcance mayor que el tiempo disponible (24 días, una persona) | Alta | Alto | Lista explícita de exclusiones, orden de recorte definido y congelación de funcionalidad el 1 de diciembre |
| R2 | El arte consume el calendario | Alta | Alto | Decidir el estilo el día 12 con un mueble y un personaje. 4 direcciones con espejo. Packs CC0 como base. Personajes simples con color por rol. |
| R3 | Recursos con IP ajena (Habbo, packs mal licenciados, música) | Media | Alto (descalificación) | Solo CC0 o MIT, con fichero `ASSETS.md` de atribuciones. Nada que recuerde la marca Habbo. Música propia o CC0 en el vídeo. |
| R4 | Elegibilidad por código previo | Baja con D1 | Alto | Repositorio creado en el periodo y declaración de cualquier fragmento externo |
| R5 | Consumo de créditos de Kiro por ejecución | Media | Medio | Medirlo en la fase 2, pedir los 4.000 créditos ya, usar un repositorio de prueba pequeño, tiempos máximos y el modo demo para no repetir ejecuciones. |
| R6 | Un agente escribe fuera del worktree o ejecuta comandos | Baja | Alto | `permissions.rules` con deny, shell denegada, validación del diff por el motor, Docker con `--network none` y límites, y repositorio de prueba propio. |
| R7 | Prompt injection desde el repositorio analizado | Media | Medio | Solo repositorios propios de la lista permitida en el MVP. Los artefactos se tratan como datos y los agentes no tienen red ni shell. |
| R8 | Los modelos locales planifican mal o no hacen tool calling fiable | Alta | Bajo | Ollama no está en el camino crítico. Kiro hace el trabajo y Ollama se limita al diálogo de ambiente. |
| R9 | Problemas de Windows (rutas, scripts de shell, Docker) | Media | Medio | `fileURLToPath` y `path.join` siempre, scripts de pnpm en Node en lugar de bash, CI en Linux y Windows, y WSL como plan B. Es justo el fallo que tiene The Grand. |
| R10 | `kiro-cli` cambia de comportamiento o de flags (hay V2 y V3) | Media | Medio | Fijar `--v3` y la versión, encapsular todo en `KiroCliRuntime` y tener una prueba de contrato con un prompt trivial. |
| R11 | El ritmo real de los agentes (minutos) aburre en el vídeo | Alta | Medio | Reproducción acelerada en el modo demo y montaje del vídeo con cortes. Bocadillos y estados para que siempre "pase algo". |
| R12 | Rendimiento del cliente | Baja | Bajo | Una habitación con menos de 50 sprites no supone carga para PixiJS. |
| R13 | Coste de modelos en la nube | Baja | Bajo | No hay proveedores de pago aparte de Kiro en el MVP |
| R14 | Codex no disponible como CLI | Media | Bajo | Codex solo revisa PR. Si no hay CLI, se usa la extensión o la app. |

## Pendiente de confirmar antes de implementar

1. **Que apruebes esta arquitectura y el MVP.**
2. Tu plan de Kiro: el uso headless con `KIRO_API_KEY` requiere Pro o superior.
3. Cómo tienes instalado Codex (CLI, extensión o app).
4. Si vas solo o en equipo (máximo 3 personas).
5. Categoría final: Resurrection es la propuesta.
6. Estilo visual: pixel art dibujado a mano o render de modelos 3D CC0.

### D13. Vista de lista: resumen de solo lectura y "moverse y actuar" (spec list-mode)

- **Decisión (de Kiro, por encargo del usuario, 2026-11-12):** opción 1 del bloqueo de S26. Un mensaje de solo lectura `overview` (con `overview_watch` para suscribirse) resume todas las plantas de proyecto: trabajo, paso, quién, aprobaciones pendientes, último veredicto e ids de artefactos. `go_to` admite `via: "list"`, que cambia de planta sin pasar por el ascensor. Cada acción de la lista o de la paleta sobre otro proyecto envía primero ese `go_to` y después el mismo mensaje que el mueble.
- **Por qué:** las reglas por planta del gateway (aprobar, entregar o ver detalles solo en la planta propia) siguen siendo el único camino de cada acción, así que no hay una segunda vía que revisar. La lista es la forma de uso diaria del hotel, más allá del hackatón, y necesita ver todos los proyectos.
- **Compromiso:** se relaja la regla "solo desde el ascensor" para la lista. `overview` no lleva rutas, cuerpos de informe ni diffs, solo ids, nombres, estados, cuentas, veredictos y horas. En la demo la lista no está disponible hasta volver a grabarla con varias plantas.
- **Añadido al implementar (S26):** `show_panel { panel }` abre un panel de la planta del usuario sin caminar hasta el mueble (el gateway comprueba que la planta tiene ese mueble, envía los datos del panel y luego `open_panel`). Solo lectura, solo la planta propia, mismo límite de mensajes; paneles permitidos: computer, mailbox, board, review, tests, library, night. Aprobar y rechazar siguen siendo el mensaje `approve` del panel del buzón, así que el plan se lee antes de decidir. `overview` lleva también el número de trabajos nocturnos pendientes por proyecto.
- **Descartadas:** limitar la lista a la planta actual (incumple 1.2, 1.3 y 2.1) y añadir `roomId` a cada comando (cambia el modelo por plantas y duplica las comprobaciones).

### D14. Mover muebles en las plantas de proyecto (spec furni-move)

- **Decisión (de Kiro, por encargo del usuario, 2026-11-12):** el usuario puede mover y girar los muebles de una planta de proyecto. Las reglas son código puro compartido (`shared/src/layout.ts`: `checkMove`, `applyLayout`, `layoutProblem`); el world-server repite siempre la comprobación y guarda la disposición por proyecto en `data/layouts.json` (solo las piezas que difieren de la plantilla). El ascensor no se mueve; el vestíbulo, la oficina de HR y la demo no se pueden editar. El agent-engine no cambia: sigue hablando de anclas semánticas.
- **Por qué:** la plantilla original dejaba todo en una pared. Con la comprobación en el servidor, una disposición nunca puede dejar sin alcanzar una mesa, el buzón o el ascensor, y un cliente modificado no puede saltarse las reglas.
- **Compromiso:** se levanta la exclusión "editor de salas" del MVP solo para plantas de proyecto. Las anclas de trabajo (`desk`, `computer`, `mailbox`, `board`) siguen a su mueble (`Anchor.follows`); los puestos de pie (`home_*`) se quedan en su casilla y ningún mueble sólido puede taparlos (el requisito 3.3 decía que también seguían al mueble; se reformuló). Una disposición guardada que ya no cabe (la plantilla cambió) vuelve a la posición de la plantilla pieza a pieza, sin error.
- **Descartadas:** mover también el ascensor o la puerta (todos entran por esa casilla), y dejar la validación solo en el cliente.

### D15. Una pieza de la tienda con interacción: la cafetera (spec waiting-fun)

- **Decisión (de Kiro, por encargo del usuario, 2026-11-13):** la tienda de furni-shop vendía solo piezas decorativas, sin interacción. La cafetera (`coffee_machine`, página Mesas, 40 Ecto) es la única pieza a la venta con interacción (`coffee`). `SHOP_INTERACTIONS` (shared, `shop.ts`) lista las interacciones permitidas a una pieza comprada; `checkCatalogue` y `Hotel.placeFurniture` rechazan cualquier otra.
- **Por qué:** la regla original quería decir "nada de lo que se vende empieza trabajo". La cafetera solo cambia el ánimo de un fantasma, que es solo visual y nunca llega a un trabajo, un modelo ni un permiso. Servir el café ocurre en el world-server: al llegar, el `open_panel` de `coffee` no sale hacia el cliente.
- **Compromiso:** la regla ya no es "ninguna pieza vendida tiene interacción", sino "solo las de `SHOP_INTERACTIONS`". El ánimo se guarda solo en memoria. Las sillas y los sofás pasan a ser asientos: un clic en ellos sienta al usuario en vez de solo caminar hasta ellos.
- **Descartadas:** una cafetera sin interacción con un botón aparte (obligaría a un mensaje y un panel nuevos) y un fichero para guardar el ánimo (es un adorno).
