# Metodología de Lógica de Negocio — knk-suite

La lógica de negocio es la clase de bugs que mejor paga en bug bounty y la que
más rechazos genera cuando se reporta sin cadena de impacto. Esta metodología
es el proceso fijo de la suite para cazarla con disciplina.

Implementación: `backend/lib/bizlogic.js` · Compuerta: `bizChain` en `backend/lib/gates.js`
· UI: pestaña Compuertas → "🧮 Lógica de negocio" · Fase EXPLOIT del pipeline.

## Regla de oro

> Un sondeo sin impacto en OTRA cuenta o en la PLATAFORMA no es un bug.
> "El servidor aceptó el monto alterado" es un hallazgo; "el endpoint responde
> 200 sin sesión" no lo es.

Esta es la lección de los dos reports rechazados en YesWeHack (CORS reflejado
sin lectura real): cabecera/sonda ≠ vulnerabilidad. Impacto demostrado = sí.

## Lecciones de campo (recon real 2026-08: onramp/og/web)

Dos descartes que ahorran ciclos antes de abrir la compuerta. Se registran para
que el plan de ataque (OPPLAN) los valide ANTES de invertir tiempo:

### 1 · «Tier **Not Eligible**» = patrimonio 0 de bounty — comprobarlo antes de recon

En HackerOne, un target listado en el scope de la consola puede estar en un tier
sin reward (`Not Eligible`). Ejemplo real: `og.com` y `web.crypto.com` aparecen
en el scope crypto.com pero marcados **Not Eligible**.

- Consecuencia: cualquier hallazgo ahí (incluso un takeover real de un CNAME a
  terceros, p.ej. whitelabels SendGrid en `ablink.*.og.com`) **se rechaza por
  política, sin entrar al fondo**. Es un reporte con ratio defecto/riesgo=0.
- **Acción del OPPLAN/plan:** el paso `plan` debe validar el **tier/reward** de
  cada asset antes de marcarlo como objetivo. No basta con que "esté en scope".
- Señales pasivas a recoger en recon: tier enum, 24/0% reports → target frío.

### 2 · SPA embebible detrás de parámetros de merchant/partner (= superficie no accesible)

Un SPA puede servir su shell (`/_next/static/chunks/...`) incluso cuando la
**ruta de negocio 404a server-side sin el query de integración**. Ejemplo real:
`pay-onramp.crypto.com/set_amount` devuelve el shell de Next pero redirige a
`/404` sin los params de partner; el backend (`pay-api.crypto.com`, Rails) devuelve
404 uniforme y los chunks lazy de la página nunca se despliegan accesibles.

- **No es que falte fuzzing** — es un flujo que solo monta con la integración de
  un merchant (una app que firma/posee los params). Mapearlo a mano es adivinar
  rutas, que es exactamente el anti-patrón de `biz-g0` "flujo real no adivinado".
- **Acción:** si el SPA requiere un query de partner/merchant y no se tiene uno
  válido, marcar como `accesoNoDisponible` y pasar al siguiente target — no quemar
  ciclos en arqueología de `_buildManifest` ni en adivinar paths (eso se ve como
  fuzz/crawling por el triager, similar a un rechazo por actividad fuera de policy).
- Matiz útil: los chunks que SÍ se sirven (layout/runtime/config) se pueden
  grep-ear (p.ej. escalas de fees) sin tocar nada, pero no generan hallazgo solos.

### 3 · `ACAO:*` en endpoints que dan **500** o están **login-gated** NO pasan compuerta

Un endpoint puede reflejar `Access-Control-Allow-Origin: *` pero ser una trampa
para el triage si detrás de esa cabecera **no hay recurso explotable**:

- **HTTP 500 / 502 / 503 (error server)**: el endpoint falla antes de servir datos.
  `ACAO:*` en una respuesta de error no expone NADA — no hay `crossOriginRead`
  posible porque no hay recurso que leer. Reflejar + 500 = no reportable.
