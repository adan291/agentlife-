# AGENT LIFE — Comparación de tecnologías

## Decisión

**Opción C: cliente web propio en TypeScript, con PixiJS v8 para el render, Vite para el build y paneles en DOM sin framework de UI.**

## Criterios

Ordenados por peso para este proyecto y este plazo:

1. Llegar a una demo funcional antes del 4 de diciembre.
2. Que los jueces puedan abrirla desde una URL.
3. Que el código sea original y del periodo del hackathon.
4. Que Kiro (specs, hooks, PBT) sea eficaz sobre el código. El texto plano en TypeScript le favorece; las escenas binarias o los editores visuales no.
5. Control fino del render isométrico estilo Habbo: heightmap, apilado de muebles y ordenación por profundidad.
6. Un solo lenguaje en todo el stack.

## Opción A: The Grand (fork)

Análisis completo en [feasibility-audit.md](feasibility-audit.md).

| Aspecto | Valoración |
|---|---|
| Lenguaje y stack | TypeScript, PixiJS 8, Vite, Node, `ws`, SQLite y zod. Es el mismo stack que se recomienda para la opción C. [Verificado] |
| Render, mapa isométrico, muebles y avatares | Maduros y probados. Es lo mejor del repositorio. |
| WebSocket y protocolo | Bien hechos: unión discriminada con zod y servidor autoritativo. |
| NPC y Ollama | Solo diálogo. No sirven como agentes. |
| Persistencia | SQLite con un esquema orientado a economía (cuentas, inventario, libro contable). |
| Build | pnpm y make. Falla en Windows nativo. |
| Licencia y assets | MIT. Assets propios generados con su pipeline a partir de mallas CC0 de Kenney. Sin recursos de Habbo. |
| Seguridad y mantenimiento | Buen endurecimiento de red, pero el proyecto está inactivo, tiene un solo autor y depende de herramientas privadas. |

**Ventaja:** el mejor punto de partida visual posible.

**Inconvenientes:**
- Habría que quitar el casino entero.
- El Agent Engine se haría igualmente desde cero.
- Choca con la regla de "proyecto nuevo y obra original" de Kiroween.

**Veredicto:** descartada como base. Se usa como referencia.

## Opción B: Godot 4

| Aspecto | Valoración |
|---|---|
| Isométrico 2D | `TileMapLayer` admite isometría e Y-sort. El apilado tipo Habbo, con alturas por casilla y muebles de varias casillas, sigue necesitando lógica propia. [Supuesto] |
| Animación | Muy buena: `AnimatedSprite2D` y `AnimationPlayer`. |
| UI | Sistema de `Control` potente, pero con más trabajo para paneles con mucho texto (informes, diffs, logs) que en HTML. |
| Exportación web | Funciona con GDScript. **C# no se puede exportar a web en Godot 4** ([documentación oficial](https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_basics.html)). La web usa el renderer Compatibility, porque Forward+ necesita WebGPU ([docs 4.4](https://docs.godotengine.org/en/4.4/tutorials/export/exporting_for_web.html)). [Verificado] |
| Red y backend de IA | `WebSocketPeer` y `HTTPRequest` bastan para hablar con un backend externo. |
| Flujo con Kiro | Las escenas `.tscn` son texto, pero las genera y mantiene el editor. Kiro es menos fiable editándolas y probarlas automáticamente cuesta más. Introduce un segundo lenguaje (GDScript) frente al backend en TypeScript. |
| Curva de aprendizaje | Herramienta nueva para el desarrollador, a 24 días de la entrega. |

**Veredicto:** descartada. Mejora la animación, pero empeora la entrega web, el trabajo con Kiro, las pruebas y los paneles de texto, que son la mitad de la interfaz de AGENT LIFE. Añade trabajo sin resolver ningún problema que el navegador no resuelva ya.

## Opción C: cliente web propio

### Motor de render: PixiJS frente a Phaser frente a Canvas puro

