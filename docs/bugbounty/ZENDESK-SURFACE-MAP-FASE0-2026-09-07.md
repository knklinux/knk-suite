# 🗺️ Zendesk — Surface-map fase 0 (público, sin instancia) — 2026-09-07

> Estado: trial pendiente de verificación de email (§9 del brief). Mientras
> tanto se mapea la pila pública del messaging widget, que es LA MISMA que
> cargará nuestra instancia — el recon no depende del trial para la parte
> estática.

## 1) Pila del messaging widget (verificado en vivo sobre support.zendesk.com)

| Componente | URL | Rol |
|---|---|---|
| Loader ekr | `static.zdassets.com/ekr/snippet.js?key={account_key}` | Bootstrap por tenant (key público del account) |
| Widget core | `static.zdassets.com/z2-sunco-widget/z2-messaging-widget.js` (17 KB) | Cargador del messaging (Sunco = motor del messaging) |
| Customer analytics | `static.zdassets.com/customer_analytics_integration/…/cai.min.js` | Telemetría |
| Help Center assets | `static.zdassets.com/hc/assets/{locale}.{hash}.js`, `hc_enduser-{hash}.js` | Front-end del Help Center (superficie "end user" del scope Zendesk Front End) |
| Config por tenant | `ekr.zdassets.com/ec/{account_key}` | Devuelve config del tenant (404 con key inválida — probado: "Not found") |

Dominios detectados en los bundles: `static.zdassets.com`, `static-staging.zdassets.com`
(¡entorno de staging accesible públicamente en el bundle! — apuntar para el
recon autorizado pero SIN tocarlo hasta verificar que está en scope), Sentry
DSN público (`o4507427284123728.ingest.de.sentry.io` — normal, no es hallazgo).

## 2) Rutas API extraídas del bundle del widget

- `/hc/api/v2/integration/token` — token de integración del Help Center
  (probablemente para autenticar el widget contra el HC; **revisar con
  instancia propia**: qué expone, si es per-visitor, TTL, si filtra datos)
- `/images/zea/Avatar_AIAgent_Plate` — avatar del AI Agent (confirma que el
  AI Agent corre sobre esta pila de messaging)

## 3) Qué queda bloqueado por la activación del trial

| Superficie | Por qué hace falta la instancia |
|---|---|
| Config real del tenant (`/ec/{key}` con nuestro key) | Necesita el account_key que se emite al activar el widget |
| Admin Center: Agent Builder, Copilot, App Builder | Login admin del trial |
| Conversaciones reales del AI Agent (H1/H2) | Necesita el agente activo y un chat iniciado |
| Tokens de integración de NUESTRO tenant | Idem |

## 4) Plan al tener el subdominio (2 minutos tras el login)

1. Navegar a `https://{subdominio}.zendesk.com/agent/` → login admin →
   capturar el account_key del widget (Admin Center → Channels)
2. Activar el AI Agent (si el trial lo permite) y crear un agente sintético
3. Descargar bundles del admin (Agent Builder) → rutas de config del agente
4. Iniciar un chat end-user (ventana privada) → capturar conversation_id,
   session token, websocket del messaging → ahí empiezan H1/H2/E16-remarco
5. Todo el tráfico pasa por V13; canario :8210 para cualquier exfil

---

# FASE 1 — Surface-map con sesión admin (en curso, 2026-09-08)

## Instancia confirmada
- **Subdominio: `autonomo-49965.zendesk.com`** (descubierto vía cookies del perfil real)
- `/agent/` = 200 · sesión admin autenticada vía BiDi (redirect a /agent/home/tickets)
- Título: "Inicio – autonomo – Zendesk" · email del trial visible en admin home

## Superficie IA disponible en el trial (verificado en vivo, /admin/ai/ai-agents)
- **Generador de agentes** (Agent Builder) ← objetivo V12-remarco
- **Agentes personalizados** (custom AI agents con knowledge base) ← objetivo E16-remarco
- **Administrador copiloto** / **Copiloto** / **Asistencia automática**
- **Conocimiento** / **Clasificación inteligente** (tema, entidad, tono, idioma)
- Pantallazos: evidencia-poc/pantallas/zendesk-admin-fase1.png, zendesk-admin-ai-agents.png

## Pendiente de fase 1
1. account_key del messaging widget (Channels → Messaging) → handshake ekr→config→core
2. Rutas API del admin (bundles) para V7-remarco (tickets) y V12-remarco (Agent Builder)
3. Segunda instancia trial (bb-knk_Linux-01) para el flujo A/B multi-tenant

## Fase 1 — Resultados (2026-09-08, cierre de pasada)

