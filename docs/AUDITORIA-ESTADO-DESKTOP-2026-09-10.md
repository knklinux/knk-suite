# Auditoría de estado — knk-suite / knkLinux Desktop

**Fecha:** 2026-09-10  
**Alcance:** shell desktop, frontend React, backend Node/Express, runtime Kali, asistente, seguridad local, empaquetado y mejoras registradas.  
**Criterio:** aplicación de escritorio independiente para Windows, local-first, pentesting autorizado, laboratorios propios y estudio.

## Veredicto ejecutivo

**knk-suite todavía no es una aplicación de escritorio independiente distribuible.** Es una SPA React servida por un backend Node local, con un shell Electron de desarrollo que arranca otro proceso Node y carga `http://127.0.0.1:8086`.

La base funcional es aprovechable, pero el producto está entre la consolidación y el prototipo de desktop. No debe presentarse todavía como instalador autónomo: faltan empaquetado, runtime gestionado, configuración de datos por usuario, actualización/desinstalación y una decisión arquitectónica única entre Tauri 2 (objetivo documentado) y Electron (shell actual).

## Verificaciones ejecutadas

| Comprobación | Resultado | Lectura |
|---|---:|---|
| `npm test` en la raíz | **45 pasan, 0 fallan** | Núcleo backend con buena cobertura unitaria |
| `npm --prefix frontend run build` | **OK** | SPA compila; Vite avisa de un bundle de ~600 kB |
| `node --check` en desktop y backend | **OK** | No hay errores sintácticos en los entrypoints auditados |
| Dependencias desktop | **solo Electron 33.4.11** | No existe herramienta de empaquetado |
| `desktop/package.json` | **solo `start`** | No hay `dist`, `package`, `make` ni instalador |

## Evidencia principal

### 1. Desktop independiente: **NO CERRADO**

Existe `desktop/main.js`, pero su funcionamiento actual es de shell de desarrollo:

- arranca `backend/index.js` con un Node del sistema;
- depende de que exista Node externo y de que las dependencias nativas sean compatibles con ese Node;
- carga una URL HTTP local en vez de cargar una aplicación empaquetada;
- usa rutas relativas al repositorio (`path.join(__dirname, '..')`);
- `desktop/package.json` solo declara Electron y el script `npm start`;
- no hay `electron-builder`, Tauri, instalador Windows, artefacto portable, desinstalador ni pipeline de release.

**Impacto:** copiar la carpeta o hacer doble clic en un acceso directo no equivale a instalar una aplicación independiente. En otra máquina faltarán Node, dependencias backend, frontend construido, runtime Kali y configuración.

### 2. Arquitectura: **CONTRADICTORIA**

La documentación del producto define **Tauri 2 + React** como dirección objetivo, mientras que el código actual contiene un shell Electron funcional de desarrollo. Debe tomarse una decisión explícita:

- **Tauri 2:** coherente con el charter, menor superficie y menor peso, pero exige crear la capa Rust y un adaptador de backend.
- **Electron:** camino más corto desde el código actual, pero requiere empaquetar/reconstruir módulos nativos y dejar de depender del Node del sistema.

Mientras no se decida, no conviene añadir más funciones al shell desktop.

### 3. Seguridad de red local: **CORREGIDO EN ESTA PASADA**

El backend estaba escuchando en `0.0.0.0` aunque el producto se define como local-only. Ahora usa `KNK_HOST` con valor por defecto `127.0.0.1`. La exposición remota debe ser una decisión explícita, no un efecto lateral del arranque.

La autenticación local existente debe mantenerse obligatoria en todas las rutas y probarse con un smoke HTTP real, no solo mediante tests unitarios del módulo de auth.

### 4. Secretos en configuración: **CORREGIDO PARCIALMENTE / ACCIÓN EXTERNA PENDIENTE**

`config.json` contenía claves API en texto plano. Se han retirado del fichero versionable y el uso debe hacerse mediante variables de entorno ignoradas por Git.

**Acción obligatoria fuera del repositorio:** revocar y regenerar las claves que estuvieron expuestas. Vaciar el fichero no revoca una clave ya publicada.

### 5. Funcionalidad ya presente

- backend Express + SQLite;
- SPA React con panel, targets, OPPLAN, pipeline, jobs, terminal, compuertas, reportes, compliance, bóveda, OSINT y asistente;
- tests de núcleo verdes;
- build frontend reproducible;
- jobs asíncronos con progreso/cancelación en la capa existente;
- detección de runtimes Kali y estado honesto en varias rutas;
- command palette (`Ctrl+K`);
- ventana flotante del asistente y hotkeys en Electron;
- token/cookie local implementado en la librería de autenticación;
- scope gates, rate limit, validaciones y guardrails de reportabilidad.

Esto es una **base de producto**, no el cierre de producto desktop.

