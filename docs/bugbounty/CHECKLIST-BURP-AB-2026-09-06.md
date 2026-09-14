# 🪤 Burp Suite — Checklist A/B paso a paso (OpenAI/Bugcrowd) — 2026-09-06

> Objetivo: ejecutar los **6 vectores** del surface map (`OPENAI-SURFACE-MAP-2026-09-06.md`,
> §3 y §6) con dos cuentas propias de test (A y B), **sin violar rate limit ni scope**,
> capturando request/response y pantallazos verificables para un reporte profesional.
> Cualquier duda sobre el Brief vigente → **manda el Brief**, no esta guía.

---

## ⏱️ 0) PREFLIGHT (5 min — haz esto antes de tocar Burp)

- [ ] Sesión KNK: target `chatgpt.com`, scope `chatgpt.com + cdn.oaistatic.com`, OPPLAN **aprobado** (verificado en Panel).
- [ ] Brief vigente leído (última actualización en `PROGRAMA-OPENAI-REGLAS-2026-09-05.md`).
- [ ] **Dos cuentas propias de test A y B** creadas/logueadas (preferible `@bugcrowdninja.com`).
- [ ] IP/VPN comprobada con el botón **Verificar IP (VPN)** de KNK (IP estable durante toda la sesión).
- [ ] Nada de datos de terceros, PII ni pagos reales: solo recursos **sintéticos propios** (`SYNTHETIC-*`).

---

## 🛠️ 1) Configuración de Burp (Pro, 2023+)

### 1.1 Dos listeners de proxy (uno por cuenta = etiquetado automático)

1. **Proxy → Proxy settings → Proxy listeners → Add.**
   - Listener **A**: `127.0.0.1:8080` → cuenta A.
   - Listener **B**: `127.0.0.1:8081` → cuenta B.
2. Ambos con `Running` marcado. (Dos listeners = cada request queda etiquetado por puerto en el historial.)

### 1.2 Scope estricto (solo lo aprobado)

1. **Target → Scope** (o Proxy settings → Scope):
   - *Include*: `chatgpt.com`, `cdn.oaistatic.com` (host exactos; usa "Advanced" con regex si quieres `^https://chatgpt\.com$`).
   - *Exclude*: `pay.openai.com`, `community.openai.com` (y cualquier host del Brief fuera de alcance).
2. En **Proxy settings → Request interception**: marca **"Use project scope"** y **"Disable all out-of-scope requests"** (o equivalente "Drop out-of-scope"). Así Burp corta automáticamente todo lo que no esté en scope.
3. Ojo con las redirecciones: `chat.openai.com` → 308 → `chatgpt.com` (en scope, ok); si algo salta a `pay.openai.com` o a terceros (Stripe/Google) → **se corta solo. NO la sigas a mano.**

### 1.3 Certificado CA de Burp (HTTPS)

1. Navega en cada navegador a `http://burp` → descarga **CA Certificate**.
2. Instálalo como autoridad de confianza (Windows: doble clic → Instalar certificado → Equipo actual → Entidades de certificación raíz de confianza) **en ambos perfiles de navegador**.
3. Verifica: en `https://chatgpt.com` el candado muestra "emitido por PortSwigger".

### 1.4 (Opcional) Marca visual A/B

- En **HTTP history**: botón derecho → **Add comment** (p. ej. `V1-BASELINE-B`) y cambia el color de la entrada (menú de color) según cuenta/fase. Filtra después por listener (diálogo **Filter → Listener**) o por comentario.

### 1.5 Verificación medida (2026-09-06 — el test que distingue intercept ON de OFF)

- Burp Community/Pro guarda su configuración **en memoria** (proyecto temporal): no hay `UserConfig.json`
  ni `*.burp` legibles en `~/AppData/Roaming/BurpSuite/` (solo manifests de extensiones).
  **No se puede leer el estado de intercept desde disco** → se verifica por comportamiento:

```bash
# Si esto cuelga (HTTP 000 tras 10 s) → Intercept está en ON reteniendo peticiones.
# Si responde rápido (200/30x) → intercept OFF y el tráfico fluye.
curl -s -k --max-time 10 -x http://127.0.0.1:8080 -o /dev/null -w "%{http_code}\n" https://chatgpt.com/
```

- Estado medido hoy (2ª verificación): el proxy **YA reenvía** (intercept OFF aplicado).
  Un GET via Burp responde **403 de Cloudflare (`Cf-Mitigated: challenge`, `Server: cloudflare`)**
  al cliente curl — es el challenge anti-bot de Cloudflare, no un bloqueo de Burp; el navegador real
  lo resuelve solo. Control directo sin proxy: **HTTP 200 en 0,3 s**.
