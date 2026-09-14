# knkLinux — Plan Maestro

**Este documento consolida el mensaje fundacional del proyecto y no debe perderse.**
Es la fuente única de visión. Antes de cualquier cambio, releer también:

- `docs/KNKLINUX-PRODUCT-CHARTER.md` (visión, límites, criterios de "producto terminado")
- `docs/ARQUITECTURA-ASISTENTE-KNKLINUX.md` (asistente, modelos, voz, consentimiento)
- `docs/HOJA-RUTA-DESKTOP-KNKLINUX.md` (fases de construcción)
- `docs/DECISIONES-REFERENCIA-IA-LOCAL-2026-09-09.md` (referencias open source)

**Fecha de consolidación:** 2026-09-09

---

## 1. El mensaje fundacional, punto por punto

El proyecto empezó con estas instrucciones explícitas. Nada de esto se descarta:

| # | Requisito original | Estado |
|---|---|---|
| 1 | Icono propio en el acceso directo de escritorio | ✅ Hecho (`assets/knklinux.ico`, `.lnk` actualizado). Se sustituirá por el instalador Tauri en la fase de empaquetado |
| 2 | Mejorar visualmente la suite | ✅ Primera pasada hecha (hub knkLinux). Pendiente: menú de tarjetas vivas |
| 3 | Auditoría profesional a fondo de cada módulo | ✅ Hecha (`docs/AUDITORIA-PRODUCTO-KNK-SUITE-2026-09-09.md`). Se repetirá al cerrar cada fase |
| 4 | Cinco mejoras por módulo basadas en herramientas profesionales (open source y comerciales) | 📋 Listadas en la sección 3 de este documento |
| 5 | Título bonito con letras de terminal, estilo cybergrad | ✅ `knkLinux // Security Workbench` |
| 6 | Icono bonito | ✅ ICO + SVG generados. Versión definitiva al empaquetar |
| 7 | Revisar practicidad y funcionamiento de todo | 🔄 En curso. Bloqueado por health checks reales y jobs asíncronos (Fase 1) |
| 8 | Terminal Kali embebida no tiene herramientas instaladas | 🔜 Se resuelve con Kali real en WSL2 + inventario de herramientas (Fase 2). Docker no está disponible en el equipo |
| 9 | El LLM debe ser un asistente activo tipo Clippy, ayudando en pentests y estudios, no solo una pestaña | 🔜 Assistant Core (Fase 3): panel persistente + ventana flotante + atajo global |
| 10 | El asistente debe tener voz y aspecto | 🔜 Fase 4: STT/TTS locales + avatar con estados |
| 11 | **Releer este mensaje antes de cada acción para no desviarse** | ✅ Registrado como regla operativa en `AGENTS.md` |

Y los requisitos añadidos después:

| # | Requisito nuevo | Estado |
|---|---|---|
| 12 | Aplicación de escritorio **completa**, no un dashboard web | 🔜 Tauri 2 + backend local gestionado (Fase 5 / Fase C de la hoja de ruta) |
| 13 | Después, un CLI para Linux precioso | 🔜 Fase final, reutilizando contratos y almacenamiento |
| 14 | Estética de terminal + asistente de IA moderno, todo en uno | 🔜 Identidad visual + asistente omnipresente |
| 15 | LLM "una pasada", tipo **Ava de Razer pero para pentesting** | 🔜 Compañero de escritorio con presencia, voz y avatar; diseño propio, sin copiar marca ni arte de terceros |

### Decisión estética registrada

Hubo dos peticiones visuales: primero "estética hacker en rojos" y después la imagen de
referencia azul/cian/violeta con veredicto "me encanta el visual". **Decisión cerrada:**

- Base: negro profundo + azul eléctrico + cian + violeta neón.
- Rojo: reservado exclusivamente para alertas, bloqueos, errores y severidad.
- La imagen de referencia decora el hub como ambiente; nunca por detrás de controles críticos.

No se reabre este debate sin motivo.

---

## 2. Qué significa "software completo"

knkLinux está terminado como producto cuando:

1. Se instala y desinstala como aplicación de escritorio (instalador Windows).
2. Arranca sin ventanas CMD intermedias; el backend es gestionado por la app.
3. Hay una única fuente de verdad para estados, jobs y evidencias.
4. El asistente es omnipresente: panel lateral, ventana flotante, atajo global, voz y avatar.
5. La terminal ejecuta Kali real aislado (WSL2), nunca el host Windows por defecto.
6. Todo lo activo pasa por scope gate + aprobación humana + registro de auditoría.
7. Funciona 100 % local y gratuito con Ollama; la nube es opcional y explícita.
8. El CLI Linux reutiliza los mismos contratos y protecciones.

