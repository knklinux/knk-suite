'use strict';

// ============================================================================
// KNK SUITE v2 — METODOLOGÍA DE LÓGICA DE NEGOCIO
// ----------------------------------------------------------------------------
// La lógica de negocio es la clase que mejor paga en bug bounty (y la que más
// rechazos genera cuando se reporta sin cadena de impacto). Esta metodología
// convierte "probar cosas raras" en un proceso con clases, playbook por clase
// y una compuerta de evidencia (bizChain) que exige impacto demostrable antes
// de abrir un reporte.
//
// Regla de oro (la que nos costó dos reports en YesWeHack):
//   Un sondeo sin impacto en OTRA cuenta / en la PLATAFORMA no es un bug.
//   "El servidor aceptó el monto alterado" es un hallazgo; "el endpoint
//   responde 200 sin sesión" no lo es.
// ============================================================================

// ── Clases de bugs de lógica de negocio ─────────────────────────────────────
// Cada clase: id, nombre, dónde vive, qué se rompe, y la técnica mínima.
// Estas son las que se pagan de verdad (alineadas con writeups de Logical
// Breach/Kea y con lo que ya mapeamos en crypto.com).
const CLASES = [
  {
    id: 'biz-precio',
    nombre: 'Manipulación de precio/cantidad entre cálculo y confirmación',
    superficie: 'checkout, cart, line-items, orders, subscriptions',
    impacto: 'Comprar por menos/0, o cobrar al usuario un importe distinto del acordado.',
    tecnica: 'Confirmar por TRÁFICO VIVO el endpoint real de mutación (el bundle es solo heurística; p.ej. el add de carrito de Newegg es Add2CartV2, no InitCartApi). Capturar TOTAL_CALCULO (line-items/cart) → manipular quantity/price en el confirm → leer el ESTADO CANÓNICO (MiniCart/cart GET) para ver si el cambio se refleja. Si el servidor acepta el total alterado y se refleja en el estado canónico, hay hallazgo.',
    clave: 'El veredicto lo da el estado canónico (MiniCart), no el status HTTP del add: un 201 con clamp server-side no cuenta como aceptación (biz-g3). El servidor debe aceptar el total manipulado Y reflejarlo, sin completar la compra real.',
  },
  {
    id: 'biz-cupon',
    nombre: 'Cupones/descuentos reutilizables o acumulables',
    superficie: 'discounts, coupons, promo, referral, gift cards',
    impacto: 'Descuento infinito, cupón de un solo uso aplicado N veces, o stacking de descuentos no previsto.',
    tecnica: 'Aplicar el mismo cupón 2+ veces en la misma orden o en órdenes sucesivas; probar stacking de cupones excluyentes; reutilizar código de referral propio.',
    clave: 'El cupón debe consumirse/reducirse de verdad (el saldo decrece) o el servidor debe rechazar la re-aplicación.',
  },
  {
    id: 'biz-reembolso',
    nombre: 'Reembolsos/ajustes que devuelven más de lo pagado',
    superficie: 'refunds, credits, adjustments, disputes, cashback',
    impacto: 'Devolución mayor que el importe original, o reembolso de una transacción ya reembolsada (doble refund).',
    tecnica: 'Reembolsar parcial → reembolsar de nuevo el total; reembolsar una transacción cancelada; verificar si el saldo se acredita sin comprobar el estado previo.',
    clave: 'El servidor debe acreditar saldo sin validar el estado previo de la transacción.',
  },
  {
    id: 'biz-reward',
    nombre: 'Rewards/puntos canjeables múltiples veces o sin decremento',
    superficie: 'rewards, loyalty, points, cashback, redeem',
    impacto: 'Canjear la misma reward 2+ veces, o saldo de puntos que no decrece.',
    tecnica: 'Canjear una reward de test propia 2 veces seguidas y comparar saldo; verificar si el decremento ocurre ANTES del canje o después de una respuesta que el cliente puede abortar.',
    clave: 'Solo con reward de test propia, sin consumir valor real.',
  },
  {
    id: 'biz-acceso',
    nombre: 'Bypass de pago / free-entry / salto de gates de suscripción',
    superficie: 'free-entry, trial, status, upgrade, paywall, membership',
    impacto: 'Acceder a contenido/features de pago sin pagar, o saltarse el gate de suscripción.',
    tecnica: 'Manipular el estado (status/plan) entre el gate y el acceso; probar si el servidor valida el pago en cada acceso o solo una vez; cambiar el plan tras el trial sin re-validar.',
    clave: 'El PoC debe probar el BYPASS del gate de pago de forma reproducible, no solo "cambié mi status y entré".',
  },
  {
    id: 'biz-transfer',
    nombre: 'Transferencias/saldos manipulables (negativos, decimales, doble gasto)',
    superficie: 'transfers, wallets, balances, payments, withdraw',
    impacto: 'Saldo negativo, transferir más de lo disponible, doble gasto, o decimales que redondean a favor del atacante.',
    tecnica: 'Enviar montos negativos/cero/de alta precisión; transferir entre cuentas propias A↔B y verificar el saldo tras la operación; probar race (doble petición simultánea).',
    clave: 'Impacto en el saldo de la PLATAFORMA o de OTRA cuenta, no solo en la propia.',
  },
  {
    id: 'biz-race',
    nombre: 'Race condition (TOCTOU) en operaciones de una sola vez',
    superficie: 'redeem, transfer, withdraw, coupon, signup bonus, invite',
    impacto: 'Doble aplicación de una operación single-use detectada en una ronda autorizada y espaciada.',
    tecnica: 'Abrir una ronda acotada y espaciada por el limitador global para la misma operación single-use (redeem/claim/bonus) y verificar si se aplica más de una vez.',
    clave: 'Requiere una ronda autorizada y evidencia de aplicación múltiple; no se permiten ráfagas ni recursos ajenos.',
  },
  {
    id: 'biz-registro',
    nombre: 'Registro/bonus de invitación o auto-referencia',
    superficie: 'invite, referral, signup bonus, promo de registro',
    impacto: 'Generar bonus de referencia en bucle con cuentas propias, o auto-referirse.',
    tecnica: 'Crear cuenta B con el código de referencia de A y verificar si el bonus se acredita a A; repetir para ver si hay límite por IP/identidad.',
    clave: 'Verificar si la plataforma detecta misma identidad/IP; el hallazgo es la ausencia de ese control.',
  },
  // Casos reales del ecosistema (Medium/Intigriti/Bugcrowd) — ver docs/casos-reales-logica-negocio.md
  {
    id: 'biz-moneda',
    nombre: 'Currency confusion (cambio de moneda antes del gateway de pago)',
    superficie: 'checkout, place-order, payment, price',
    impacto: 'Pagar en una moneda de menor valor: el precio se calcula en una moneda y se cobra en otra (p.ej. mover currency_code USD→JPY sin revalidar).',
    tecnica: 'Interceptar el confirm/place-order y mutar currency/currencyCode a una moneda barata; comparar el importe efectivo del gateway. Sin completar compra real.',
    clave: 'El campo de dinero puede ser la UNIDAD (moneda), no el importe. No aparece si solo se mira price.',
  },
  {
    id: 'biz-envio',
    nombre: 'Shipping/tax/impuesto controlado por cliente (destino o exencion falsa)',
    superficie: 'checkout, place-order, cart, inventory',
    impacto: 'Reducir o eliminar el coste de envío/impuesto: un shippingCountry/tax/shippingMethod del cliente se usa para el cálculo sin revalidar (envío negativo, tax 0).',
    tecnica: 'En la llamada de confirmar, listar TODOS los campos de dinero (no solo price): country, region, shippingCountry, tax, taxExempt, isGift, shippingMethod. Mutar UNO y leer el desglose (subtotal+shipping+tax), no solo el total.',
    clave: 'Pagar menos/no pagar tax con reproducción 2x; parar en la aceptación del gateway, sin mover el item real.',
  },
  {
    id: 'biz-idflujo',
    nombre: 'IDs de flujo confiados del cliente (IDOR transaccional / order_initiation_id)',
    superficie: 'checkout, orders, order_id, order_initiation_id, cartId',
    impacto: 'Acceder o finalizar la orden de OTRO cliente: la confirmación recupera la orden desde un id del body sin verificar que pertenezca al usuario.',
    tecnica: 'En cada paso del flujo, listar los ids del request y reemplazar el del checkout por el de otra orden/carrito propio distinto; ver si el server valida propiedad.',
    clave: 'Es IDOR pero en la lógica (no en el endpoint aparente). Impacto = integridad/confidencialidad de orden ajena.',
  },
];

