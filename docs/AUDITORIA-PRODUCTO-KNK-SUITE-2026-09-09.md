# Auditoría de producto — KNK Suite

> Fecha: 2026-09-09
> Alcance: frontend React, backend Express, SQLite, Docker/Kali, LLM local, navegador, pipeline, reportes y cumplimiento.
> Criterio: aplicación profesional para pentesting autorizado, laboratorios propios y estudio.

## Visión de producto

KNK Suite evolucionará desde un dashboard local hacia una aplicación de escritorio de seguridad con:

- workspace de proyectos y evidencias;
- controles de autorización y scope visibles antes de cualquier prueba;
- terminal Kali aislada y verificable;
- asistentes de recon, análisis, documentación y aprendizaje;
- LLM local/remoto con memoria por proyecto, herramientas limitadas y trazabilidad;
- voz y avatar como interfaz, no como sustituto de controles de seguridad;
- tema visual oscuro rojo, tipografía monoespaciada y lenguaje visual de terminal.

La automatización solo debe operar sobre activos autorizados o laboratorios propios. Los bloqueos de scope, rate limit, confirmación manual y congelación de evidencia son funcionalidades del producto, no obstáculos a eludir.

---

## Resultado medido de la auditoría

| Área | Estado | Evidencia |
|---|---|---|
| Tests backend | ✅ 41 pasan, 0 fallan | `npm test` |
| Build frontend | ✅ Compila | `npm --prefix frontend run build` |
| Syntax backend | ✅ `node --check` pasa | `backend/index.js` |
| API local | ⚠️ Funciona con token | `/api/status`, `/api/session`, `/api/llm/status` |
| LLM | ✅ Ollama responde | `hermes3:latest` detectado |
| Docker | ❌ No disponible en este entorno | `docker: command not found` |
| Terminal Kali | ⚠️ No verificada en runtime | Depende de Docker Desktop + `knk-kali` |
| CORS | 🔴 Riesgo técnico | `Access-Control-Allow-Origin: *` |
| Jobs de Targets | 🔴 Bloqueantes | `execSync` dentro de la petición HTTP |
| Icono escritorio | 🔴 Ausente | `Icon=,0` |
| Escritorio real | ❌ Aún no | Actualmente es web local + CMD |

---

## Auditoría por módulo: cinco mejoras de alto valor

### 1. Shell de aplicación / navegación

Estado: React monolítico pequeño, navegación por estado local en `App.jsx`.

Cinco mejoras:
1. Extraer un `AppShell` con rutas y permisos por workspace.
2. Añadir un `WorkspaceContext` único para target, scope, autorización y proyecto activo.
3. Introducir error boundary, pantalla offline y estado de backend visible.
4. Añadir command palette (`Ctrl+K`) para abrir módulos y ejecutar acciones seguras.
5. Preparar la capa de escritorio con Tauri/Electron sin acoplarla al backend.

Referencias: React Router, Zustand, Radix UI, Tauri.

### 2. Dashboard / situación operativa

Estado: muestra sesión, IP, navegación y estado general.

Cinco mejoras:
1. Convertirlo en un tablero de misión: scope, autorización, rate limit, evidencia y bloqueos.
2. Añadir health checks independientes para backend, LLM, Docker, terminal y almacenamiento.
3. Mostrar un timeline de ejecuciones con duración, resultado, exit code y artefactos.
4. Añadir indicadores de freshness: cuándo se comprobó cada estado.
5. Añadir modo solo lectura para revisar una misión sin poder lanzar acciones.

Referencias: Grafana, DefectDojo, Faraday, PlexTrac.

### 3. Targets / operaciones multiobjetivo

Estado: `Targets.jsx` recién añadido; estados derivados de ficheros y acciones síncronas.