- **Login-gated (redirect/401/página de sign-in)**: el endpoint devuelve la
  página de login o un 401 en vez del recurso privado. `ACAO:*` ahí no sirve: el
  otro origen no puede leer datos sensibles si la única respuesta es el reto de
  autenticación (y el login en sí no es el dato). O el recurso está tras una
  sesión que el navegador cross-origin ni siquiera tiene.

Ambos casos **fallan la compuerta CORS** en `gates.js`: la reflexión de la
cabecera no va acompañada de `originReflected+allowCredentials` sobre un recurso
real y sensible. Reflejar ≠ leer; y sin recurso (500) o sin acceso (login-gated)
no hay lectura, ergo no hay exfiltración, ergo `cors-g4`/`cors-g5` caen.

- **Acción del plan:** al cazar un `ACAO:*` sospechoso, registrar `endpointStatus`
  (si es 5xx) y `loginGated` (si reenvía a auth/401). Si cualquiera de los dos es
  cierto, **descartar sin abrir compuerta** — es el mismo anti-patrón que nos quemó:
  cabecera/sonda ≠ vulnerabilidad.

### 4 · Método cart-real: verificar endpoint concreto y leer el estado canónico (`MiniCart`)

Hallazgo metódico del engagement con carrito guest (Newegg, 2026-08):

- **El nombre del endpoint en el bundle NO es el endpoint real.** El bundle
gestionaba el carrito vía `InitCartApi`/`SmartCartApi`, pero el **add-to-cart real del
SPA era `POST /api/Add2CartV2`** (falso amigo del bundle). Mapear solo por
bundles → apuntar a la ruta equivocada. La firma real (URL `ts&timestamp&nonce&appId`
y body `ItemList[...]`) salía del tráfico vivo del SPA, no del grep estático.
- **Un `201 Success` de mutación NO prueba el efecto.** Newegg respondía `201
Success` a `Quantity:-1/999/5000` pero **clampeaba server-side** (MiniCart quedaba
en 2). Si solo se mira el HTTP del add, se falsa un doble-aplicación/gus truncado.
El **estado canónico** se lee con `POST /api/MiniCart` (u equivalente de la
plataforma), que devuelve items+qty+precio servido por el catálogo.
- **El precio no viaja en el request** de add/update (solo `ItemKey`/identidad +
`Quantity`); lo resuelve el servidor de su catálogo. Sin campo de dinero del cliente
⇒ `biz-precio` no tiene dónde apuntar.

Reglas que se incorporan al playbook:

1. **Confirmar el endpoint REAL con tráfico vivo** antes de asumir el nombre del
   bundle (el bundle es heurística, no garantía).
2. **El veredicto lo da el estado canónico** (`MiniCart`/cart/order GET de la
   plataforma), no el `status` de la mutación. Un `201` con clamp no es un bug de
   aceptación: `biz-g3` exige que el valor alterado se REFLEJE en el estado
   canónico, no solo que el add devuelva Success.
3. **Replay de firma NO es exploitable por sí solo aquí**: timestamp+nonce caduca
   en segundos (replay → 400). Medirlo primero, no asumir single-use gato.

### 5 · La vía de cuenta ideal evita KYC (Google/email vs exchange) — no perder targets por la barrera de documento real

Muchos targets Eligible están tras login, así que el bloqueo real rara vez es
"dentro vs fuera de scope": es **conseguir una cuenta propia de test sin KYC**.
El recon del 2026-08-30 (crypto.com) lo dejó nítido:

| Target | Vía de cuenta | KYC | Resultado |
|---|---|---|---|
| `experiences.crypto.com` (tickets/travel) | **Login Google (IdP del realm)** / email | **NO** | 🥇 viable |
| `merchant.crypto.com` Pay | **Sign-up por email** (Devise: sign_up → activate → teams/create) | NO al alta | 🥈 viable |
| `*.mona.co` / apps (exchange) | Cuenta de intercambio | **Probable SÍ** | 🔴 bloqueado por KYC |
| Mobile app APIs (BFF) | Sesión de la app | **SÍ** | 🔴 descartada |

