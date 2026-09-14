# Casos reales de Lógica de Negocio — guía para knk-suite

Estudio de writeups reales del ecosistema (Medium/Intigriti/Bugcrowd). Cada caso
aporta un **vector reutilizable** y un **filtro anti-rechazo**. No es teoría: son
hallazgos que pagaron bounty y que marcan dónde mirar cuando mapeamos un flujo.

> Regla transversal de los 82x: el impacto que paga es **dinero de plataforma,
> dato/orden de otra cuenta, o bypass de pago** con reproducción clara. Un cálculo
> "raro" en tus propios datos NO paga (ver filtro anti-rechazo al final).

---

## Caso A · Cantidad → envío negativo (e-commerce, cost manipulation)

- Fuente: Hangga Aji Sayekti (cybersecuritywriteups, 2026-06).
- Flujo: tienda con `<input type=number min/max>` (frontend limita 1..N). El cajero
  manda `quantity=9999999` por proxy. **El servidor lo acepta** y, al recalcular,
  el coste de **shipping sale negativo**: a mayor cantidad, menos total.
- Vector: `quantity` (u otro multiplicador de cálculo) controlado por cliente y usado
  en una fórmula de coste sin validar; el efecto lateral (impuesto/envío negativo)
  reduce el total pagado.
- Técnica knk-suite: clase **biz-precio** — probar cantidad `0/-n/grandes` y leer el
  **desglose** (subtotal + shipping + tax relínea a línea) buscando signos negativos,
  no solo el total.
- Clave del reporte: capturar el **antes/después** del breakdown, no solo el código
  HTTP (aquí el 201 viene igual, el bug está en el desglose).

## Caso B · `shippingCountry` cliente-controlado → sin envío ni impuesto (P3)

- Fuente: Zyad Ibrahim — `checkout.target.com/checkout-api/v2/order/place-order`.
- Flujo: el item no lleva precio manipulable; pero el body trae `shippingCountry` que
  se usaba para calcular shipping+tax. Cambiando `shippingCountry` a un país barato,
  el precio del envío bajaba al instante (PayPal) **y el impuesto desaparecía**,
  sin que el destino real del pedido cambiara. Triaged P3, bounty.
- Vector: parámetros de **destino/envío/impuesto** (country, region, shippingMethod,
  taxExempt, `isGift`) que alimentan el cálculo y viajan del cliente sin revalidar.
- Técnica knk-suite: al mapear el `place-order`/`confirm`, listar TODOS los campos del
  body; los candidatos de dinero no son solo `price` — son **country, tax, shipping,
  currency, coupons, gift wrap, discounts**.
- Clave: el impacto es **pagar menos/no pagar tax**, reproducible 2 veces, y NO se
  completa el envío real (se para en la aceptación/confirm del gateway).

## Caso C · Currency confusion (USD→JPY) en el `place-order` (Intigriti)

- Fuente: Intigriti — "Exploiting business logic error vulnerabilities".
- Flujo: `currency_code` se lee del cliente en el checkout y se **reenvía sin validar**
  al gateway de pago. Cambiar `USD`→`JPY` baja el importe cobrado (moneda confusa);
  el precio se calcula en una moneda y se paga en otra.
- Vector: campos de **moneda** del cliente que el backend no recalcula/valida antes
  del pago.
- Técnica knk-suite: clase **biz-moneda** — al interceptar el place-order, mutar
  `currency`/`currency-code` y comparar el importe efectivo del gateway.
- Clave: mismo patrón de "campo de dinero confiado del cliente", pero el campo es la
  **unidad** (moneda) y no el **importe** — no pasa por el radar de quien solo mira
  `price`.

## Caso D · `order_initiation_id` sin validación → IDOR en checkout (Intigriti)

- Fuente: Intigriti — broken access control vía lacked validation del flag de fuera.
- Flujo: la confirmación de checkout recupera la orden desde un `order_id`/`order_initiation_id`
  **que viaja en el body** y no se comprueba que pertenezca al cliente y sea real.
  Cambiarlo por el id de otra orden → finalizar/ver datos de la orden ajena.
- Vector: **IDs de dominio confiados del cliente** en flujos transaccionales
  (order_id, cartId, productId, sessionId, transaction_id). Es IDOR pero en la
  "lógica" (no en el endpoint REST aparente).
