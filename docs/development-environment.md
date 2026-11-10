# AGENT LIFE — Entorno de desarrollo

## Decisión

Desarrollo en Windows nativo con Node 22, pnpm, Docker Desktop y `kiro-cli`. No se instala Godot ni ningún motor de juego. WSL queda como plan B si alguna herramienta da problemas en Windows.

## Qué tienes y qué falta [Verificado en esta máquina el 2026-11-10]

| Herramienta | Estado | Acción |
|---|---|---|
| Kiro IDE | Instalado | Ninguna |
| `kiro-cli` 2.34 | Instalado | Comprobar que hay una sesión iniciada (`kiro-cli whoami`) y generar `KIRO_API_KEY` para el uso headless (requiere un plan Pro o superior) |
| Git 2.45 | Instalado | Ninguna |
| Node.js 22.15 | Instalado | Ninguna. Fijar `"engines": {"node": ">=22"}`. |
| pnpm | Instalado | Fijar la versión con `packageManager` en `package.json` |
| Docker 29.4 | Instalado | Comprobar que Docker Desktop arranca con el backend WSL2 |
| Python 3.13 | Instalado | No hace falta en el MVP |
| Ollama 0.40 | Instalado y parado | Arrancarlo cuando se trabaje en `LlmRuntime` |
| GitHub CLI (`gh`) | **Falta** | `winget install GitHub.cli`, y después `gh auth login` |
| Codex CLI | **No está en el PATH** | Si lo usas como extensión o app, sirve para revisión. Para invocarlo desde scripts (`codex exec`), instalar el CLI según la [documentación de OpenAI](https://developers.openai.com/codex). |
| Editor de pixel art | Falta | Ver la tabla de opcionales |

## Obligatorio para el MVP

| Herramienta | Uso |
|---|---|
| Kiro IDE + `kiro-cli` | Desarrollo con specs, hooks y steering. Runtime de los agentes del producto. |
| Node 22 + pnpm | Monorepo |
| TypeScript 5, Vite, PixiJS 8 | Cliente |
| `ws`, `zod`, `better-sqlite3` | Servidores y protocolo |
| Vitest + fast-check | Pruebas unitarias y *property-based testing*. Los jueces preguntan explícitamente por PBT, y la geometría isométrica, el pathfinding y la máquina de estados se prestan a ello. |
| Docker Desktop | Pruebas aisladas del repositorio objetivo |
| Git + GitHub + `gh` | Repositorio público obligatorio, ramas y PR |
| Cuenta de GitHub con el repositorio público y licencia MIT desde el primer commit | Requisito de las bases |

## Opcional

| Herramienta | Cuándo |
|---|---|
| Aseprite (de pago) o LibreSprite (gratis) | Sprites de personajes y muebles, exportados como spritesheet JSON. **Por verificar:** que el formato "JSON hash" que exporta Aseprite carga directamente en `Spritesheet` de PixiJS. |
| Blender | Solo si se decide renderizar modelos 3D CC0 a sprites isométricos, como hace The Grand. Es más trabajo de pipeline. Decidirlo tras un prototipo de un día. |
| Packs CC0 de Kenney o Quaternius | Base de muebles y personajes. Revisar la licencia de cada pack antes de usarlo. |
| Playwright | Una prueba e2e de humo del modo demo antes de publicar |
| Ollama con un modelo de 8 a 14B con tool calling | Probar a Architect en local. Ya tienes `qwen3.5:4b`, `llama3.1` y `phi3.5`. |
| Kiro Crew + Discord | Avisos del flujo de desarrollo (ver más abajo) |
| Netlify, Cloudflare Pages o GitHub Pages | Publicar el cliente en modo demo |
| WSL2 | Plan B si alguna herramienta falla en Windows |

## División de responsabilidades de las herramientas de IA

| Herramienta | Responsabilidad | Integración posible (verificada en documentación) |
|---|---|---|
| **Kiro IDE** | Ingeniero principal. Escribe specs (requisitos → diseño → tareas) por funcionalidad y las implementa. Mantiene el steering y ejecuta los hooks. | Specs, hooks, steering, MCP y custom agents |
| **`kiro-cli`** | Runtime de los agentes del producto. Opcionalmente, scripts de CI. | `--no-interactive`, `--agent`, `permissions.rules` y `stream-json` ([headless](https://kiro.dev/docs/cli/headless.md)) |
| **Codex** | Revisor independiente de cada PR antes de fusionar, y segunda opinión en decisiones de diseño. No escribe en `main`. | `codex exec` o `codex review` desde terminal [Por verificar la instalación] |
| **Ollama** | Diálogo de ambiente de los agentes y experimentos con Architect local. No hace el trabajo de código. | API compatible con OpenAI en `localhost:11434/v1` |
| **Kiro Crew + Discord** | Avisos al terminar tareas de spec o fallar las pruebas, y resumen diario del estado. Consultas remotas ("¿qué falta para la fase 2?"). | Crew acepta DM de usuarios permitidos y puede enviar mensajes a Discord con `send_message` ([docs Discord](https://kiro.dev/docs/crew/interfaces/discord.md)). **No documentado:** que un mensaje de Discord dispare una tarea concreta de una app. |
| **Tú** | Producto y alcance, aprobación de specs, fusión de PR, aprobación de cualquier acción destructiva o pública y grabación del vídeo | |

### Flujo con Git

1. `main` siempre desplegable y protegida. Una rama por spec o tarea: `feat/world-room`, `feat/agent-engine-pipeline`, etc.
2. Kiro implementa la tarea en la rama y los hooks ejecutan typecheck y pruebas.
3. Se abre un PR con `gh pr create`.
4. Codex revisa el diff y deja sus observaciones en el PR o en `docs/reviews/`.
5. Tú fusionas.
6. Crew avisa en Discord del merge y del estado de la fase.

### Contenido mínimo de `/.kiro` (se evalúa)

- `steering/product.md`, `steering/tech.md`, `steering/structure.md` y `steering/security.md`. Este último recoge las reglas de "no recursos de Habbo", "los agentes no hacen push" y "las pruebas solo en Docker".
- Una spec por bloque: `world-room`, `agent-engine`, `agent-pipeline`, `demo-replay`.
- Hooks: typecheck y pruebas al guardar en `packages/**`, comprobación de que el protocolo de `shared` no rompe el cliente, y aviso a Discord al completar una tarea de spec.
- Custom agents: los tres agentes `agentlife-*` del producto también viven aquí, porque los usa `kiro-cli`.

## Navegador y despliegue

- **Navegadores de destino:** Chrome, Edge y Firefox recientes. PixiJS 8 usa WebGL o WebGPU.
- **Modo demo:** sitio estático sin backend, publicado en una URL pública.
- **Modo en vivo:** solo en local. Necesita los dos procesos Node, Docker y `kiro-cli` con sesión iniciada.
