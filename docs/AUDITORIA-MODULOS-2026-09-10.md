# Auditoría por módulos — knk-suite / knkLinux

**Fecha:** 2026-09-10  
**Objetivo:** pasar de dashboard local a workbench desktop independiente, útil para pentesting autorizado, laboratorios y estudio.

## Resumen ejecutivo

La base tiene muchos módulos y 45 tests unitarios verdes, pero hay tres problemas transversales:

1. **El estado está fragmentado:** sesión SQLite, jobs en memoria, rutas del asistente y UI mantienen partes de la verdad.
2. **El asistente y el chat están duplicados:** `Assistant.jsx` usa `/assistant/talk`; `Chat.jsx` usa `/llm/chat`. Hay voz en el asistente, pero no en el chat normal ni una conversación persistente compartida.
3. **OSINT/cámaras mezcla fuentes públicas con una búsqueda Shodan que no equivale a “vulnerable”:** Shodan solo debe aportar observaciones/indexación; una auditoría activa debe restringirse a una red privada autorizada.

## Estado verificado de Shodan

El código **sí contiene integración Shodan** en `backend/lib/osint.js`:

- lee `SHODAN_API_KEY` o `config.json`;
- expone `GET /api/osint/status`;
- expone búsquedas unificadas y `GET /api/osint/shodan/host/:ip`;
- el agregador de cámaras intenta consultas por puertos 554/80 y `has_screenshot`.

Pero en el checkout auditado `config.json` está vacío, por lo que **no puedo afirmar que la API que entregaste esté activa**. La comprobación correcta es `GET /api/osint/status` y debe mostrar `shodan.configured: true`, sin mostrar la clave completa. No se debe volver a introducir una clave en el repositorio.

Además, la implementación actual tiene defectos:

- la búsqueda `geo:lat,lon` no queda claramente limitada por el servidor a cámaras antes de consultar;
- se hacen varias consultas Shodan redundantes por una sola vista;
- se presentan `rtsp://IP:puerto` como stream sin verificar autorización ni disponibilidad;
- `has_screenshot:true` indica indexación de screenshot, no vulnerabilidad;
- no hay deduplicación robusta por IP/puerto/fuente;
- Insecam/Windy son webcams públicas y no deben mezclarse visualmente con activos autorizados.

## Auditoría y cinco mejoras por módulo

### 1. Panel / Dashboard

**Estado:** funcional, con sesión, target, red, navegador y estado de salud; demasiado concentrado y con acciones mezcladas.

1. Convertirlo en tablero de misión: workspace, autorización, scope, rate-limit, runtime, jobs y bloqueos en primer plano.
2. Añadir freshness por indicador: `checkedAt`, edad, fuente y botón de revalidar.
3. Añadir timeline de actividad: job, fase, duración, resultado, artefactos y audit event.
4. Añadir modo lectura bloqueable para revisar una misión sin lanzar acciones.
5. Mostrar una tarjeta de asistente persistente con contexto actual, modelo, latencia y aprobación pendiente.

### 2. Targets / Scope

**Estado:** permite fijar target/scope y consultar estados auxiliares; falta entidad Workspace/Target versionada.

1. Ficha persistente por objetivo: dominios, IPs, exclusiones, cuentas propias, autorización y vencimiento.
2. Versionar el scope y guardar diff/auditoría de cada modificación.
3. Invalidar OPPLAN y jobs cuando cambien target, exclusiones o rate limit.
4. Separar badges de pasivo, validación y activo; bloquear tráfico antes de crear la request.
5. Añadir importación/exportación JSON/SARIF y una vista de grafo de activos/evidencias.

### 3. OPPLAN / autorización

**Estado:** existe formulario y aprobación; falta cadena de custodia fuerte.

1. Generar `authorizationId` y hash estable del plan aprobado.
2. Incluir propietario, motivo, ventana temporal, exclusiones y límites de peticiones.
3. Firmar/revalidar el hash antes de cada job activo en backend.
4. Requerir doble confirmación para acciones de alto impacto o con mutación.
5. Mostrar en cada evidencia el OPPLAN exacto que la autorizó.

### 4. Pipeline

**Estado:** tiene fases y rutas local/externa; necesita contrato de job más estricto.

1. Estados formales: `queued`, `running`, `paused`, `blocked`, `succeeded`, `failed`, `cancelled`.
2. Cola persistente con `jobId`, timestamps, timeout, cancelación y reanudación segura.
3. Dry-run por defecto y preview de comandos/requests antes de ejecución.
4. Presupuestos por fase: tiempo, peticiones, concurrencia y coste de API.
5. Artefactos por fase con hash y relación a target, scope, herramienta y resultado.

### 5. Jobs

**Estado:** motor asíncrono existente, pero el listado vive en memoria y algunas acciones son scripts históricos.