// ── Playbook de pasos comunes (la "metodología" operativa) ──────────────────
// Este es el orden que se sigue para CUALQUIER superficie de lógica de negocio.
const PLAYBOOK = [
  { paso: 1, nombre: 'Mapear el flujo real', detalle: 'Solo GET. Descubrir los endpoints del flujo (cart → line-items → confirm) desde bundles del SPA o tráfico propio. Nunca adivinar payloads (anti-fuzz).' },
  { paso: 2, nombre: 'Baseline legítimo', detalle: 'Ejecutar el flujo normal 1 vez y capturar la forma real (cuerpos, totales, ids). Guardar el raw HTTP de cálculo Y confirm. Confirmar el endpoint real por TRÁFICO VIVO (el bundle es heurística) y leer el ESTADO CANÓNICO (MiniCart/cart) como fuente de verdad del efecto: un 201 de mutación con clamp no vale como aceptación hasta verlo reflejado.' },
  { paso: 3, nombre: 'Identificar puntos de manipulación', detalle: 'Buscar qué campos del cliente se confían: quantity, price, currency, status, plan, coupon, amount. Cada campo confiado es un candidato.' },
  { paso: 4, nombre: 'Manipular entre cálculo y confirm', detalle: 'Alterar UN solo campo a la vez entre el cálculo y la confirmación. Comparar TOTAL_CALCULO vs TOTAL_CONFIRMA. Parar en la aceptación (no completar transacción real).' },
  { paso: 5, nombre: 'Reproducir y medir impacto', detalle: 'Reproducir 2 veces. Documentar el impacto: dinero/perdida de la plataforma, dato de otra cuenta, o bypass de pago.' },
  { paso: 6, nombre: 'Pasar la compuerta bizChain', detalle: 'Nada se abre a triage sin la cadena completa: impacto real + reproducible + en scope + sin tocar fondos ajenos.' },
];