Cinco mejoras:
1. Sustituir estados heurísticos por un registro persistente de runs con SQLite.
2. Ejecutar trabajos mediante cola asíncrona (`worker_threads`, BullMQ o una cola propia) y no bloquear Express.
3. Exigir confirmación de scope/autorización antes de cada job y no solo en UI.
4. Mostrar salida incremental por WebSocket/SSE, cancelación y timeout controlado.
5. Separar recon pasivo, validación y pruebas activas con badges y permisos distintos.

Referencias: Celery/RQ como patrón de jobs, DefectDojo, Dradis, ProjectDiscovery.

### 4. OPPLAN / autorización

Estado: existe validación y aprobación, una buena base.

Cinco mejoras:
1. Versionar cada OPPLAN y conservar quién/cuándo aprobó.
2. Requerir motivo, alcance, exclusiones y ventana temporal.
3. Invalidar automáticamente la aprobación cuando cambien target, scope o rate limit.
4. Añadir revisión de segundo operador para acciones de alto impacto.
5. Generar un resumen firmado/hash del plan que acompañe a cada evidencia.

Referencias: NIST SP 800-115, OWASP WSTG, Dradis, PlexTrac.

### 5. Pipeline

Estado: fases existentes, con pipeline remoto y local.

Cinco mejoras:
1. Modelo explícito de estados: queued, running, paused, blocked, succeeded, failed, cancelled.
2. Artefactos por fase con hash, timestamps y relación al target.
3. Reintentos solo para errores transitorios y nunca para bloqueos de seguridad.
4. Presupuestos de tiempo, peticiones y coste por fase.
5. Adaptadores de herramientas versionados y perfiles de laboratorio/producción autorizada.

Referencias: Nuclei, ProjectDiscovery, GitLab CI, GitHub Actions.

### 6. Terminal Kali Docker

Estado: integración WebSocket y presets; Docker no está disponible en la auditoría actual.

Cinco mejoras:
1. Health check real: daemon, contenedor, imagen, usuario no root y herramientas.
2. Construcción reproducible fijando digest de imagen y versiones de herramientas.
3. Perfil de laboratorio aislado de red por defecto; habilitación explícita para targets autorizados.
4. Montajes mínimos, workspace por proyecto y límites de CPU/memoria/tiempo.
5. Terminal multi-sesión con historial por proyecto, resize robusto y reconexión segura.

Referencias: Docker rootless, Kali metapackages, Sysbox, gVisor, Kubernetes NetworkPolicy.

### 7. Recon y surface mapping

Estado: extracción de subdominios, CNAME, Wayback, bundles y endpoints.

Cinco mejoras:
1. Distinguir siempre pasivo/activo y mostrar el origen de cada dato.
2. Normalizar activos con deduplicación, DNS histórico y relación de evidencias.
3. Añadir límites globales y control de concurrencia por target.
4. Exportar a JSON, CSV, SARIF y grafo visual.
5. Integrar ProjectDiscovery amass/subfinder/httpx/nuclei solo detrás de scope y autorización.

Referencias: Amass, Subfinder, httpx, Nuclei, Maltego Community.

### 8. Scanner y compuertas

Estado: hay checks de headers, CORS, NVD y gates de seguridad.

Cinco mejoras:
1. Convertir cada gate en una regla declarativa versionada.
2. Guardar input, output y decisión con evidencia reproducible.
3. Añadir severidad, confianza y justificación separadas.
4. Crear un catálogo de falsos positivos y exclusiones revisables.
5. Exportar findings a SARIF/JSON para integraciones externas.

Referencias: OWASP ZAP, Semgrep, SARIF, DefectDojo.

### 9. LLM / asistente

Estado: cliente Ollama independiente, chat en una pestaña, sin memoria de proyecto ni herramientas activas.

Cinco mejoras:
1. Crear un `Assistant Orchestrator` con contexto de proyecto, scope y permisos explícitos.
2. Separar chat, análisis de archivos, generación de informes y ejecución de herramientas.
3. Añadir tool calling con allowlist, previsualización y aprobación humana.
4. Registrar prompts, respuestas, modelo, latencia y fuentes sin guardar secretos ni PII innecesaria.
5. Añadir streaming, cancelación, selección de modelo y fallback offline.

