# Roadmap: Field kit (AGENT LIFE sin red, en un pendrive)

Escrito el 2026-11-25 a partir de la conversación con el usuario. Es trabajo posterior a la entrega de Kiroween. La versión entregada queda en el tag `kiroween-2026`; este trabajo vive en la rama `feat/field-kit` y no se fusiona en `main` hasta después del envío (3 de diciembre).

## Objetivo
Una herramienta fuerte para trabajar donde no hay internet, por ejemplo en un cliente con terminales Linux aisladas y proyectos en Ada. Tiene que caber en un pendrive y arrancar desde él con todo dentro:
- los agentes de AGENT LIFE trabajando con un modelo local;
- un RAG local con la documentación que se quiera cargar;
- un editor con una terminal y botones para los comandos de siempre;
- el bug suite (spec `app-bugs`, rama `feat/app-bugs`), conectado a todo lo anterior.

## Condición previa: el permiso del cliente
En un entorno aislado de un cliente, ejecutar software propio desde un USB suele estar prohibido sin aprobación escrita del área de seguridad. Puede que los puertos USB estén bloqueados o que el pendrive se monte sin permiso de ejecución. Por eso el kit se diseña para pasar una revisión:
- Solo código abierto, con la licencia de cada componente en `ASSETS.md` y en una lista de componentes (SBOM).
- Sin telemetría y sin conexiones de salida. Una prueba lo comprueba: el kit arranca y trabaja con la red cortada.
- Sumas de verificación de cada fichero del kit, y un script que las comprueba antes de arrancar.
- Nada se instala en el sistema. Todo vive en la carpeta del kit, o en la carpeta de usuario si el USB no permite ejecutar.

Sin esa aprobación, el kit no se usa en el cliente.

## Piezas
| Pieza | Elección | Motivo |
|---|---|---|
| IA local | Ollama (ya integrado con `--ai ollama`), y llama.cpp como alternativa | Funciona sin red. llama.cpp es un solo binario, útil en equipos sin permisos |
| Agentes | El motor actual con multi-runtime | Ya funciona con Ollama: trabajo real en DiscordIA y en haunted-todo con `qwen3.5:4b` |
| Aislamiento de tests | Docker si existe; si no, podman sin root o bubblewrap | En el cliente puede no haber Docker. Hay que mantener las reglas de hoy: sin red, con límites, solo lectura y sin root |
| RAG | Embeddings con Ollama (`nomic-embed-text` u otro), guardados en SQLite con sqlite-vec en un solo fichero | Encaja con el stack. Se une a la Library del hotel (project-memory) |
| Respuestas del RAG | Cada respuesta cita el documento y el fragmento, y el motor comprueba que la cita existe | La misma idea que la comprobación de evidencias de app-bugs |
| Editor | VSCodium en modo portable, con extensiones cargadas desde `.vsix` | Base abierta de VS Code, sin tienda ni telemetría. Kiro no se puede redistribuir |
| Terminal con botones | Extensión propia, "command deck": botones definidos en un fichero por proyecto, más paneles del hotel (trabajos, buzón) y del bug suite | Es la pieza que une todo. Wave Terminal (Apache-2.0) queda como alternativa si se quiere una terminal aparte |
| Skills | Ficheros Markdown con instrucciones que el agente carga cuando las necesita, como las skills de Kiro | Funcionan sin red |
| FreeLLM y similares | No van en el kit. Si acaso, son un proveedor más del multi-runtime para proyectos personales con red | Son proxies hacia planes gratuitos en la nube: sin red no sirven, y con código de un cliente son un riesgo |

## Huecos conocidos
1. **Docker en el cliente:** hace falta otra forma de aislar los tests, al menos tan estricta como la de hoy.
2. **Ada:** hoy el hotel solo ejecuta tests de proyectos `node-npm` (y Maven en `app-bugs`). Ada necesita su propio tipo de proyecto con GNAT y gprbuild llevados en el kit. Alire normalmente descarga de internet, así que sus dependencias tienen que ir dentro del kit.
3. **Bug suite con Ada:** no existe un SDK de Sentry para Ada. Hace falta una entrada que lea los logs y las trazas de GNAT y los agrupe con las reglas del Bug sack.
4. **Hardware:** sin GPU, un modelo de 3 a 8B tarda unos minutos por paso (6 minutos para un cambio de una línea, medido el 2026-11-16). Los tiempos máximos por paso tienen que poder ampliarse en el kit.
5. **El pendrive:** un SSD por USB de 64 GB o más. Si se monta sin permiso de ejecución, el kit se copia a la carpeta de usuario con un solo comando. Rutas siempre con `node:path`, nunca rutas absolutas.

## Fases y specs
Orden decidido el 2026-11-25. El usuario no había fijado prioridad, y se puede cambiar. El criterio es empezar por lo que reutiliza lo que ya existe, para tener pronto algo útil sin red.

| Fase | Spec | Qué da | Depende de |
|---|---|---|---|
| 0 | (sin spec) | Lista de comprobación del entorno del cliente, abajo. La rellena el usuario | — |
| 1 | `field-kit` | Carpeta portable para Linux x86_64 con Node, AGENT LIFE, Ollama y los modelos. `start.sh` arranca todo sin conectarse a nada, con sumas de verificación y una prueba con la red cortada. El aislamiento de tests usa Docker o podman | multi-runtime (hecho) |
| 2 | `offline-rag` | Cargar PDF, HTML y Markdown, y preguntar con citas comprobadas. Un panel en la Library del hotel, y los agentes la usan como contexto | field-kit |
| 3 | `command-deck` | VSCodium portable con la extensión: botones por proyecto, terminal, trabajos y buzón del hotel, y el bug suite | field-kit, y app-bugs para la parte del bug suite |
| 4 | `ada-stack` | Proyectos Ada (GNAT, gprbuild) con tests en el aislamiento, y lectura de logs de GNAT para el bug suite | field-kit, app-bugs |

`app-bugs` (fila 20 del TASKMAP, rama `feat/app-bugs`) sigue siendo un spec propio. Hay que ponerlo al día con `main` antes de construirlo, porque las tareas 2 y 3 usan el nuevo patrón de `gateway/features/`.

## Fase 0: preguntas para el entorno del cliente
- ¿Qué distribución de Linux y qué versión de glibc tiene? ¿Es x86_64 o ARM?
- ¿Cuánta RAM hay? ¿Hay GPU, y de qué tipo?
- ¿Se permite USB? ¿Se monta con permiso de ejecución? ¿Hay sitio en la carpeta de usuario (unos 20 GB)?
- ¿Hay Docker o podman, y se pueden usar sin root?
- ¿Qué compilador de Ada se usa (versión de GNAT), cómo se construye (gprbuild, make, Alire) y cómo se ejecutan los tests?
- ¿Quién aprueba el software, y qué pide (licencias, SBOM, análisis antivirus)?
- ¿Qué documentación se quiere en el RAG, y se puede sacar del cliente o tiene que cargarse allí?

## Cómo empezar en una sesión nueva
Rama `feat/field-kit`. Primero leer `docs/STATUS.md` y este fichero. Después escribir el spec `field-kit` (requirements, design, tasks) siguiendo `docs/architecture.md`, y pedir el sí del usuario antes de construir.