// ── Compuerta de evidencia (bizChain) ───────────────────────────────────────
// Exige la cadena completa de impacto ANTES de abrir un reporte de lógica de
// negocio. Si falla cualquier gate, no se envía.
function bizChain(i) {
  const r = [];
  const g = (id, label, ok, detail, lesson) => r.push({ id, label, ok: ok === true, detail, lesson });

  g('biz-g0', 'Flujo mapeado con forma REAL (no adivinado)', i.flujoMapeado,
    i.flujoMapeado ? 'Flujo real descubierto (bundles/tráfico propio).' : 'Sin forma real: no se toca nada.',
    'Nunca adivinar payloads. Primero la forma real del flujo.');
  g('biz-g1', 'Baseline legítimo capturado (raw HTTP)', i.baseline,
    i.baseline ? 'Baseline normal capturado.' : 'Sin baseline.',
    'El raw HTTP de cálculo Y confirm es la evidencia base.');
  g('biz-g2', 'Campo manipulado es del CLIENTE (confiado)', i.campoConfiado,
    i.campoConfiado ? 'El servidor confía un campo del cliente.' : 'Sin campo confiado.',
    'Si el campo no viene del cliente, no hay manipulación posible.');
  g('biz-g3', 'El servidor ACEPTÓ el valor alterado (diferencia demostrada)', i.servidorAcepta,
    i.servidorAcepta ? 'El servidor aceptó el valor alterado (total/status/estado).' : 'El servidor rechazó o normalizó.',
    'La aceptación del valor alterado es el núcleo del hallazgo.');
  g('biz-g4', 'Impacto financiero o de acceso demostrado (no solo "responde raro")', i.impacto,
    i.impacto ? 'Impacto: dinero de la plataforma, dato ajeno, o bypass de pago.' : 'Sin impacto demostrable.',
    'Sin impacto en plataforma/otra cuenta NO es bug. Es lo que más rechaza el triage.');
  g('biz-g5', 'Sin completar transacción real ni tocar fondos ajenos', i.sinTransaccionReal,
    i.sinTransaccionReal ? 'Se paró en la aceptación; no se completó compra ni se tocó fondo ajeno.' : 'Se tocó una transacción real.',
    'Regla dura: nunca completar la compra real ni drenar fondos. Llegar a la aceptación y cortar.');
  g('biz-g6', 'Reproducible (2ª vez)', i.reproducible,
    i.reproducible ? 'Reproducido 2 veces.' : 'No reproducible.',
    'Un triager debe poder reproducirlo con los pasos del reporte.');
  g('biz-g7', 'Dentro del scope y política lo permite', i.inScope,
    i.inScope ? 'En scope y no es disqualifier.' : 'Fuera de scope o excluido.',
    'Leer la política: si el programa excluye testing de checkout, no se toca.');

  const sendable = r.every((x) => x.ok);
  return { sendable, summary: sendable ? '✅ CADENA LÓGICA DE NEGOCIO COMPLETA' : `⛔ INCOMPLETA: ${r.filter(x => !x.ok).map(x => x.id).join(', ')}`, results: r };
}