- **Por qué importa elegir la vía ANTES de empezar.** Elegir una cuenta de
  intercambio (exchange) cuando el target admitía login por **Google/email** es
  convertir un alta viable en uno bloqueado por `alta-bar-k1` (nunca KYC). La
  decisión de vía es parte del **recon**, no del alta: leer en el recon cuál es
  el IdP real del target (SSO/Google, email Devise, o cuenta exchange) y priorizar
  la que no exija documento.
- **Regla dura del stack (ya en `alta.js`).** La compuerta `altaDecision()`
  bloquea con `alta-bar-k1` si `exigeKYC`, y `alta-bar-k2` si `ipCaptured`. Si una
  versión del alta pide KYC, NO se fuerza ni se usa documentación real: se
  **margina el target** y se pasa al siguiente con vía sin KYC.
- **Señales pasivas para el recon vía elegida:** un login con
  "Continue with Google" o "registro por email" suele ser sin KYC (productos
  web/travel); una cuenta de intercambio/custodiada casi siempre exige KYC
  (verificar en el recon antes de elegirla como ruta).
- **Acción del OPPLAN/plan:** la fase `plan` debe fijar la **vía de cuenta** de
  cada target Eligible (email | SSO/Google | exchange) junto al tier, y marcar
  como `bloqueadoPorKYC` los que solo admitan exchange — sin invertir un ciclo
  activo en ellos. El alta concreta se verifica después con `type=alta`
  (`/api/gates/validate`), que valida la barrera de la vía elegida.

### 6 · Los enums GraphQL del bundle son strings de UI, NO el schema real — capturar con sesión, no fiarse del bundle

Caso real (crypto.com/nft marketplace, 2026-09-01): el bundle del SPA
(`main.2e5ddba1.js`) declara la mutación `CreateCheckout` con el enum
`CheckoutKind` y el SPA usa valores como `BUY_NOW`, `AUCTION`, `OFFER`, `DROP`.
Al reproducir la mutación contra el API real (`crypto.com/nft-api/graphql`):

```json
{"errors":[{"message":"Variable \"$kind\" got invalid value \"BUY_NOW\";
Value \"BUY_NOW\" does not exist in \"CheckoutKind\" enum.",
"extensions":{"code":"BAD_USER_INPUT"}}]}
```

- **Por qué pasa:** los bundles suelen llevar los **strings de UI/estado**
  (`BUY_NOW`, `FIXED_PRICE`…) y los **nombres de mutación** (que sí son reales),
  pero el **schema GraphQL vivo** no se puede inspeccionar si la introspection
  está deshabilitada (`__schema` → error explícito). El enum real del servidor
  puede ser distinto (p.ej. `BUY_NOW` no existe en `CheckoutKind`).
- **Regla:** el bundle es **heurística de nombres** (mutaciones, campos,
  fragmentos), no garantía de valores de enum. Los nombres de mutación y campos
  suelen ser fiables; los **valores de enum NO**.
- **Acción del harness:** antes de Fase 2 (mutaciones), **capturar el valor real
  con sesión** — reproducir un flujo legítimo del SPA y registrar qué `kind`/
  valores manda de verdad. Si no hay sesión, marcar el enum como `pendiente de
  confirmar` en el cfg y no inventar valores (inventar = `biz-g0`, y un 400 de
  enum no es un hallazgo: es validación correcta).
- **Matiz anti-falso-positivo:** un `400 BAD_USER_INPUT` por enum inválido NO es
  un bug — es el servidor validando bien. No reportarlo. Lo reportable sería que
  el servidor ACEPTARA un valor de enum fuera del contrato (validación rota).
- **Regla dura ya automatizada:** el filtro anti-rechazo `noReportables()` en
  `backend/lib/bizlogic.js` bloquea con **`nr-6`** si `errorValidacionEnum=true`
  y no hay `servidorAceptaFueraDeContrato=true`. Un 400 de enum sin aceptación
  fuera de contrato **no abre compuerta** — es exactamente el tipo de "respuesta
  rara" que no pasa. El harness NFT ya marca el caso en el cfg como lección.