1. Persistir jobs y eventos en SQLite para sobrevivir reinicios.
2. Sustituir comandos libres por catálogo de herramientas y parámetros validados.
3. Añadir SSE/WebSocket de progreso en lugar de polling de 2 segundos.
4. Diferenciar cancelado, timeout, bloqueo de seguridad y error del proceso.
5. Conectar cada job con evidencia, auditoría y contexto del asistente.

### 6. Terminal Kali

**Estado:** adaptadores WSL2/VirtualBox/Docker y xterm; debe ser más explícita y persistente.

1. WSL2 como runtime recomendado y no fallback silencioso al host.
2. Sesiones persistentes por workspace, reconexión y múltiples pestañas.
3. Banner obligatorio con runtime, distro, usuario, workspace y política activa.
4. Inventario vivo con versión, hash de imagen y fecha de comprobación.
5. Separar comandos de lectura, preparación y ejecución activa con aprobación visible.

### 7. OSINT Hub

**Estado:** reúne Shodan, GeoIP, Windy, Insecam, personas y búsquedas; es el módulo con mayor deuda de calidad y cumplimiento.

1. Separar fuentes en **públicas**, **indexadas** y **activos autorizados**; nunca mezclar cámaras públicas con la red del usuario.
2. Crear un normalizador/deduplicador de activos con IP, puerto, protocolo, fuente, timestamp, confianza y distancia.
3. Implementar caché y presupuesto de API: una consulta Shodan por intención, no tres consultas redundantes por vista.
4. Añadir “evidencia de por qué aparece”: query exacta, fuente, fecha, screenshot indexado sí/no y límites de precisión geográfica.
5. Añadir un flujo de auditoría local de cámaras restringido a CIDR privado autorizado, solo conectividad/banner seguro, sin credenciales ni explotación.

### 8. Cámaras

**Estado:** agregador funcional pero conceptualmente inseguro: “cerca” no significa “vulnerable”.

1. Vista separada “webcams públicas” frente a “activos de mi red autorizada”.
2. Para Shodan, mostrar “expuesto/indexado” y nunca “vulnerable” salvo evidencia validada.
3. Deduplicar por IP/puerto y añadir `source`, `lastSeen`, `confidence`, `distanceKm` y `authorization`.
4. Añadir filtros seguros: protocolo, fabricante, puerto, país, radio y fecha de indexación.
5. Auditor local con CIDR privado /24 máximo, límites, timeout, rate limit, log y confirmación de autorización.

### 9. LLM / Ollama

**Estado:** Ollama integrado, selección de modelos parcial, generación no streaming y modelos inconsistentes entre rutas.

1. Unificar el router en perfiles: conversación/razonamiento, código, análisis rápido y embeddings.
2. Medir automáticamente modelo instalado, VRAM/RAM, latencia, tokens/s y contexto antes de recomendar Qwen.
3. Añadir streaming, cancelación y métricas por respuesta.
4. Separar hechos, hipótesis, recomendaciones y acciones propuestas en la salida.
5. Añadir benchmark local reproducible sobre tareas de estudio, código, scope y análisis de evidencia.

**Recomendación inicial:** si el equipo tiene aproximadamente 12 GB de VRAM, probar `qwen3:8b` para conversación/razonamiento y `qwen2.5-coder:7b` para código. No se debe descargar automáticamente sin confirmar espacio y hardware. `deepseek-r1:8b` puede evaluarse para razonamiento, pero su latencia y formato deben medirse antes de convertirlo en default.

### 10. Assistant / Chat unificado

**Estado:** hay dos experiencias: `Assistant.jsx` con voz/memoria/modos y `Chat.jsx` simple. Hay STT/TTS del navegador, no voz local completa.

1. Crear un único `AssistantOrchestrator` y un único endpoint conversacional con `conversationId`, modo, modelo, fuentes y contexto.
2. Integrar chat, voz, memoria, vault, terminal seleccionada, evidencias y workspace en el mismo panel.
3. Añadir streaming de respuesta, interrupción, reintento y “seguir trabajando” al cambiar de módulo/terminal.
4. Incorporar tool registry: lectura segura, preparación y ejecución con preview, scope gate y aprobación humana.
5. Mostrar razonamiento operativo verificable: fuentes usadas, modelo, tiempo, incertidumbre, hechos/hipótesis y acciones nunca ejecutadas como si lo fueran.

**Voz:** mantener push-to-talk, mostrar transcripción antes de enviar y añadir TTS local con Piper cuando se valide licencia/binario. La Web Speech API puede permanecer como fallback claramente etiquetado.

### 11. Memoria / Vault

**Estado:** vault indexado y memoria SQLite; falta control de contexto más visible.

1. Context picker por conversación: el usuario selecciona notas, terminales y evidencias.
2. Redacción automática de tokens, cookies, PII y secretos antes de indexar.
3. Separar memoria de sesión, workspace, estudio y global.
4. Mostrar origen, fecha y botón borrar/exportar por elemento.
5. Añadir búsqueda semántica local cuando haya embeddings instalados, con fallback léxico.

