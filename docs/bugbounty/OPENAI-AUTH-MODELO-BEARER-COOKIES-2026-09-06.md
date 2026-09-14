# 🔐 OpenAI/ChatGPT — Modelo de autenticación de la SPA (Bearer vs cookies)

> Extraído el 2026-09-06 de los bundles del SPA de chatgpt.com descargados por
> el surface-map de KNK Suite (`~/.knk-suite/evidencia/*_surface-*.js`).
> Complementa `OPENAI-SURFACE-MAP-2026-09-06.md` con el *cómo* autentica cada
> endpoint el cliente oficial — clave para saber qué peticiones requieren
> `Authorization: Bearer` (y por qué nuestro driver V7 recibía 401 "Access
> token is missing" solo con cookies).

---

## 1) Mecanismo central (código de los bundles)

La SPA usa un enum de opciones de auth por petición y una función que construye
las cabeceras según esa opción:

```js
// Enum authOption (minificado como Ir en el bundle 8b34dbc2):
//   Required=0, SendIfAvailable=1, Anonymous=2
e.Required=0, e.SendIfAvailable=1, e.Anonymous=2

// Construcción de cabeceras (Sa = AuthHeader):
//   - accessToken null y isAuthOptional=true  → cabeceras SIN Authorization
//   - accessToken null y NO isAuthOptional    → lanza:
//       "No access token when trying to use AuthHeader"
//   - accessToken presente                    → n.Authorization = `Bearer ${t}`
function Sa(e={}){
  let t=e.accessToken??Aie(), n=xa();          // xa() = cabeceras base (device, etc.)
  if(t==null){
    if(e.isAuthOptional===!0) return n;         // SendIfAvailable sin token
    throw new Ca(`No access token when trying to use AuthHeader`); // Required
  }
  n.Authorization=`Bearer ${t}`;
  let r=V.getCookie(B.Workspace);               // workspace cookie → header extra
  return typeof r==`string`&&r!==`personal`&&(n[Oi]=encodeURIComponent(r)), n;
}
```

Selección por endpoint (default del wrapper safeGet):

```js
i = whe(r) ? (t?.authOption ?? Ir.SendIfAvailable) : Ir.Anonymous
//   ruta hacia la API misma-origen → authOption explícito o SendIfAvailable
//   ruta hacia otro origen          → Anonymous
```

Y el **routing de base URL depende del header Authorization** (bundle
conversation-small):

```js
function fen(e){ return new Headers(e.headers).has(`Authorization`); }
function men(e){ return fen(e) ? `/backend-api` : `/backend-anon`; }
//  con Authorization → https://chatgpt.com/backend-api
//  sin  Authorization → https://chatgpt.com/backend-anon
```

### Significado de cada opción

| authOption | Comportamiento | Ejemplo práctico |
|---|---|---|
| `Required` | Bearer **obligatorio**; el cliente lanza error si no hay access token | `/models`, `/apps/directory/installed`, `/plugins/{id}/install` |
| `SendIfAvailable` | Bearer **solo si hay access token**; si no, va sin él (puede usar cookies) | `/me`, `/conversations`, `/files/process_upload_stream` |
| `Anonymous` | **Nunca** envía Authorization (cabeceras base `xa()`) | `/conversation/experimental/generate_autocompletions_anon` |
| `cy` (plugins) | Auth de plugins/workspace (header específico `x-workspace-id` o similar) | `/plugins/list`, `/plugins/installed` |

> ⚠️ **Importante para el flujo A/B:** `SendIfAvailable` **no** garantiza que el
> servidor acepte cookies solas: si el backend exige token (como
> `/files/library/*`, que responde 401 "Access token is missing" sin Bearer),
> hay que enviar `Authorization: Bearer <accessToken>`. El access token se
> obtiene de `GET /api/auth/session` (NextAuth) con las cookies de la sesión.

---

## 2) Bases URL descubiertas

| Variable | Valor | Uso |
|---|---|---|
| `VITE_SHARED_API_URL` | `https://chatgpt.com/backend-api` | API autenticada estándar |
| `VITE_SHARED_ANON_API_URL` | `https://chatgpt.com/backend-anon` | API anónima (misma ruta sin Authorization) |
| `VITE_SHARED_ALT_API_URL` | `https://chatgpt.com/backend-alt` | API alternativa (p.ej. `/f/steer_turn` por modelo) |
| `VITE_SNC_API_URL` | `https://chatgpt.com/backend/se` | API de "safety/events" |
| `VITE_PUBLIC_API_URL` | `https://chatgpt.com/public-api` | API pública (invites, etc.) |
| `VITE_SAVED_ENTITIES_API_URL` | `https://chatgpt.com/backend-api` (fallback) | saved-entities |

El wrapper `hen()` decide la base dinámicamente por endpoint: si la petición
lleva `Authorization` → `/backend-api`; si no → `/backend-anon`. Eso significa
que **la misma ruta puede existir en ambas bases** y el cliente elige según
tenga o no access token.

---

## 3) Clasificación por authOption (617 rutas únicas extraídas)

### 3.1 Required — Bearer obligatorio (25)

```
/accounts/users/signup_attribution
/aip/connectors/{connector_id}/actions
/apps/directory/installed
/apps/directory/workspace
/apps/installed
/apps/sources_dropdown
/chat/frontend/v1/saved-entities
/chat/frontend/v1/saved-entities/remove
/chat/frontend/v1/saved-entities/status
/composer/items
/composer/items/interactions
/composer/lighthouse-items
/connectors/directory/list_installed
/file_upload_action_suggestions
/files/{file_id}
/models/config
/models/slugs
/onboarding/recommendations
/plugins/admin/by-app/batch
/plugins/admin/public-catalog/export
/plugins/{plugin_id}/install
/plugins/{plugin_id}/shares
/share/prompt-share
/tpp/onboarding/suggestions
/user_granular_consent
```

### 3.2 SendIfAvailable — Bearer opcional (74)

```
/accounts/{account_id}/identity
/accounts/{account_id}/invites/accept
/accounts/{account_id}/sso/connections/workos
/accounts/{account_id}/sso/workos/connections/list
/aip/connectors/{connector_id}/logo
/apps/availability
/apps/directory/apps
/apps/directory/browse
/apps/directory/details/{app_id}
/bazaar/ad-survey/render
/bazaar/ad-survey/response
/bazaar/event
/bazaar/feedback-form
/bazaar/feedback-form/submit
/bazaar/obi/sync-token
/bazaar/signal-event
/beacons/event
/compliance
/compliance/cookie_consent
/connectors/directory/list_workspace
/connectors/directory/{app_id}
/conversation/experimental/generate_trending_suggestions
/conversation/init
/conversation/message/ask-user-input-v3/next-question
/conversation/message/followups/feedback
/conversation/message/genui/feedback
/conversation/message_feedback
/conversation/{conversation_id}/rating
/conversation_limit
/conversations
/conversations/{conversation_id}
/conversations/{conversation_id}/messages
/dictation/upload-asset
/f/conversation/prepare
/files/process_upload_stream
/files/upload_reservations/{reservation_id}/claim_and_finish
/files/{file_id}/simple
/gizmos/discovery/{category_or_cut_id}
/gizmos/{gizmo_id}/share
/images/init
/images/prompt-items
/images/styles
/local/entity-shares
/local/home
/me
/models
/models/gpts
/my/recent/image_gen
/my/recent/uploaded_images
/onboarding/quorum/examples
/paragen_submission
/pins
/plugin-shares/{share_key}
/plugins/featured
/plugins/home
/prompt_library/
/prompt_library/use_case/{use_case_id}
/report_flow/reasons/{entity_type}
/report_flow/report
/search/browse_turn_filters
/search/browse_turn_products
/sentinel/heartbeat
/sentinel/modal_ack
/settings/is_adult
/settings/user
/settings/voices
/share/post
/share/post/link
/system_hints
/tpp/models/
/transcribe
/translation-block/translate
/trusted_contact/enabled
/unified_user_signals
```

### 3.3 Anonymous — nunca Authorization (5)

```
/conversation/experimental/generate_autocompletions
/conversation/experimental/generate_autocompletions_anon
/conversation/experimental/generate_entity_autocompletions_anon
/gizmos/u/{uid}
/gizmos/{gizmo_id_or_short_url}
```

### 3.4 cy — plugins/workspace (12)

```
/plugins/batch
/plugins/canonical-app/{app_id}
/plugins/installed
/plugins/list
/plugins/workspace/created
/plugins/workspace/shared
/plugins/{plugin_id}
/plugins/{plugin_id}/archive
/plugins/{plugin_id}/enable
/plugins/{plugin_id}/uninstall
/public/plugins/workspace/{plugin_id}
/public/plugins/workspace/{plugin_id}/app
```

### 3.5 Default (489) — sin authOption explícito en la llamada

El wrapper aplica `SendIfAvailable` si la ruta es hacia la API misma-origen
(≈ todo `/backend-api/*`) y `Anonymous` si es cross-origin. **Dentro de este
grupo caen los endpoints del V7:** `/files/library/files`,
`/files/library/directories/path`, `/files/library/google-drive/materialize`,
`/files/upload_reservations/*`, `/payments/*`, `/subscriptions/*`, `/wham/*`,
`/accounts/{account_id}/spend-controls/*`, etc.

> ⚠️ **Verificado en vivo (2026-09-06):** `/files/library/*` **rechaza solo con
> cookies** → `401 {"detail":{"message":"Unauthorized - Access token is
> missing"}}`. O sea: aunque el cliente los marque `SendIfAvailable`, el
> backend exige el Bearer. En el navegador real la SPA siempre tiene access
> token en memoria (de `/api/auth/session`), por eso funciona; desde scripts
> hay que enviarlo explícitamente.

### 3.6 Otros flags puntuales

- `BLt` (2): `/plugins/search`
- `FC` (1): `/plugins/{plugin_id}/skills/{skill_name}`
- `ixe` (1): chat requests (`/backend-api/conversation` streaming)
- `tv` (1): telemetría
- `Mr.SendIfAvailable` (11) / `Mr.Required` (1) / `Mr.Anonymous` (3): segundo
  juego de enums equivalente (otro módulo del cliente, misma semántica).

---

## 4) Flujo de obtención del access token (lo que hay que replicar)

1. Con las cookies de sesión (`__Secure-next-auth.session-token` +
   `oai-sc` + `_uasid`/`_umsid` + `__Secure-oai-is` en `.chatgpt.com`):
   `GET https://chatgpt.com/api/auth/session`
2. Respuesta 200 → `{ user: { id: "user-…", ... }, accessToken: "<JWT>",
   expires: … }`
3. El `user.id` es el **discriminador real de cuenta** (el `id` de
   `/backend-api/me` es el device id `ua-<oai-did>` y NO sirve para comparar
   cuentas A/B).
4. Usar ese `accessToken` como `Authorization: Bearer <token>` en los
   endpoints que lo exijan (`/files/library/*`, `/payments/*`, …).

### Verificación de identidad A/B (corregida)

- ✅ Discriminador correcto: `GET /api/auth/session → user.id`
- ❌ Discriminador incorrecto: `GET /backend-api/me → id` (device id, igual
  para todas las cuentas del mismo dispositivo)

Aplicado en `backend/ab-v7-idor.js` (gate + Bearer).

---

## 5) Referencias

- Surface map: `OPENAI-SURFACE-MAP-2026-09-06.md`
- Checklist operativa A/B: `CHECKLIST-BURP-AB-2026-09-06.md`
- Reporte V7: `OPENAI-REPORTE-V7-BIBLIOTECA-ARCHIVOS-2026-09-06.md`
- Extracción cruda: `~/.knk-suite/evidencia/*_surface-*.js` (bundles 8b34dbc2,
  conversation-small-hiw4wce20lu6te81, 4813494d)
- Lista completa 617 rutas con flags: generada por script en sesión
  (archivo temporal `rutas-authoptions.tsv`).

## 6) Verificación empírica /backend-anon — files, payments, subscriptions (2026-09-06, noche)

Rutas relevantes probadas en `https://chatgpt.com/backend-anon` **sin**
`Authorization` (solo cookies de la cuenta propia A o sin cookies), ritmo ≥2.2 s:

### Qué devuelve 200 con cookies solas

| Ruta | Resultado | Nota |
|---|---|---|
| `POST /files` | **200** `{"status":"success","upload_url":"https://files.oaiusercontent.com/file-…?sp=cw&…"}` | Emite una reserva de subida con URL firmada (create-write) + `file-<id>`. Exige sesión: sin cookies → 401 `Unauthorized`. Es el flujo de subida "legacy" del composer, donde el cliente llama `safePost('/files', {authOption: isUnauthenticated ? Mr.Anonymous : void 0})` (bundles) — **comportamiento por diseño**, no hallazgo |

### Qué NO devuelve datos (401 aunque haya sesión válida)

`files/library/*` (nodes, recents, storage/usage, files, upload_reservations),
`payments/*` (payment_methods, customer_portal, checkout/snapshot,
checkout/preview_renewal) y `subscriptions/*` (renew/preview, discount-offer,
auto_top_up/settings, complete_payment/*) → **401 "Access token is missing"**
con cookies solas; mismo comportamiento en `/backend-api`. Los 405 (existen pero
método distinto) indican que la ruta está registrada, pero la auth gate precede
al dispatch: cambiando el método sigue 401. `/wham/rate-limit-reset-credits`
→ 401 `Unauthorized`.

**Conclusión:** en la superficie `/files/` `/payments/` `/subscriptions/` la única
respuesta con datos usando cookies solas es `POST /files` (reserva de subida por
diseño, acotada por sesión y URL SAS de corta vida). **Ninguna ruta de las tres
familias devuelve datos ajenos o sensibles con cookies solas** — todas exigen
`Authorization: Bearer` (excepto los flujos anónimos de subida del composer).
Evidencia cruda: `evidencia-poc/http/backend-anon-sondas-files-payments-subs.txt`.

## 7) Verificación empírica /backend-anon — accounts, gizmos, plugins, conversation (2026-09-06)

Mismo método: sondas en `https://chatgpt.com/backend-anon` con cookies de la
cuenta propia (o sin cookies), sin `Authorization`, ritmo ≥2.2 s. Evidencia cruda:
`evidencia-poc/http/backend-anon-sondas-cuentas-gizmos-plugins-conv.txt` y
`backend-anon-sondas-contraste.txt`.

### Qué devuelve 200 con cookies solas (y 401 sin cookies)

| Ruta | Resultado | Nota |
|---|---|---|
| `GET /accounts/check/v4-2023-04-27` | **200** (401 sin cookies) | Devuelve el estado de la CUENTA PROPIA de la sesión: rol (`account-owner`), residencia compute, estado processor/billing (`has_customer_object`, `has_transaction_history`), flags de suscripción, org. Es la ruta de bootstrap de la SPA (`fetchAccountState`, `authOption: SendIfAvailable` si no hay accessToken en memoria). Datos auto-scoped: sin parámetro de enumeración (un `email=` extra se ignora). **Por diseño, sin hallazgo** |
| `GET /plugins/featured` | **200** (401 sin cookies) | Catálogo público curado de IDs de plugins (`github@openai-curated`, `slack@…`, …). Sin datos de usuario — contenido público de la tienda (`SendIfAvailable`). **Por diseño** |
| `POST /conversation/experimental/generate_trending_suggestions` | **200** (401 sin cookies) | `{suggestions:[], moderation_scores:{}}` — sugerencias de la home (públicas, no por-usuario). **Por diseño** |

### Qué NO devuelve datos (401 aunque haya sesión válida)

| Ruta | Resultado | Nota |
|---|---|---|
| `accounts/optimized/check`, `accounts/mfa_info` | 401 `Access token is missing` | La variante `optimized` SÍ exige Bearer (a diferencia de la legacy `check`); `mfa_info` también |
| `gizmos/discovery_anon` (con cookies, sin cookies y con Bearer en `/backend-api`) | 401 / 404 `Expected non-None but got None` | El nombre `_anon` del cliente es engañoso: el backend exige autenticación igualmente; en la base autenticada la variante anónima ni siquiera está registrada. **Sin anonimato real** |
| `gizmos/discovery`, `gizmos/bootstrap`, `gizmos/search` | 401 | Auth requerida |
| `plugins/list` (workspace), `plugins/batch` | 401 | Auth requerida |
| `plugins/home`, `plugins/installed` | **404** | No registradas en la base anónima (no es 401: la ruta no existe ahí) — solo en la base autenticada |

**Conclusión (familias accounts/gizmos/plugins/conversation):** las únicas rutas
con datos vía cookies solas son tres flujos **por diseño** (estado de cuenta
propia, catálogo público de plugins, sugerencias de home) — todas devuelven
401 sin cookies y ninguna expone datos ajenos. `gizmos/discovery_anon` NO es
accesible sin Bearer pese a su nombre. Coherente con §6: el backend exige
`Authorization: Bearer` para todo lo específico de usuario; las superficies
"anon" del cliente son etiquetas de intención, no de control de acceso.

## 8) Identificadores de archivo: formato, entropía y enumerabilidad (2026-09-06)

Sonda con las cuentas propias A/B (ritmo ≥2.2 s, sin enumeración de terceros):
`POST /backend-anon/files` (legacy) y `POST /files/upload_reservations`
(biblioteca), análisis estático de 12+ ids + accesos con id pelado. Evidencia:
`evidencia-poc/http/fileid-probe-log.txt`, `fileid-probe-records.json`,
`fileid-probe2-log.txt`, `fileid-probe3-log.txt`.

### Dos familias de ids distintas

| Flujo | Formato | Entropía observada |
|---|---|---|
| Legacy `POST /files` | `file-<22 chars base62>` (p.ej. `file-TsbGvat8nnb5V3zjMN6CNJ`) | ≈ 62²² ≈ **2¹³¹** — aleatorio, no enumerable |
| Biblioteca `POST /files/upload_reservations` | `file_<UUIDv8>` (p.ej. `file_000000004c2881f497dc16a82b414d05` = `00000000-4c28-81f4-97dc-16a82b414d05`) | 32 bits constantes (`00000000`) + nibble de versión (8) + ~16 bits con componente temporal (low16 del campo versión: `81f4→8210→8243` crece con el tiempo) + **~80-92 bits aleatorios** |

### Enumerabilidad / predictibilidad

- **Legacy:** charset `[A-Za-z0-9]{22}` → ~131 bits efectivos; adivinar un id válido es inviable. Sin secuencia observable.
- **Biblioteca:** los ids son UUIDv8 **no secuenciales**: 3 reservas de B espaciadas 6.4 s no muestran monotonicidad del id completo (`4c28… → 2ce4… → 9a70…` decrece); A intercala en el mismo espacio de valores (generador global compartido, no por-cuenta). Los únicos bits estructurados son constantes (prefijo + versión) o de baja entropía (componente temporal) — insuficientes: **≥80 bits de aleatoriedad efectiva**.

### ¿Un id adivinado da acceso a la reserva de otra sesión? NO (verificado)

Con ids de la cuenta B probados desde la sesión de A (y de forma anónima):

| Prueba | Resultado |
|---|---|
| A: `GET /backend-api/files/{id_biblioteca de B}` | **404** `File not found` (resolución por tenant) |
| A: `GET /backend-api/files/{file_id legacy de B}` | **404** `File not found` |
| A: `claim_and_finish` del id de B | 200 eco + **`file.processing.error` "File not found"** server-side (sin materializar) |
| GET anónimo `files.oaiusercontent.com/file-{id}` sin sig | **404** `ResourceNotFound` (Azure — la firma es obligatoria) |
| A: `estuary/content?id={id}` sin sig | **422** (exige `ts`+`sig`) |

**Conclusión:** defensa en profundidad correcta — (1) ids de alta entropía
(≥80 bits), (2) firma SAS obligatoria para la ruta de escritura y de lectura,
(3) resolución de recursos acotada al tenant de la sesión (404 cruzado),
(4) chequeo de propietario en el procesamiento del claim. **Ninguna superficie de
enumeración o predicción de reservas ajenas; sin hallazgo reportable en este
vector.** (Nota: la fuga de hostname interno `sediment-service…svc.cluster.local`
en el evento de claim fallido queda registrada en E13 como observación
informativa.)