### Capturado ✅
- **account_key: `df3d609f-14a9-4a77-b441-73602a4aaab2`** (Admin → Channels →
  Messaging setup; única UUID de la página; también usada como sufijo del
  visitorId de pendo en cookies → confirma que es la clave del widget).
- **Handshake fase 1 verificada en visita real**: snippet.js?key=… →
  `GET ekr.zdassets.com/compose/{account_key}` (config de tenant) — evidencia
  en `evidencia-poc/http/zendesk-fase1-handshake.json` (perf entries).
- **HC de la instancia**: brands API → `has_help_center: true`,
  `help_center_state: "restricted"` (el 403 de curl era por pedir sin sesión;
  con sesión carga: redirige a /hc/es).
- **Marcadores propios**: optimizelyEndUserId, _pendo_oldVisitorId.{account_key}
  → útiles como allowlist V13 y para distinguir "nuestro" tráfico.
- V13 sobre la evidencia capturada: **limpia** (cero señales cross-tenant).

### Bloqueador concreto ⛔
El messenger NO monta sus iframes (quedan about:blank) ni abre websocket,
ni en localhost ni en el HC real. El compose responde pero no hay
inicialización del messenger → **el canal de conversación Messaging del trial
tiene el asistente de setup incompleto** (probablemente falta conectar el
canal "Web"/messaging en el wizard de setup, URL:
/admin/channels/messaging_and_social/messaging/setup).
Además: los eventos network.* de BiDi no emiten en este Firefox (0 eventos
siempre) → capturar red con performance.getEntries + refetch same-origin.

### Siguiente paso exacto (reanudar aquí)
1. Usuario completa el wizard de Messaging en el admin (botón Conectar del
   canal Web) — 2-3 clics, mejor a mano que por BiDi.
2. Relanzar `node backend/zendesk-fase1-handshake3.js` → ahora los 9 frames
   deberían apuntar a *.zendesk.com/*zdassets y capturar sesión/conversación.
3. Con el conversation_id real: H1 (dos visitors → cruzar ids), H2
   (metadatos del AI agent), E16-remarco (ticket envenenado → agente → canario).

### Kit fase 1 creado
- backend/zendesk-fase1-canales.js (extracción de key)
- backend/zendesk-fase1-handshake.js / handshake2.js (localhost) / handshake3.js (HC real)
- evidencia-poc/http/zendesk-widget-visitante.html (página visitante con snippet)
- evidencia-poc/pantallas/zendesk-fase1-canales.png, zendesk-widget-visitante.png,
  zendesk-widget-abierto.png, zendesk-hc-widget.png, zendesk-admin-fase1.png, zendesk-admin-ai-agents.png

## Fase 1 — Drivers de ataque listos (2026-09-08, segunda pasada)

### Kit común: backend/lib/zendesk-kit.js
BiDi en una sola conexión (sin leak de sesión) · pacing 3s · fetch same-origin
con sesión del navegador · V13 en toda captura · evidencia en
evidencia-poc/http/ · auto-salteo con código de salida nombrado.

### Los 3 drivers (todos con --solo-prereq para smoke sin quemar nada)
| Driver | Qué hace | Skip | Smoke hoy |
|---|---|---|---|
| `zendesk-h1-idor-conversacion.js` | Visitor A crea conv marcada SYNTHETIC-Z-CONV-A → B intenta acceder con SU sesión → veredicto por marcador (P1 si 200+marcador) | **exit 21** sin canal | ✅ exit 21, 0 req |
| `zendesk-h2-metadatos-rag.js` | Pregunta al AI agent por artículos/tickets de su contexto → V13 + filtro SYNTHETIC → flag si hay recursos ajenos | **exit 22** sin agente | ✅ exit 22 (3 endpoints 404), 0 req |
| `zendesk-e16-ticket-envenenado.js` | 5 tickets con HTML oculto (zero-font) → instrucción de renderizar imagen del canario → agente procesa → hits del canario; **>=3/5 = reportable** (regla Safety BB) | **exit 23** sin canal o canario público muerto | ✅ exit 23 (wizard + túnel muerto detectado), 0 req |

### Hallazgo de robustez incorporado
El prereq de E16 verifica la VIDA del canario público antes de gastar los 5
tickets (un túnel trycloudflare muere con su proceso — el registro del 6-sep
estaba muerto y fue descartado correctamente). Canario local reiniciado (204).

### Para ejecutar el día D (wizard conectado + túnel nuevo)
```bash
# túnel nuevo + canario:
node backend/canario-ssrf.js &  cloudflared tunnel --url http://127.0.0.1:8210
# export CANARIO_PUBLICO=https://<nuevo>.trycloudflare.com
node backend/zendesk-h1-idor-conversacion.js
node backend/zendesk-h2-metadatos-rag.js
node backend/zendesk-e16-ticket-envenenado.js
```