### 12. Reportes / Evidencias

**Estado:** generador y compuertas sólidos como base; PDF/diff/cadena completa pendientes.

1. SHA-256 + timestamp UTC + origen + job + OPPLAN en cada evidencia.
2. Redacción de secretos/PII antes de guardar y vista de cambios.
3. Trazabilidad finding → request → response → screenshot → reporte.
4. Export Markdown/HTML/PDF/SARIF con índice y checksum.
5. Historial versionado con diff y bloqueo de envío si faltan gates.

### 13. Compuertas / Compliance

**Estado:** una de las partes más maduras; necesita centralización.

1. Motor declarativo de reglas versionadas, no condiciones repartidas por UI.
2. Scope gate único usado por terminal, jobs, OSINT, asistente y pipeline.
3. Audit log inmutable de usuario, timestamp, operación, target, decisión y resultado.
4. Políticas de retención, borrado, exportación y modo laboratorio/engagement.
5. Tests de autorización HTTP/WebSocket y regresión de seguridad en CI.

### 14. Revocación / laboratorios

**Estado:** buen laboratorio local sintético y enfoque seguro.

1. Convertirlo en catálogo de escenarios reproducibles con fixtures versionadas.
2. Añadir ejecución parametrizada sin red real y comparación seguro/vulnerable.
3. Exportar evidencia didáctica y explicación para estudio.
4. Integrar sus resultados en el Assistant y Vault.
5. Añadir pruebas de regresión para cada cambio de autorización.

### 15. Browser / CDP

**Estado:** canal real y capturas; riesgo de mezclar operación histórica con producto.

1. Perfil por workspace con aislamiento y botón de destrucción de sesión.
2. Mostrar origen, cookies no exportables y estado de login sin guardar secretos en evidencia.
3. Allowlist de hosts y bloqueo de navegación fuera de scope.
4. Capturas con hash y relación a la acción.
5. Separar adaptador de navegador del código de scripts históricos.

### 16. Flipper / herramientas educativas

**Estado:** módulo visual útil pero aislado del workspace.

1. Catálogo de herramientas con versión y runtime real.
2. Cada herramienta debe indicar laboratorio, permisos, red y artefactos.
3. Preparar comandos como draft en Terminal, nunca ejecución oculta.
4. Guardar historial y resultados como evidencia sintética.
5. Añadir tutorial guiado conectado al Assistant.

### 17. Visual / navegación

**Estado:** visualmente bueno: imagen hero, gradientes, ambientación, estaciones y menú agrupado; todavía es sidebar/lista más que “torreta”.

1. Convertir el menú en una torreta de estaciones: módulos como racks/servidores con LEDs, código `SRV-01`, estado y actividad.
2. Usar la imagen de referencia en tres capas: hero del hub, miniaturas/recortes por estación y paleta/animación ambiental; nunca detrás de controles críticos.
3. Crear estados visuales coherentes: online, degraded, blocked, running, requires approval.
4. Mantener accesibilidad: contraste, modo reducido, teclado y tooltips descriptivos.
5. Añadir layout configurable por workspace: vista torreta, compacta y solo teclado.

## Acciones ejecutadas en esta iteración

- Se confirmó por código la integración Shodan, pero no una clave activa en el checkout.
- Se confirmó que el asistente tiene voz de navegador y hotkey flotante, pero el Chat no comparte esa experiencia.
- Se confirmó que el LLM tiene rutas y catálogo de Qwen, pero no benchmark ni selección basada en hardware.
- Se añadió `backend/lib/camera-audit.js` como base de auditoría **solo para red privada/laboratorio**, con límites de rango, puertos y concurrencia. Falta conectarlo al router/UI y añadir tests.
- Se documentó que nunca se debe etiquetar como “vulnerable” una cámara solo porque Shodan la indexe.

## Orden recomendado

### P0

1. Conectar y probar autenticadamente `camera-audit` solo contra un CIDR privado que el usuario confirme.
2. Unificar Assistant/Chat en un solo contrato y panel persistente.
3. Verificar modelos Ollama instalados y hardware; después elegir Qwen y medir.
4. Integrar Shodan por variable de entorno y mostrar estado real sin filtrar secretos.

### P1

1. Deduplicación y separación pública/autorizada del OSINT.
2. Streaming/cancelación de LLM y jobs.
3. Torretas visuales con estados reales y accesibilidad.
4. Evidence/audit/workspace como contratos compartidos.

### P2

1. STT/TTS local completo.
2. PDF/diff/SARIF.
3. CLI Linux y empaquetado desktop final.

## Decisiones que no se deben automatizar

- No escanear cámaras públicas “cercanas” ni Internet.
- No probar contraseñas por defecto ni abrir streams de terceros.
- No descargar modelos grandes automáticamente sin conocer hardware/espacio.
- No tratar una clave encontrada en un archivo histórico como válida: usar env/local secret y rotar la clave si estuvo expuesta.