## Matriz de mejoras registradas

| Área | Mejora | Estado auditado |
|---|---|---|
| Shell | AppShell/rutas/permisos por workspace | **Ausente/parcial**: navegación por estado local en `App.jsx` |
| Shell | WorkspaceContext único | **Ausente** |
| Shell | Error boundary y pantalla offline | **Ausente o no verificado** |
| Shell | Command palette | **Parcial/implementado** |
| Hub | Dashboard como tablero de misión | **Parcial** |
| Hub | Health checks independientes y freshness | **Parcial**: existe `/api/health`, falta UX completa de freshness/timeline |
| Hub | Timeline de ejecuciones y artefactos | **Pendiente** |
| Targets | Registro persistente de runs | **Pendiente/no demostrado** |
| Targets | Cola visible con streaming, timeout y cancelación | **Parcial**: jobs existe; falta integración uniforme y prueba E2E |
| OPPLAN | Versionado, hash y expiración por cambios | **Parcial** |
| Pipeline | Estados formales y artefactos por fase | **Parcial** |
| Pipeline | Dry-run y aprobación humana de toda acción activa | **Parcial; requiere auditoría de cada endpoint** |
| Kali | WSL2 primero, sin fallback silencioso | **Parcial**: hay adaptadores, pero la ruta local sigue existiendo como fallback honesto |
| Kali | Inventario vivo de herramientas | **Implementado/parcial** |
| Kali | Sesiones persistentes multi-sesión | **Pendiente** |
| Evidence | Hash, cadena de custodia, redacción automática | **Parcial** |
| Reports | Markdown/HTML | **Parcial/implementado** |
| Reports | PDF, diff e índice completo de evidencias | **Pendiente** |
| Assistant | Chat local y memoria | **Parcial/implementado** |
| Assistant | Contexto por workspace y router de modelos | **Pendiente/parcial** |
| Assistant | Tool registry con schemas y approvals | **Pendiente** |
| Voz/avatar | Ventana flotante y hotkey | **Parcial/implementado en Electron** |
| Voz/avatar | STT local, TTS local, transcripción previa y estados completos | **Pendiente**; la guía actual menciona TTS del navegador |
| Cumplimiento | Auditoría de acciones, retención y borrado | **Parcial** |
| Desktop | Instalador, icono, actualizaciones y desinstalador | **Pendiente crítico** |
| Integraciones | HackerOne/Bugcrowd API | **Pendiente** |
| Operación | Headless CI/CD | **Pendiente** |
| Operación | Notificaciones desktop críticas | **Pendiente** |
| Operación | Múltiples sesiones simultáneas | **Pendiente** |

## Prioridad de ejecución

### P0 — antes de más features

1. Elegir Tauri 2 o Electron y congelar la alternativa.
2. Crear un contrato de runtime: `Workspace`, `Scope`, `Authorization`, `Job`, `Evidence`, `Finding`, `AssistantAction` y `AuditEvent`.
3. Garantizar backend local gestionado, loopback por defecto, autenticación obligatoria y smoke HTTP.
4. Definir almacenamiento de usuario, backup/exportación y migraciones SQLite.
5. Construir una primera distribución instalable y probarla en una máquina limpia.

### P1 — núcleo de producto

1. Workspace real como contexto único.
2. Jobs persistentes, cancelables, con estados formales, logs y artefactos.
3. Scope/OPPLAN invalidable en servidor ante cualquier cambio.
4. Evidence con SHA-256, redacción y timeline.
5. Dashboard de misión con health checks y freshness verificables.

### P2 — experiencia avanzada

1. Assistant contextual con tools declaradas, preview y aprobación.
2. STT/TTS local y avatar con estados honestos.
3. Terminal Kali persistente/multi-sesión.
4. PDF/diff de reportes, notificaciones y CLI Linux.

## Definition of Done para declarar “desktop independiente”

- instalador Windows reproducible;
- instalación en una máquina sin Node/npm;
- sin ventana CMD intermedia;
- backend iniciado y detenido por la aplicación;
- frontend servido desde el artefacto empaquetado;
- datos en una ruta de usuario, no en la carpeta del repositorio;
- loopback y autenticación verificados;
- diagnóstico claro si falta WSL2/Kali/Ollama;
- desinstalación y backup probados;
- smoke test de instalación, arranque, health, cierre y reapertura;
- artefacto versionado y checksum publicado.

## Conclusión

No es cierto que “no haya nada”: hay un núcleo backend/frontend funcional y tests verdes. Sí es cierto que las mejoras de producto y, sobre todo, la independencia desktop **no están cerradas**. El bloqueo principal no es visual; es de arquitectura, empaquetado, runtime y contratos de estado. La siguiente iteración debe cerrar P0 antes de ampliar módulos.