---

## 3. Cinco mejoras prioritarias por área

### Hub
1. Navegación por tarjetas visuales (estaciones, no lista plana).
2. Estado real conectado a health checks, nunca derivado de documentos.
3. Actividad reciente (jobs, hallazgos, asistente).
4. Atajos de teclado globales y por módulo.
5. Layout configurable por workspace.

### Targets y scope
1. Ficha completa del objetivo (dominios, IPs, credenciales autorizadas, notas).
2. Allowlist de dominios/IPs y exclusiones explícitas.
3. Estado de autorización con fecha y origen del permiso.
4. Bloqueo automático de tráfico fuera de scope antes de emitir la request.
5. Historial de decisiones y cambios de scope.

### Terminal Kali
1. Runtime WSL2 real (no fallback silencioso a Windows).
2. Health check de Kali y de las herramientas instaladas (inventario vivo).
3. xterm.js con resize y sesiones persistentes.
4. Separación clara entre comandos seguros y peligrosos.
5. Workspace montado de forma controlada, sin exponer credenciales del host.

### Pipeline
1. Jobs asíncronos y cancelables (nunca dentro de la request HTTP).
2. Cola visible con progreso en vivo.
3. Reintentos controlados y con límite.
4. Dry-run obligatorio por defecto.
5. Confirmación humana para toda acción activa.

### Evidencias y reportes
1. Hash de cada evidencia en el momento de captura.
2. Línea temporal de ejecución por job.
3. Redacción automática de secretos y PII antes de almacenar.
4. Exportación Markdown/HTML/PDF.
5. Trazabilidad completa: hallazgo → request → respuesta → informe.

### KNK Assistant
1. Contexto por workspace (target, scope, terminal, evidencias seleccionadas).
2. Router de modelos (conversación / código / rápido / embeddings).
3. Herramientas declaradas con schemas, no prompts implícitos.
4. Consentimiento antes de ejecutar (niveles A/B/C/D del doc de arquitectura).
5. Memoria editable, auditable y borrable por el usuario.

### Voz y avatar
1. Push-to-talk local (sin escucha permanente).
2. Transcripción visible antes de enviar al modelo.
3. TTS offline (Piper/OHF-Voice).
4. Avatar con estados: idle, escuchando, pensando, esperando aprobación, ejecutando, alerta.
5. Desactivación inmediata y modo solo texto.

### Cumplimiento
1. Registro de autorización por workspace.
2. Scope gate antes de cualquier job.
3. Registro de comandos ejecutados (quién, cuándo, qué, resultado).
4. Política de retención y borrado de evidencias.
5. Modo laboratorio separado del modo engagement.

---

## 4. Orden de desarrollo

```text
Fase 1 — Producto fiable
  Consolidar frontend/backend · estados reales · jobs asíncronos
  API local autenticada · health checks

Fase 2 — Kali integrado
  Adaptador WSL2 · terminal persistente · inventario de herramientas
  workspace aislado · bloqueo de comandos fuera de autorización

Fase 3 — Asistente contextual
  Router Ollama · memoria por proyecto · herramientas de lectura
  generación/revisión de código · confirmaciones humanas

Fase 4 — Voz y presencia
  STT local · TTS local · ventana flotante · atajo global · avatar

Fase 5 — Empaquetado
  Tauri · instalador Windows · icono · actualizaciones · backup
  (y después: CLI Linux)
```

Regla: ninguna fase nueva empieza sin cerrar los criterios de la anterior.

---

## 5. Checkpoint de hardware (pendiente del usuario)

La elección del modelo local y la viabilidad de la voz con baja latencia dependen del
equipo. Antes de descargar cualquier modelo hay que medir:

- RAM total y libre;
- GPU y VRAM dedicada;
- CPU y núcleos;
- disco disponible.

Con eso se decide entre 8B / 14B / 30B para conversación y qué tamaño de whisper
usar para STT. Este checkpoint desbloquea la Fase 3.

---

## 6. Regla operativa permanente

Antes de cada tarea, responder:

1. ¿Qué problema de producto resuelve?
2. ¿A qué módulo y fase pertenece?
3. ¿Qué estado real debe mostrar?
4. ¿Qué autorización necesita?
5. ¿Cómo se prueba sin tráfico ni cambios innecesarios?
6. ¿Qué queda fuera de esta iteración?

Si la tarea no mejora la experiencia, la fiabilidad, la privacidad o la seguridad del
workbench, se aparca.