- Recordatorio: si vuelve a aparecer **HTTP 000 tras 10 s**, el Intercept está ON de nuevo → pasarlo a OFF.

---

## 🌐 2) Navegadores: perfil A y perfil B separados

> Sesiones de cookies independientes = aislamiento limpio. Nunca uses la misma ventana para A y B.

- **Cuenta A (listener 8080):** Chrome normal con proxy del sistema → Burp.
  - Windows: Ajustes → Proxy → manual `127.0.0.1:8080` (o usa el navegador de Burp).
- **Cuenta B (listener 8081):** lanza Edge/Chrome con proxy explícito y perfil propio (Git Bash):

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --proxy-server=127.0.0.1:8081 \
  --user-data-dir=C:/Users/knkli/.knk-suite/browser-profiles/cuenta-b \
  https://chatgpt.com/
```

- Alternativa: la **VM Kali (knk-bounty-ova)** con proxy a 8081 — mismo efecto, más aislamiento.
- Cada navegador: login con SU cuenta (A→8080, B→8081). Verifica en `https://chatgpt.com` que aparece tu cuenta correcta (nombre/avatar) antes de probar nada.

---

## 🐢 3) Ritmo y reglas de oro (no negociables)

- [ ] **Mínimo 2 segundos entre peticiones autenticadas.** Cuenta con cronómetro mental o usa el campo **Throttle** de Repeater si tu versión lo tiene; **nunca** en paralelo ni con pipelining.
- [ ] **Prohibido:** Intruder, Scanner, extensiones de fuzzing, repeater automático, fuerza bruta, enumeración de IDs.
- [ ] **Uno a uno:** cada petición se envía, se lee la respuesta, se espera ≥2s, se decide, se anota.
- [ ] **Stop inmediato ante:** `429`, CAPTCHA, bloqueo (403 de Cloudflare "Just a moment"), PII ajena, datos de terceros, pantalla de pago real.
  → Espera a que expire el bloqueo; **no** intentes evadirlo.
- [ ] **No comprar nada. No consumir créditos.** Los endpoints de pago solo se *inspeccionan* (GET/preview/snapshot) salvo que el vector exija un POST — y entonces SOLO con datos sintéticos y sin confirmar.
- [ ] **Sin enumeración:** un solo ID conocido (el recurso sintético de B). Si el test responde con datos ajenos: para, captura, no sigas.

---

## 📋 4) Protocolo por vector (los 6 del surface map)

> Plantilla para CADA vector — se repite idéntica:
> **1)** baseline legítimo con B (esperado 200) → **2)** petición cruzada A→recurso de B con ID sintético de B → **3)** misma petición una 2ª vez (reproducibilidad) → **4)** captura pantallazo navegador real (KNK: **Navegar y capturar**) → **5)** guardar request+response en **Organizer** (botón derecho → Add to Organizer) → **6)** rellenar la matriz del §5.

### V1 — `checkout_session_id` cruzado (IDOR checkout)
- Endpoint: `POST/GET /payments/checkout/{processor_entity}/{checkout_session_id}` (+ `snapshot`, `update`, `confirm`, `preview_renewal`).
- B crea un checkout **sin pagar** (sesión propia, datos sintéticos) → captura su `checkout_session_id`.
- A envía la misma petición con el `checkout_session_id` **de B**.
- **Hallazgo si:** A ve el estado/plan/importe del checkout de B, o `confirm`/`update` acepta la sesión de B (sin completar el pago; si confirm exige pago real → **NO continuar**).
- Cuidado: `payments.checkout` puede redirigir a `pay.openai.com` (fuera de scope) → Burp la corta; anótalo como dato, no la sigas.

### V2 — `{account_id}` en workspace self-serve (cross-account)
- Endpoint: `GET /subscriptions/workspaces/{account_id}/self_serve_business` (+ `/preview`).
- B (o A) crea un workspace de test con `account_id` conocido y sintético.
- A pide el mismo endpoint con el `account_id` de B.
- **Hallazgo si:** A recibe datos del workspace de B (miembros, plan, billing) que no debería.

### V3 — `auto_top_up` (lógica de recarga)
- Endpoint: `POST /subscriptions/auto_top_up/{enable|disable|settings|update}`.
- Con la cuenta A: cambiar ajustes con parámetros límite/importe manipulados (0, negativo, `NaN`, muy alto).
- **Hallazgo si:** se aceptan importes/límites inválidos que permitirían gasto no deseado (p. ej. top-up negativo o sin tope). No dejar activado un cambio que gaste dinero; si `enable` implica cargo → no activar (solo `settings`/`update`).