Referencias: Ollama, llama.cpp, LiteLLM, Open WebUI, LangGraph; para producto, Microsoft Copilot Studio y Google Gemini Code Assist como referencias de UX, no como dependencias.

### 10. Voz y avatar

Estado: no implementado.

Cinco mejoras:
1. Push-to-talk como comportamiento inicial, no escucha permanente.
2. STT local con faster-whisper o whisper.cpp.
3. TTS local con Piper; proveedor remoto opcional y claramente indicado.
4. Avatar 2D ligero con estados: idle, listening, thinking, speaking, blocked.
5. Indicadores visibles de grabación, transcripción, modelo usado y posibilidad de borrar historial.

Referencias: whisper.cpp, faster-whisper, Piper, Web Speech API, Live2D como referencia visual.

### 11. Evidencia y reportes

Estado: generación bilingüe y almacenamiento de borradores.

Cinco mejoras:
1. Cadena de custodia: hash SHA-256, timestamp UTC y origen.
2. Plantillas por programa, estándar y categoría OWASP.
3. Redacción automática de secretos, cookies, tokens y PII.
4. Vista diff entre versiones del informe.
5. Exportación Markdown, HTML y PDF con índice de evidencias.

Referencias: Dradis, Faraday, Pwndoc, DefectDojo, Burp reporting.

### 12. Cumplimiento y seguridad de la suite

Estado: token local y validadores; hay deuda importante.

Cinco mejoras:
1. Cambiar CORS `*` por origen local exacto y validar `Origin`/`Host`.
2. No exponer secretos en frontend, logs ni errores.
3. Aplicar CSRF/origen local y límites de tamaño a todas las rutas.
4. Auditoría de acciones: usuario, operación, target, decisión y resultado.
5. Tests de seguridad en CI: npm audit, secret scanning, SAST y tests de autorización.

Referencias: OWASP ASVS, ZAP Baseline, Semgrep, Gitleaks, Trivy.

---

## Cinco mejoras visuales prioritarias

1. Tema `KNK REDLINE`: fondo negro grafito, rojo cardinal para acciones, rojo oscuro para alertas, ámbar solo para advertencias.
2. Cabecera de producto con título ASCII/monoespaciado: `KNK // RED TEAM WORKBENCH`.
3. Sidebar con estado de misión fijo: autorización, scope, Docker, LLM y evidencia.
4. Botones clasificados: análisis pasivo, acción autorizada, bloqueado; nunca usar el mismo color para todo.
5. Animaciones discretas de terminal y estados, respetando reduced-motion.

---

## Ruta de producto recomendada

### Fase 1 — Fiabilidad local
- corregir CORS y API de Targets;
- cola de jobs y logs persistentes;
- health checks reales;
- Docker Desktop y Kali verificables;
- icono y launcher sin terminal visible.

### Fase 2 — Asistente activo seguro
- panel contextual persistente;
- command palette;
- memoria por proyecto;
- análisis de archivos y evidencias;
- tool calling con aprobación.

### Fase 3 — Aplicación de escritorio

Recomendación inicial: **Tauri + React** para mantener frontend y reducir peso/privilegios. Electron queda como alternativa si se necesitan APIs Node y compatibilidad rápida.

- shell nativo;
- auto-start controlado del backend local;
- bandeja del sistema;
- notificaciones;
- almacenamiento seguro de preferencias;
- cierre limpio de workers.

### Fase 4 — Voz/avatar
- push-to-talk;
- STT local;
- respuesta TTS opcional;
- avatar de estados;
- controles de privacidad.

---

## Decisión de diseño

No convertir KNK Suite en un botón de “atacar”. Convertirla en un **workbench de seguridad trazable**: cada acción debe tener target, scope, autorización, rate limit, evidencia y veredicto. El aspecto hacker puede ser intenso; los controles deben ser profesionales.
