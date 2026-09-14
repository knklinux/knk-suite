# 🎯 Zendesk fase 0 — Hallazgos y plan de ataque (2026-09-08)

> Fuente: bundles públicos del messaging widget descargados y analizados
> (zendesk-messaging-bundle-rutas.json, zendesk-widget-support-recon.json,
> zendesk-ekr-snippet-urls.json). Todo extraído de `static.zdassets.com`,
> la CDN compartida que sirve el widget a TODOS los tenants.

## Hallazgo 1 — `/hc/api/v2/integration/token` (el más prometedor)

**Qué es:** ruta de emisión de token de integración del Help Center que el
bundle del widget invoca. El widget del HC pide un token a esta API para
autenticarse contra el backend del messaging.

**Por qué importa:** los endpoints de emisión de tokens son el clásico donde
aparecen fallos de BAC: token sin binding de visitor/sesión, reutilizable
cross-tenant, o emitido con más scopes de los necesarios. Es el equivalente
exacto de nuestro E13 (capability sin binding) — la clase que ya sabemos
documentar.

**Plan de ataque (con instancia propia):**
1. Activar el widget en `bb-knk-*` y capturar la petición real a
   `integration/token` (qué params manda: subdomain, key, visitor id)
2. Pedir 2 tokens (2 visitors) y probar: replay, uso cruzado, TTL real,
   qué devuelve el token en su payload (¿scopes?, ¿account id?)
3. **Criterio de reporte pre-committed:** token usable desde otro contexto
   (otro navegador sin cookies, otra instancia) o con scopes superiores a
   los del visitor → BAC/MFLAC P3-P4 según impacto
4. Si el token está bien atado → cerrar el vector con evidencia

## Hallazgo 2 — `static-staging.zdassets.com` (⚠️ verificar scope ANTES)

**Qué es:** el bundle del widget referencia un entorno de staging de la CDN
pública (mismo host-pattern que producción). Los entornos de staging suelen
tener: debug flags activos, sourcemaps completos, builds con más logging,
o configs menos endurecidas.

**Por qué importa (con cautela):** un staging accesible es superficie clásica
de hallazgos de misconfig. PERO — y esto es crítico — el brief dice
`https://{subdomain}.zendesk.com/`: **la CDN no está listada como target
explícito**. Tocar staging sin confirmar scope = riesgo de "out of scope" y
de mala reputación.

**Plan:**
1. **NO contactar** static-staging todavía — cero peticiones
2. Cuando haya login de Bugcrowd: preguntar en el hilo del programa (o
   revisar la policy completa) si `*.zdassets.com` está en scope
3. Si confirman: recon pasivo (sourcemaps, builds con debug flags, rutas
   nuevas no desplegadas en prod) — pasivo primero, activo nunca sin permiso
4. Si no: registrar como "fuera de scope confirmado" y seguir

## Hallazgo 3 — El handshake del widget (preparación para H1/H2)

**Qué es:** la cadena completa ya mapeada: `ekr/snippet.js?key={account_key}`
→ config del tenant en `ekr.zdassets.com/ec/{key}` (probado: 404 con key
inválida — existe validación, bien) → core `z2-messaging-widget.js` →
websocket de conversaciones (dominio aún por capturar en vivo).

**Por qué importa:** aquí viven las conversaciones del AI Agent = nuestro
H1 (IDOR de conversation), H2 (metadatos) y E16-remarco (ticket envenenado).
El account_key es por-tenant: con la instancia propia tendremos el nuestro
para las pruebas de aislamiento.

**Plan (con instancia):**
1. Capturar el handshake real: qué emite el config (realtime domain, visitor
   id, session token) y con qué se firm
2. H1: dos chats del widget (2 navegadores), tomar el conversation_id de uno
   y pedirlo desde el otro → si 200 con contenido = P1 cross-tenant
3. H2: preguntar al agente por documentos de contexto, V13 vigilando
4. E16-remarco: ticket/contenido con payload oculto → agente lo ingiere →
   canario :8210

## Orden de ejecución cuando el trial esté activo

| # | Acción | Vector | Coste |
|---|---|---|---|
| 1 | Capturar handshake + integration/token en vivo | prep | ~6 req |
| 2 | Test de binding del token (replay/cross-context) | H1-token | ~6 req |
| 3 | IDOR de conversaciones entre 2 navegadores | H1 | ~4 req |
| 4 | Metadatos RAG vía prompt del agente | H2 | ~2 req |
| 5 | Ticket envenenado → agente → canario | E16-r | ~15 req (N=5) |
| — | static-staging | ⛔ | 0 hasta confirmar scope |

Todo el tráfico con V13 activo, pacing 3s, y solo contra `bb-knk-*`.