// ── Guardrail de generación de borradores por el LLM ────────────────────────
// Cuando el LLM redacta un borrador de lógica de negocio, este system prompt le
// obliga a incluir la cadena de evidencia (bizChain) como sección del reporte y
// le PROHÍBE generar un borrador si no hay impacto demostrado. Así el borrador
// nace con la evidencia que la compuerta exige, no después.
function esLogicaNegocio(t) {
  return /precio|checkout|line-item|coupon|cupon|descuento|reward|redeem|canje|free.entry|bypass.*pago|race|price.tamper|business.logic|logica.de.negocio/.test(String(t || '').toLowerCase());
}

const GUARDRAIL_BORRADOR = `Eres un redactor de reportes de bug bounty de lógica de negocio.
Reglas OBLIGATORIAS al redactar el borrador (incumplirlas invalida el reporte):

0. El borrador ABRE con una sección \"Estado y policy\" que defina el reporte antes del hallazgo, con estos campos marcados [x]/[ ]:
   - tier del asset es Eligible/reward (leído del scope, no de memoria)
   - estado/DNS del host verificado (¿resuelve? ¿roba o desvía a marketing/malware?)
   - el endpoint sirve el RECURSO real (no 5xx, no login-gated, no WAF 403)
   - no es software de monitoreo interno (Kibana/Sentry/Grafana) ni depende de adivinar rutas
   Si cualquiera de estos cae → el reporte NO debe redactarse como vuln: devolver solo qué falta verificar.

1. Todo borrador DEBE incluir una sección \"Cadena de evidencia (bizChain)\" con estos 8 puntos, marcados [x] o [ ] según el dato:
   - biz-g0 Flujo mapeado con forma REAL (no adivinado)
   - biz-g1 Baseline legítimo capturado (raw HTTP de cálculo Y confirm)
   - biz-g2 Campo manipulado es del CLIENTE (confiado)
   - biz-g3 El servidor ACEPTÓ el valor alterado (diferencia demostrada)
   - biz-g4 Impacto financiero o de acceso demostrado
   - biz-g5 Sin completar transacción real ni tocar fondos ajenos
   - biz-g6 Reproducible (2ª vez)
   - biz-g7 Dentro del scope y política lo permite

2. Si biz-g3 (servidor aceptó) o biz-g4 (impacto) están en [ ] — NO redactes un reporte completo. En su lugar devuelve SOLO la lista de lo que falta capturar para cerrarlos, sin inventar nada.

3. PROHIBIDO inventar datos que no vengan del contexto: totales, ids, respuestas HTTP, screenshots. Todo lo que no sepas va marcado como PENDIENTE.

4. Si no hay impacto demostrable (dinero de la plataforma, dato ajeno, o bypass de pago), el borrador debe decirlo explícitamente: \"este hallazgo NO es reportable sin impacto\" y no generar secciones de impacto infladas.

5. Formato del borrador: Resumen / Cadena de evidencia (bizChain) / Pasos de reproducción numerados / Request-Response raw / Impacto honesto / Remediation sugerida.`;

// ── Selección de clase según la superficie ──────────────────────────────────
// Ampliada con los casos reales estudiados (docs/casos-reales-logica-negocio.md):
// biz-envio, biz-moneda, biz-idflujo. El orden importa: checkouts con country/tax
// caen en biz-envio (sub-vector de precio); IDs transaccionales en biz-idflujo.
function claseParaSuperficie(superficie) {
  const s = String(superficie || '').toLowerCase();
  if (/(currency|currencyCode)/.test(s)) return 'biz-moneda';
  if (/(shipping|tax|country|region|taxExempt|gift)/.test(s)) return 'biz-envio';
  if (/(order_initiation|orderId|order_id|cartId|transaction)/.test(s)) return 'biz-idflujo';
  if (/(checkout|cart|line-item|order|subscription|payment|place-order)/.test(s)) return 'biz-precio';
  if (/(coupon|discount|promo|referral|gift)/.test(s)) return 'biz-cupon';
  if (/(refund|reembolso|adjustment|credit|cashback)/.test(s)) return 'biz-reembolso';
  if (/(reward|loyalty|points|redeem|cashback)/.test(s)) return 'biz-reward';
  if (/(free|trial|paywall|member|upgrade|status)/.test(s)) return 'biz-acceso';
  if (/(transfer|wallet|balance|withdraw)/.test(s)) return 'biz-transfer';
  if (/(invite|referral|signup|bonus)/.test(s)) return 'biz-registro';
  try {
    const j = JSON.parse(String(superficie || ''));
    const k = Object.keys(j).join(' ').toLowerCase();
    if (/(currency|tax|shipping|country|order_id)/.test(k)) return 'biz-envio';
  } catch { /* no JSON */ }
  return null;
}

