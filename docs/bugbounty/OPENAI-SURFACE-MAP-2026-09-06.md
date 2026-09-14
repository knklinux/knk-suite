# 🗺️ OpenAI — Mapeo de superficie SPA ChatGPT (surface map) — 2026-09-06

> Ejecutado íntegramente por KNK Suite v2.1 (módulo `backend/lib/surface-map.js`),
> con OPPLAN aprobado, scope limitado, rate limit 2 s y UA de sesión.
> **Sin clics con cuentas, sin compras, sin enumeración.** Solo lectura de assets
> estáticos del SPA (index + bundles) dentro del scope.

---

## 1) Corrección de alcance: chat.openai.com → chatgpt.com

- `chat.openai.com` responde **308 → `https://chatgpt.com/`** (verificado, cabeceras en evidencia).
- El SPA real de ChatGPT se sirve en `chatgpt.com`; los bundles JS en
  `chatgpt.com/cdn/assets/*.js` (200 directo, sin redirección).
- El gate anti-redirecciones de KNK bloqueó correctamente el 308 (host fuera de scope).
- **Decisión del investigador (confirmada):** mover target/scope de la sesión a
  `chatgpt.com` + `cdn.oaistatic.com`, documentando el 308 como evidencia del
  cambio de superficie del producto en scope (ChatGPT, programa OpenAI/Bugcrowd).
- OPPLAN re-aprobado vía `/api/opplan/approve` (autorización escrita del investigador).

## 2) Resultado del surface map

| Métrica | Valor |
|---|---|
| Index | HTTP 200 · 554 KB (HTML) |
| Bundles descargados | 12 (capped `MAX_BUNDLES`) |
| Evidencias guardadas | 13 (`~/.knk-suite/evidencia/*_surface-*`) |
| Endpoints únicos extraídos | **137** |
| Tipos de identificadores | **23** |
| Rate limit respetado | 2 s entre peticiones (24 s total) |
| Peticiones fuera de scope | 0 |

### Identificadores (cada uno = candidato a vector)

| Identificador | Frecuencia | Vector asociado |
|---|---|---|
| `messageId` | 420 | IDOR mensajes (`/conversation/{id}/messages/{message_id}/...`) |
| `role` | 389 | control de roles en payloads |
| `conversationId` / `conversation_id` | 378 / 180 | IDOR conversaciones, A/B compartición |
| `fileId` / `file_id` | 183 / 70 | biblioteca de archivos (nuevo feature "artifacts") |
| `amount` | 81 | manipulación de importes en checkout |
| `userId` / `user_id` | 62 / 20 | cross-account |
| `sessionId` / `session_id` | 47 / 15 | handoff de sesión/auth |
| `shareId` / `share_id` | 33 / 1 | compartición/revocación de conversaciones |
| `price` | 19 | lógica de precios |
| `subscriptionId` | 5 | suscripciones |
| `organization_id` / `org_id` / `owner_id` | 2 / 1 / 2 | multi-org, ownership |

### Endpoints relevantes por zona

**Auth / sesión**
- `/api/auth/session`, `/api/auth/handoff/bind`, `/api/auth/handoff/inspect`
- `/auth/handoff`, `/auth/login_with?…`, `/auth/error?error=account_deactivated`

**Conversaciones**
- `/conversation/id/{conversation_id}`, `/conversation/gen_title/{conversation_id}`
- `/conversation/{conversation_id}/messages/{message_id}/reactions`
- `/conversation/implicit_message_feedback`, `/conversation/init`, `/conversation/resume`

**Archivos / Biblioteca ("artifacts") — FEATURE NUEVO**
- `GET /files/library/directories/path?directory_id=…`
- `POST /files/library/files` `{parent_directory_id, file_id, file_name, mime_type}`
- `POST /files/library/google-drive/materialize` `{file_id, name, mime_type, index_for_retrieval}`
- Virtual IDs `external-gdrive:account:…`, `external-gdrive:file:…`, `external-gdrive:collection:shared-with-me`

**Pagos / Checkout (solo mapeo, sin comprar)**
- Rutas: `/checkout/{entity}/{checkoutId}`, `/checkout/verify`, `/buy/{planType}`, `/plans/{planType}`, `/purchase/{planType}`, `/payments/success*`, `/paypal/checkout`, `/codex/purchase/{plan}`, `/codex/team/checkout`, `/admin/billing*` (incluye `credit_grants`, `manage_member_usage_limit`)
- Funnel (config de marketing embebida en el index): `chatgpt-sign-up` → `intent-to-pay` (plus/pro/go) → `subscription-start` → `subscription-complete-plus/pro/pro-lite/go` → eventos `AddToCart` / `InitiateCheckout` / `Purchase` / `Subscribe` en Google Ads (`AW-16679965591`), Meta (`1299700488741927`), etc.
- La config de Stripe incluye catálogo de validación fiscal por país (tax IDs) — superficie para lógica de impuestos.

