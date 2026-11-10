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