| | PixiJS v8 | Phaser | Canvas 2D a mano |
|---|---|---|---|
| Qué es | Renderer 2D (WebGL/WebGPU, con Canvas experimental desde 8.16) con escena, eventos de puntero, carga de assets y spritesheets | Motor de juego completo: escenas, física, tweens, tilemaps de Tiled, incluidos isométricos | API del navegador |
| Encaje con habitaciones estilo Habbo | Bueno. La lógica isométrica es propia en cualquier caso, y PixiJS solo dibuja. The Grand demuestra que el enfoque funciona. | Medio. Su tilemap isométrico no modela alturas por casilla ni muebles apilados de varias casillas, así que se acaba esquivando el motor. [Supuesto] | Bueno, pero obliga a rehacer eventos, carga y lotes de dibujo. |
| Peso y complejidad | Bajo | Medio-alto, con muchas funciones que no se usan | Mínimo, pero con más código propio |
| Mantenimiento | Activo: v8.21.0 es la última versión listada ([pixijs.com/versions](https://pixijs.com/versions)). [Verificado] | Activo | No aplica |

**Elección: PixiJS v8.** El problema central es dibujar y ordenar sprites con coordenadas isométricas propias. PixiJS cubre eso y nada más. Phaser es la alternativa razonable si se necesitaran física o un sistema de escenas, y AGENT LIFE no necesita ninguno de los dos.

### UI: ¿React?

**No en el MVP.** Los paneles (ordenador, buzón, tablón, estado de agentes) son pocos y se actualizan por eventos. Bastan DOM con TypeScript y CSS, más un pequeño helper de render. React añade build, estado duplicado entre Pixi y React, y más superficie, sin ventaja clara para 4 o 5 paneles.

**Cambiaría de opinión** si los paneles crecen a formularios complejos, como un editor de tareas o un visor de diffs con navegación. En ese caso usaría Preact o React solo para la capa de paneles.

### Red

- **Cliente ↔ World Server:** WebSocket (`ws` en Node) con mensajes validados con zod en un paquete `shared`.
- **World Server ↔ Agent Engine:** HTTP para órdenes y SSE (Server-Sent Events) para el flujo de eventos. SSE es unidireccional, se reconecta solo y se depura con `curl`.

### Despliegue

El cliente es estático: GitHub Pages, Netlify o Cloudflare Pages. Para los jueces se publica en **modo demo**, que reproduce un registro de eventos real sin backend. El modo en vivo necesita los dos procesos Node, Docker y `kiro-cli`, y se ejecuta en local.

## Opción D: otras alternativas evaluadas

| Alternativa | Motivo para descartarla |
|---|---|
| Forks de emuladores de Habbo (Arcturus, Nitro, Havana) | Derivados del cliente y del protocolo de Habbo, con licencias GPL o AGPL, o sin licencia (nitro-react). Riesgo legal y de IP. La propia documentación de The Grand los descarta por esa razón. [Verificado en `docs/design/PIPELINES.md` de The Grand] |
| Excalibur.js, Kaplay | Válidos, pero no mejoran a PixiJS en isometría y tienen menos ecosistema. |
| Unity WebGL | Bundle pesado, C#, editor binario y mala integración con Kiro. Mismo problema que Godot, pero mayor. |
| Three.js con cámara ortográfica | Daría isometría "gratis" con modelos 3D, pero cambia la estética pixel-art y obliga a producir modelos y rigs. Es interesante después del hackathon, no para un MVP. |

## Backend: lenguaje

| Opción | Valoración |
|---|---|
| **Node.js + TypeScript (elegida)** | Mismo lenguaje que el cliente y protocolo compartido con zod. Lanzar `kiro-cli` y Docker como procesos hijo es sencillo. Suficiente para orquestar un pipeline fijo. |
| Python | Tiene el ecosistema de agentes más grande (LangGraph, CrewAI). Aquí no hace falta, porque el flujo es una máquina de estados fija y el trabajo de código lo hace `kiro-cli`. Añade un segundo lenguaje y otra cadena de herramientas. |
| Java + Spring Boot | Lo conoces bien, pero añade un segundo lenguaje, más arranque y más configuración, y no aporta nada concreto a este MVP. **Cambiaría de opinión** si el Agent Engine creciera hacia multiusuario con colas, transacciones y despliegue empresarial tras el hackathon: la frontera HTTP+SSE permite reescribirlo en Spring Boot sin tocar el cliente. |
| Frameworks de agentes en TS (Mastra, LangGraph.js, Vercel AI SDK) | No hacen falta en el MVP. Para el proveedor de modelos basta una interfaz propia sobre la API compatible con OpenAI (Ollama la expone). Revisar AI SDK si se añaden muchos proveedores con tool calling. |