**Plugins**
- `/plugins/list|search|batch|installed|home|featured|tooling-state`, `/plugin-categories/{slug}/plugins`
- `/plugins/{plugin_id}/enable|uninstall|archive`, `/public/plugins/workspace/{plugin_id}/app`
- Flujo de instalación con `install_attempt_id`, `canonical-link install`, OAuth `connect` a apps de terceros, `account_id` en query de admin.

## 3) Vectores candidatos (ordenados por reportabilidad esperada)

> Todos ejecutables con **dos cuentas propias de test (A/B), recursos sintéticos
> propios, sin enumeración, sin compras**, parando ante PII/429/CAPTCHA.

1. **IDOR en biblioteca de archivos (feature nuevo = más probable de fallar).**
   B crea un archivo en `/files/library/files` (`file_id` sintético propio).
   A intenta `POST /files/library/files` y `POST /files/library/google-drive/materialize`
   referenciando el `file_id` de B. Esperado: 403. Si A lee/lista contenido de B → IDOR.
   Variante: `GET /files/library/directories/path?directory_id=<id de B>`.

2. **Revocación/compartición de conversación (tema del OPPLAN original).**
   A comparte una conversación (genera `shareId`), B accede; A revoca; B re-accede al
   enlace `chatgpt.com/share/{share_id}` o vía `/conversation/{id}`. La compuerta
   `revocation-lab`/`gates.js` ya modela este escenario localmente.

3. **Handoff de cuenta (`/api/auth/handoff/bind|inspect`).**
   Flujo de traspaso de sesión entre dispositivos/cuentas. Probar si A puede bindear
   el handoff de B (token de handoff) a su propia sesión → account takeover lógico.
   Requiere capturar el token del propio flujo de B (MITM Burp) — nunca token ajeno real.

4. **Checkout sin comprar: manipulación de entidad/checkoutId.**
   Con la propia cuenta: abrir `/checkout/{entity}/{checkoutId}` y `/checkout/verify` en
   Burp y comprobar si se acepta un `checkoutId` de otro plan/entidad (p. ej. downgrade a
   precio 0, `amount`/`price` en la petición). Sin completar el pago. Lógica de negocio P4–P2.

5. **Instalación de plugin cross-account (`install_attempt_id`, `account_id`).**
   A inicia el flujo de instalación de un plugin propio con `account_id` de workspace de B
   (sintético) y comprueba si el `install_attempt_id` se puede reutilizar/canjear en la
   cuenta de B. Variante: `/admin/plugins/{plugin_id}?account_id=…`.

6. **saved-entities (`/chat/frontend/v1/saved-entities`)** — CRUD de entidades guardadas:
   A borra/lee la entidad guardada de B si conoce el ID sintético de B.

## 4) Evidencias y reproducción

- Bundle index + 12 JS: `~/.knk-suite/evidencia/1788663*_surface-*` (13 ficheros).
- Resultado estructurado: `knk-suite/backend/surface-result.json` (endpoints, identificadores, bundles).
- Sesión KNK: `artifacts.surface` guardado vía `/api/surface/map` (encontrar en `/api/session`).
- Para cada vector: baseline legítimo → petición cruzada A→B → captura navegador real + request/response → PoC mínimo → 2 reproducciones.

## 5) Notas de cumplimiento

- Solo assets estáticos en scope (`chatgpt.com`, `cdn.oaistatic.com`); ningún endpoint
  funcional fue llamado con sesión; no hubo mutaciones.
- El 403 intermitente de Cloudflare sobre el index se resolvió por reintento (no bloqueo de la suite).
- Los endpoints listados NO han sido probados: son el mapa de superficie para el flujo A/B autorizado.

> 🔐 **Modelo de autenticación (anexo):** `OPENAI-AUTH-MODELO-BEARER-COOKIES-2026-09-06.md` —
> clasifica 617 rutas por su `authOption` (Required / SendIfAvailable / Anonymous) extraído
> de los bundles, documenta el routing `/backend-api` vs `/backend-anon` según el header
> `Authorization`, y el flujo para obtener el access token (`/api/auth/session`) con el que
> los endpoints de `/files/library/*` y `/payments/*` exigen `Bearer`.
## 6) Ampliación — focus "payments" (2026-09-06, segunda pasada)