### V4 — Claim de `upload_reservations` (claim IDOR)
- Endpoint: `POST /files/upload_reservations/{reservation_id}/claim_and_finish`.
- B crea una reserva de subida (`/files/upload_reservations`) con nombre `SYNTHETIC-*` y un contenido inofensivo.
- A reclama la reserva **de B** con su `reservation_id` sintético.
- **Hallazgo si:** A consigue claim/finish de la reserva de B (robo de slot de subida o de fichero).
- Variante del mismo viaje: `GET /files/library/storage/usage` cruzado.

### V5 — `rate-limit-reset-credits/consume` (lógica de créditos)
- Endpoint: `POST /wham/rate-limit-reset-credits/consume` (y `GET /wham/rate-limit-reset-credits`).
- Con A: observar saldo propio, repetir `consume` con la cuenta propia sin abusar (máx. 2 llamadas, separadas ≥2s).
- **Hallazgo si:** se puede consumir crédito de reset sin límite/duplicado (doble gasto) o afectar al saldo de B (no lo intentes: solo propio).

### V6 — `discount-offer` (lógica de descuentos)
- Endpoint: `GET/POST /subscriptions/credits/discount-offer`.
- Con A: solicitar la oferta legítimamente (si existe) y repetir; probar parámetros de reutilización (¿múltiple uso de un mismo offer token?).
- **Hallazgo si:** la misma oferta se puede canjear N veces o con importe manipulado. **No canjear si implica cargo real.**

---

## 📸 5) Evidencia mínima por vector (para que el reporte sea válido)

Por cada hallazgo candidato, guarda TODO en `evidencia-poc/`:

1. **Request + response** exportados de Burp (**Organizer** o botón derecho → Save item) → `evidencia-poc/http/vectorN-<paso>.req|.resp`.
2. **Pantallazo del navegador real** (KNK: sección **Navegador real CDP** → pega la URL del paso → **Navegar y capturar**; el PNG cae en `~/.knk-suite/evidencia/browser/`) → copia a `evidencia-poc/pantallas/`.
3. **Dos reproducciones** (2ª petición idéntica con el mismo resultado).
4. **Baseline de control**: B leyendo SU recurso → 200 (prueba de que el acceso de A es el fallo, no un 404 genérico).
5. Anotación de cumplimiento: timestamp, cuenta usada, rate limit respetado, sin datos ajenos.

### Matriz de resultados (rellenar tras cada vector)

| # | Vector | Baseline B | A→recurso B (1ª) | Reproducción (2ª) | ¿Reproducible? | Veredicto | Severidad candidata |
|---|---|---|---|---|---|---|---|
| V1 | checkout_session_id | | | | | | |
| V2 | workspace account_id | | | | | | |
| V3 | auto_top_up | | | | | | |
| V4 | upload_reservations claim | | | | | | |
| V5 | rate-limit-reset consume | | | | | | |
| V6 | discount-offer | | | | | | |

Veredicto: `200 legítimo` / `403 correcto` (no reportable) / `acceso indebido` (reportable) / `requiere confirmación`.

---

## 🔁 6) Vectores extra del surface map (misma plantilla)

| # | Vector | Endpoint clave | Qué intercambiar |
|---|---|---|---|
| V7 | IDOR biblioteca de archivos | `POST /files/library/files`, `POST /files/library/google-drive/materialize` | `file_id` sintético de B usado por A |
| V8 | Revocación de conversación compartida | `chatgpt.com/share/{share_id}`, `/conversation/{id}` | A comparte a B, revoca, B re-accede |
| V9 | Handoff de cuenta | `/api/auth/handoff/bind`, `/inspect` | token de handoff propio del flujo de B (nunca token real ajeno) |
| V10 | Instalación de plugin cross-account | `/plugins/{plugin_id}/enable`, `install_attempt_id` | `account_id` de workspace de B en el flujo de A |
| V11 | saved-entities | `/chat/frontend/v1/saved-entities` | ID de entidad guardada de B leído/borrado por A |

---

## 🧹 7) After-action

- [ ] Revisa en Burp que **ningún request salió fuera de scope** (filtro por listener + revisar exclusions).
- [ ] Copia evidencias finales a `evidencia-poc/` y completa la matriz del §5.
- [ ] Si hay hallazgo: redacta el borrador de reporte con la plantilla de la suite (**📝 Reportes**), incluyendo el ID de conversación solo si es necesario y saneado.
- [ ] No reutilices IDs reales capturados; borra cualquier dato sintético ya usado si procede.
- [ ] Cierra la sesión en los dos navegadores y revisa que no quedaron cookies de test en perfiles personales.

---

*Esta checklist complementa las compuertas de KNK (`gates.js`) y el OPPLAN aprobado; no sustituye al Brief.*