// ── Filtro anti-rechazo (de Intigriti + regla de oro knk) ───────────────────
// Lista lo que NO es reportable aunque "responda raro". Se llama en EXPLOIT para
// bloquear el borrador si el candidato cae aquí; es la barrera que evita el 3er
// rechazo. Ver docs/casos-reales-logica-negocio.md → «Filtro anti-rechazo».
function noReportables(i) {
  const r = [];
  // ¿El dato afectado es solo del propio usuario y sin efecto en plataforma/otro?
  if (i.impacto && /^(propio|propia|self)$/i.test(i.impacto)) {
    r.push({ ok: false, id: 'nr-1', label: 'Impacto solo en tus datos', detalle: 'Modificar/cálculo sobre datos propios sin efecto en otra cuenta ni en la plataforma NO es bug (Intigriti).' });
  }
  // ¿El zod de la calculación no toca auth ni dinero?
  if (i.afectaDinero === false && i.afectaAuth === false) {
    r.push({ ok: false, id: 'nr-2', label: 'Cálculo sin dinero ni auth', detalle: 'Cálculo incorrecto que no afecta a autorización ni dinero = bug funcional, no reportable.' });
  }
  // ¿Quería reportar un CORS/ídem sin lectura ni exfil?
  if (i.soloHeader === true) {
    r.push({ ok: false, id: 'nr-3', label: 'Solo cabecera sin explotación', detalle: 'Header/ACAO sin crossOriginRead ni exfil no es reportable.' });
  }
  // Lección de campo (2026-08-30, mona/kibana + ACAO): dashboard/monitoring interno
  // detrás de WAF, o endpoint que sirve 5xx / login-gated, NO expone nada → no pasa.
  // Reflejar ACAO ≠ leer; leer ≠ exfiltrar; un 500 no tiene recurso y un login no lo sirve.
  if (i.tipoSuperficie && /(dashboard|kibana|sentry|grafana|monitor|metric|admin|internal)/i.test(i.tipoSuperficie)
      && i.accesoRealSinAuth !== true) {
    r.push({ ok: false, id: 'nr-4', label: 'Dashboard/monitoring interno sin acceso auth demostrado', detalle: 'Kibana/Sentry/Grafana/admin/internal sin acceso real sin suela WAF/auth no son superficie reportable.' });
  }
  if ((i.endpointStatus !== undefined && [500, 501, 502, 503, 504].includes(Number(i.endpointStatus)))
      || i.loginGated === true) {
    r.push({ ok: false, id: 'nr-5', label: 'Endpoint 5xx o login-gated', detalle: 'ACAO en 5xx o en página de sign-in no expone datos: reflejar ≠ leer, y no hay recurso que exfiltrar.' });
  }
  if (i.impactoSoloEn === 'mi-carrito') r.push({ ok: true, id: 'nr-0', label: 'Recordatorio', detalle: 'Ej. real: añadir items a tu carrito guest no pasa biz-g4 (sin impacto ajeno). Cerrar mirando el flag en otra cuenta.' });
  // Lección de campo (2026-09-01, crypto.com/nft): un 400 BAD_USER_INPUT por enum
  // inválido (p.ej. kind=BUY_NOW no existe en CheckoutKind) es VALIDACIÓN CORRECTA,
  // no un hallazgo. Los enums del bundle son strings de UI, no el schema real
  // (introspection off): inventar valores = biz-g0. Lo reportable sería el caso
  // inverso: que el servidor ACEPTARA un valor fuera del contrato.
  if (i.errorValidacionEnum === true && i.servidorAceptaFueraDeContrato !== true) {
    r.push({ ok: false, id: 'nr-6', label: '400 BAD_USER_INPUT por enum inválido (validación correcta)', detalle: 'El servidor rechazó un valor de enum fuera del contrato — eso es validar bien. Reportar SOLO si acepta valores fuera del schema (contrato roto). El enum real se captura con sesión, no del bundle.' });
  }
  return r;
}


module.exports = { CLASES, PLAYBOOK, bizChain, claseParaSuperficie, esLogicaNegocio, GUARDRAIL_BORRADOR, NO_REPORTABLES: noReportables };