El módulo `surface-map` ahora extrae además:

- **Rutas dinámicas con template literals** (`/backend-api/${...}` → `/backend-api/{param}`),
  wrappers React Query (`safeGet/safePost/safePut/safeDelete`), con filtro de ruido
  (JSX/HTML, regex, mensajes de error de formatjs/Remix).
- **Mapa completo de rutas del manifest del SPA** (`routeChunks`): **1.419 rutas** → chunks lazy.
- **`focus=payments`**: descarga los bundles de pago/facturación que el index no precarga
  (8 descargados: `checkout._entity._checkoutId`, `payments.success-credit-purchase`,
  `payments.success-rate-limit-reset`, `api.checkout-payment-form-ready`, `gifts.credits._claim._claimCode`,
  `announcements.subscription_onboarding`, `academic-researchers.invite`, `advanced-account-security`).

### Endpoints de pago/facturación nuevos (62)

```
/payments/checkout                    /payments/checkout/confirm
/payments/checkout/update             /payments/checkout/snapshot
/payments/checkout/preview_renewal    /payments/checkout/custom_payment_method/continue
/payments/checkout/{processor_entity}/{checkout_session_id}
/payments/customer_portal             /payments/payment_methods
/subscriptions                        /subscriptions/cancel
/subscriptions/renew                  /subscriptions/renew/preview
/subscriptions/update                 /subscriptions/update/preview
/subscriptions/update/cancel_pending  /subscriptions/complete_payment
/subscriptions/complete_payment/invoice_details
/subscriptions/complete_payment/recovery_assignment
/subscriptions/seat-capacity/update   /subscriptions/credits/discount-offer
/subscriptions/auto_top_up/{enable|disable|settings|update}
/subscriptions/workspaces/{account_id}/self_serve_business(/preview)
/accounts/{account_id}/spend-controls/current-user/monthly-usage
/accounts/send_add_credits_nudge_email
/wham/usage                           /wham/usage/approximate-credit-usage
/wham/usage/credit-usage-events       /wham/usage/daily-token-usage-breakdown
/wham/usage/daily-workspace-user-token-usage-breakdown
/wham/rate-limit-reset-credits        /wham/rate-limit-reset-credits/consume
/files/upload_reservations            /files/upload_reservations/{reservation_id}/claim_and_finish
/files/library/storage/usage          /aip/ledger/credit/connection
/credits/pleas                        /admin/billing  /admin/usage  /pageConfigs/billing
/notifications/subscription/register  /notifications/subscription/deregister
/ca/v2/user/connect_and_activate      /ca/v2/user/activate_workspace_connection_and_user
```

### Vectores nuevos derivados (para el flujo A/B autorizado, sin comprar)

1. **`/payments/checkout/{processor_entity}/{checkout_session_id}`** — A usa el `checkout_session_id`
   de B (propio/sintético) en snapshot/update/confirm: ¿ve estado de checkout ajeno o confirma ajeno?
   (IDOR/CSRF en checkout, sin completar pago).
2. **`/subscriptions/workspaces/{account_id}/self_serve_business`** — parámetro `account_id` en ruta:
   ¿A puede leer el workspace self-serve de B con el ID sintético de B?
3. **`/subscriptions/auto_top_up/{enable|disable|settings|update}`** — lógica de negocio de recarga
   automática (límites, importes) con la propia cuenta; sin gastar créditos.
4. **`/files/upload_reservations/{reservation_id}/claim_and_finish`** — ¿A reclama la reserva de
   subida de B? (claim IDOR sobre reservation_id).
5. **`/wham/rate-limit-reset-credits/consume`** — lógica de negocio: consumo de créditos de reset
   de rate limit; con cuenta propia, sin abusar.
6. **`/subscriptions/credits/discount-offer`** — lógica de descuentos (parámetros manipulables).

### Resultado ampliado

| Métrica | 1ª pasada | 2ª pasada (focus payments) |
|---|---|---|
| Bundles | 12 | 12 + 8 (pago) |
| Endpoints únicos | 137 | **783** (filtrados de ruido) |
| Endpoints pago/facturación | ~10 | **62** |
| Rutas del manifest | — | **1.419** |
| Evidencias | 13 | 21 |

Resultado completo: `backend/surface-result-payments.json`.