### Lección transversal

El recon pasivo (CT logs + DNS + greps de bundles servidos) te dice **dónde NO
se puede** cazar antes de gastar el primer ciclo activo. Terminar un día sin
hallazgo reportable porque los targets eran `Not Eligible` o SPA-bloated es el
error evitable; identificarlo **antes** y saltar al candidato Eligible con guest
flow (o cuenta propia) es lo que le roba horas al triager.

## Playbook operativo (6 pasos, siempre en este orden)

1. **Mapear el flujo real** — Solo GET. Descubrir los endpoints del flujo
   (cart → line-items → confirm) desde bundles del SPA o tráfico propio.
   Nunca adivinar payloads (anti-fuzz).
2. **Baseline legítimo** — Ejecutar el flujo normal 1 vez y capturar la forma
   real (cuerpos, totales, ids). Guardar el raw HTTP de cálculo Y confirm.
   Confirmar el **endpoint real por tráfico vivo** (el bundle es heurística) y
   leer el **estado canónico** (MiniCart/cart) como fuente de verdad del efecto:
   un `201` de mutación con clamp N vale como aceptación hasta verlo reflejado.
3. **Identificar puntos de manipulación** — Buscar qué campos del cliente se
   confían: quantity, price, currency, status, plan, coupon, amount.
4. **Manipular entre cálculo y confirm** — Alterar UN solo campo a la vez.
   Comparar TOTAL_CALCULO vs TOTAL_CONFIRMA. Parar en la aceptación (nunca
   completar la transacción real).
5. **Reproducir y medir impacto** — Reproducir 2 veces. Impacto = dinero de la
   plataforma, dato de otra cuenta, o bypass de pago.
6. **Pasar la compuerta bizChain** — Nada se abre a triage sin la cadena completa.

## Clases de bugs (las que se pagan de verdad)

| id | Clase | Superficie típica | Impacto |
|---|---|---|---|
| `biz-precio` | Manipulación precio/cantidad entre cálculo y confirm | checkout, cart, line-items, orders | Comprar por menos/0 — el veredicto sale de los ítems totales del estado canónico (MiniCart), no del status HTTP del add |
| `biz-cupon` | Cupones reutilizables/acumulables | coupons, promo, referral, gift cards | Descuento infinito |
| `biz-reembolso` | Reembolsos que devuelven más de lo pagado | refunds, credits, adjustments | Doble refund, over-refund |
| `biz-reward` | Rewards canjeables sin decremento | rewards, loyalty, points, redeem | Canje múltiple |
| `biz-acceso` | Bypass de pago / free-entry | free-entry, trial, paywall, membership | Acceso sin pagar |
| `biz-transfer` | Saldos manipulables (negativos, decimales, doble gasto) | transfers, wallets, withdraw | Saldo negativo, doble gasto |
| `biz-race` | Race condition (TOCTOU) en operaciones single-use | redeem, claim, bonus | Doble aplicación |

### Helper de race conditions (`backend/lib/bizrace.js`)

Para la clase `biz-race`, la suite incluye un helper que abre una ronda acotada de N peticiones de una operación single-use, con aperturas espaciadas por el limitador global, y detecta doble-aplicación:

- `lanzarRonda(url, { metodo, cuerpo, n, authorization:true })` — N peticiones acotadas (clamp 1–5),
  exige autorización explícita, respeta `inScope` y el limitador global; las aperturas se separan para evitar ráfagas.
- `analizarRonda(ronda)` — compara las respuestas: >1 éxito con recursos
  DISTINTOS = posible doble-aplicación; mismo recurso = idempotente/dedup.
- `probarRace(url, opts)` — ronda + análisis en un paso.
- Endpoint API: `POST /api/biz/race { url, metodo, cuerpo, n, manualConfirm:true }` — exige
  confirmación humana y logea un finding `BIZ-RACE` si detecta posible race.