- Técnica knk-suite: clase **biz-acceso/IDOR en flujo** — en cada paso del flujo,
  listar los ids del request y probar el de OTRA orden/carrito propio distinto.
- Clave: el impacto es **integridad/confidencialidad de orden ajena**, no dinero.

## Caso E · Secondary sink de validación → SSTI/SQLi/XSS (Intigriti)

- Flujo: el signup valida bien el email (rechaza payloads), pero el **portal de
  preferencias de email** (otra ruta) acepta el input sin validar y lo sincroniza al
  backend → SSTI/XSS/SQLi. Validación inconsistente entre entradas del mismo dato.
- Vector: **validación inconsistente**: el mismo cambio de datos se puede hacer por una
  segunda vía menos protegida (update-profile vs invite vs unsubscribe).
- Técnica knk-suite:CUANDO una compuerta (XSS/SQLi/SSTI) haya fallado vía el camino
  principal, probar el **mismo campo por la segunda vía** (update, import, sync).
- Clave: la "misma" mitigación no siempre se repite en todos los sinks. Es el patrón
  de retest que también usó Kea (path traversal con doble encoding: el perimeter
  cambió, la app no).

## Caso F · JWT `none` algorithm → bypass de auth (Intigriti)

- Flujo: endpoint autenticado acepta un JWT sin firmar (alg `none`) porque el server
  no lo maneja → bypass total de autenticación.
- Vector: **crypto → auth bypass**. Al mapear una API autenticada sin más pista, probar
  JWT del `account` con `alg:none` y token firmado vacío.
- Técnica knk-suite: clase **biz-sesion/crypto** — para endpoints que piden token,
  probar `alg:none`, firma vacía y reutilización de token viejo/cross-tenant.

---

## Filtro anti-rechazo (de los casos reales a la compuerta)

Intigriti (mismo artículo) da la lista de lo que **NO** es reportable — es el filtro a
aplicar EXPLICITO antes de abrir reporte:

**No explotable (no abrir):**
1. Modificar datos que son solo tuyos aunque el frontend lo impida (uso de proxy ≠ bug
   si no hay efecto en otra cuenta/plataforma). ← OJO: esto descarta mucho de lo que
   intentamos con el carrito guest de Newegg.
2. Cálculos incorrectos que no afectan a auth ni a dinero (calorías, scoring propio).
3. Problemas de rendimiento/DoS client-side con datos propios.

**Sí es bug**, preguntando siempre *¿en qué afecta a otro?*:
- Integridad → alteras datos protegidos (orden ajena, tenant ajeno).
- Confidencialidad → ves orden/dato ajeno (IDOR del checkout).
- Disponibilidad → rompes/dosificas algo de la plataforma.
- Financiero → pagas menos/no pagas/duplicas cobro o reembolso.

Este filtro se debe pasar en el paso `plan`/ `exploit` y CUALQUIER candidato que caiga
en la lista "no explotable" se descarta aunque responda "raro". Refuerza `bizChain`:
`biz-g4` (impacto plataforma/otra cuenta) es el gate que separa bounty de rechazo.

## Cómo usar esto en la suite

- La tabla de clases de `bizlogic.js` se ha ampliado con `biz-moneda`, `biz-envio` y
  `biz-idflujo` (ver abajo). La clase es seleccionada por `claseParaSuperficie()`.
- El `GUARDRAIL_BORRADOR` ya exige `biz-g4`; añadir el Filtro anti-rechazo como
  comprobación previa no genera reporte si el impacto es solo "propio".
- Referencia rápida del vector, por tipo de campo confiado:
  | Campo confiado del cliente | Mirar | Clase |
  |---|---|---|
  | `price`, `amount`, `total` | sobrewrite del importe | biz-precio |
  | `quantity`, `qty`, multiplicador | desglose negativo/overflow | biz-precio |
  | `shippingCountry`, `region`, `tax`, `shippingMethod` | envío/impuesto 0 o negativo | biz-envio |
  | `currency`, `currencyCode` | cambio de moneda en el gateway | biz-moneda |
  | `order_id`, `order_initiation_id`, `cartId` | orden ajena | biz-idflujo |
  | `coupon`, `promo`, `giftWrapping`, `discount` | reuso/acumulación | biz-cupon |
  | `status`, `plan`, `trialEndsAt` | bypass de pago/paywall | biz-acceso |
  | `amount`, `to`, `from` en transfer/withdraw | saldo ajeno, negativos, race | biz-transfer |