Verificado: doble-aplicación → `probableRace:true`; idempotente → `false`.
| `biz-registro` | Bonus de invitación / auto-referencia | invite, referral, signup | Bonus en bucle |

`claseParaSuperficie(superficie)` elige la clase según el nombre del endpoint
(checkout → biz-precio, coupon → biz-cupon, ...) para guiar al agente.

**Clases nuevas (de casos reales del ecosistema):** `biz-moneda` (currency confusion),
`biz-envio` (shipping/tax/impuesto cliente-controlado) y `biz-idflujo` (IDs transaccionales
confiados del cliente / order_initiation_id). Elecciones guía y vectores documentados en
**`docs/casos-reales-logica-negocio.md`** junto con el **filtro anti-rechazo** (`NO_REPORTABLES`)
que integra la compuerta `biz` para bloquear candidatos de "datos propios / cálculo sin dinero
y auth".

## Compuerta bizChain (8 gates)

| gate | Exige |
|---|---|
| `biz-g0` | Flujo real mapeado (no adivinado) |
| `biz-g1` | Baseline legítimo capturado (raw HTTP) |
| `biz-g2` | Campo manipulado es del CLIENTE (confiado) |
| `biz-g3` | El servidor ACEPTÓ el valor alterado (diferencia demostrada) |
| `biz-g4` | Impacto financiero o de acceso demostrado |
| `biz-g5` | Sin completar transacción real ni tocar fondos ajenos |
| `biz-g6` | Reproducible (2ª vez) |
| `biz-g7` | Dentro del scope y política lo permite |

Si falla cualquier gate → `sendable:false` → el reporte no se abre a triage.

## Uso

```bash
# En la UI: pestaña Compuertas → 🧮 Lógica de negocio → rellenar los 8 campos
# La ronda solo debe usarse con cuenta propia, recurso sintético y autorización explícita.
# Race conditions (clase biz-race):
curl -X POST http://127.0.0.1:8086/api/biz/race \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://target/redeem","metodo":"POST","cuerpo":{"rewardId":"x"},"n":3,"manualConfirm":true}'
# API:
curl -X POST http://127.0.0.1:8086/api/gates/validate \
  -H 'Content-Type: application/json' \
  -d '{"type":"biz","flujoMapeado":true,"baseline":true,"campoConfiado":true,"servidorAcepta":true,"impacto":true,"sinTransaccionReal":true,"reproducible":true,"inScope":true}'

# En el pipeline: fase EXPLOIT devuelve la metodología (playbook + clases)
curl -X POST http://127.0.0.1:8086/api/pipeline/run -H 'Content-Type: application/json' \
  -d '{"phase":"exploit"}'
```

## Guardrail del LLM (borradores con cadena de evidencia)

El endpoint `POST /api/reports/draft-llm` redacta el borrador con el LLM aplicando
el guardrail por tipo: si `bugType` es de lógica de negocio (`esLogicaNegocio()`),
injecta `GUARDRAIL_BORRADOR` (bizlogic) como system prompt.

Reglas que impone al borrador:

1. Incluir SIEMPRE la sección **Cadena de evidencia (bizChain)** con los 8 gates marcados `[x]`/`[ ]` según el contexto real.
2. Si `biz-g3` (servidor aceptó) o `biz-g4` (impacto) están en `[ ]` → **no redacta el reporte completo**: devuelve solo qué falta capturar.
3. Prohibido inventar totales, ids, respuestas HTTP o screenshots — lo desconocido va marcado PENDIENTE.
4. Si no hay impacto demostrable, el borrador lo dice explícitamente ("NO es reportable sin impacto") y no infla secciones.

```bash
curl -X POST http://127.0.0.1:8086/api/reports/draft-llm -H 'Content-Type: application/json' \
  -d '{"bugType":"Manipulacion de precio en checkout","contexto":"asset: experiences.crypto.com ... evidencia capturada"}'
```

Así el borrador nace con la evidencia que la compuerta exige (no después), y el LLM
no genera reportes de "sondeo sin impacto" — el patrón que más rechaza el triage.
