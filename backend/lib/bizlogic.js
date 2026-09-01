'use strict';

// ============================================================================
// KNK SUITE v2.1 — Análisis de lógica de negocio
// Metodología basada en writeups públicos de bug bounty (patrones recurrentes:
// manipulación de precios, race conditions, saltos de flujo, cupones, tiers,
// estado de objetos, uploads). Los bugs de lógica son invisibles a los
// escáneres: esta es la fase 100% manual que sustituye a la automatización.
// ============================================================================

// Cada categoría indica cuántas cuentas necesita: 'none' | 'one' | 'two'
const CATEGORIES = [
  {
    id: 'price',
    name: 'Manipulación de precio/valor',
    accounts: 'one',
    why: 'Validan amount>0 pero no currency, o confían en floats del cliente.',
    tests: [
      { id: 'price-neg', title: 'Cantidad/precio negativo', steps: ['Interceptar add-to-cart/update', 'Poner quantity: -1 o -100', '¿El total baja o te dan crédito?'] },
      { id: 'price-decimal', title: 'Cantidad decimal (fracción)', steps: ['Interceptar carrito', 'Poner skuQty: 0.02 o FoodNum: 0.01', '¿Paga 2% pero recibe el item completo?'] },
      { id: 'price-drop', title: 'Eliminar campo requerido', steps: ['Identificar campo que activa pago (ej. prizeIdList)', 'Eliminar el campo por completo del request', '¿El servidor cae a free?'] },
      { id: 'price-overflow', title: 'Integer overflow / precisión', steps: ['Poner quantity: 2147483648 (INT_MAX+1)', 'Poner price con >15 dígitos (float→0)', '⚠️ Coordinar: puede tumbar el servicio de pago'] },
      { id: 'price-rounding', title: 'Redondeo a favor', steps: ['Depositar 0.019 en moneda X', '¿La pasarela cobra 0.01 y la wallet acredita 0.02?', 'Repetir para crecimiento de saldo'] },
      { id: 'price-stack', title: 'Stacking de promos', steps: ['Combinar FREE50 + REFER10 + puntos', '¿Descuento total >100% o saldo negativo?'] },
    ],
  },
  {
    id: 'race',
    name: 'Race conditions',
    accounts: 'one',
    why: 'Check y update no atómicos: dos requests paralelos pasan ambos el check.',
    tests: [
      { id: 'race-double', title: 'Double-spend / doble canje', steps: ['Capturar POST /use-coupon o /withdraw', 'Enviar 20 requests en paralelo (Burp group)', '¿Se aplica más de una vez?'] },
      { id: 'race-limit', title: 'Bypass de rate limit por carrera', steps: ['Capturar SMS/claim/OTP request', '30 conexiones paralelas contra el límite', '¿Se generan varios códigos/claims?'] },
      { id: 'race-vip', title: 'Descuento de primer mes multi-dispositivo', steps: ['Abrir página de pago en 3 dispositivos', 'Completar cada pago por separado', '¿Todos heredan el descuento y se acumula duración?'] },
      { id: 'race-register', title: 'Race en registro/verificación', steps: ['Registrar mismo email en paralelo', 'Reusar mismo token de reset dos veces', '¿Se crean dos cuentas o se verifica dos emails?'] },
    ],
  },
  {
    id: 'workflow',
    name: 'Saltos de flujo / pasos',
    accounts: 'one',
    why: 'El servidor confía en que el cliente siguió los pasos anteriores.',
    tests: [
      { id: 'wf-skip', title: 'Saltar a confirmar sin pagar', steps: ['Mapear flujo: carrito→envío→pago→confirmar', 'Llamar POST /orders/confirm directamente', '¿Acepta payment_status: paid enviado por cliente?'] },
      { id: 'wf-verify', title: 'Bypass de verificación multi-paso', steps: ['Reset de contraseña: email→token→nueva pass', 'Ir al paso final sin token válido', '¿Lo acepta o reutiliza token antiguo?'] },
      { id: 'wf-2fa', title: 'Bypass de 2FA', steps: ['Login OK con usuario+pass', 'Ir directo a /dashboard antes de meter el código 2FA', '¿La sesión ya es full-auth?'] },
      { id: 'wf-path', title: 'Truncado de ruta en filtros', steps: ['Endpoints protegidos: /admin/**', 'Probar /;/admin/... y /../admin/...', '¿El filtro ve otra ruta y el dispatcher la enruta?'] },
    ],
  },
  {
    id: 'coupon',
    name: 'Cupones y referidos',
    accounts: 'two',
    why: 'Bucles de referidos y stacking requieren al menos 2 cuentas (propias).',
    tests: [
      { id: 'cpn-stack', title: 'Cupones apilables', steps: ['Aplicar SAVE20 + otro código', 'Quitar item, mantener descuento, añadir otro item', '¿Stack >100% o descuento en items nuevos?'] },
      { id: 'cpn-referral', title: 'Bucle de referidos', steps: ['Cuenta A crea código', 'Cuenta B usa el código de A → ambas reciben crédito', 'Cuenta C usa el de B... ¿crédito infinito?'] },
      { id: 'cpn-fixed', title: 'Cupón fijo en item barato', steps: ['Cupón -5$ en item de 3$', '¿Saldo negativo/crédito para el usuario?'] },
    ],
  },
  {
    id: 'auth',
    name: 'Cuenta y privilegios',
    accounts: 'two',
    why: 'IDOR horizontal y cookie swap necesitan identidades A y B propias.',
    tests: [
      { id: 'auth-email', title: 'Bypass de verificación de email', steps: ['Registrar con email A (verificado)', 'Cambiar a email B sin verificar', '¿El cambio exige re-verificación? ¿Puedes reclamar cuenta ajena?'] },
      { id: 'auth-reset', title: 'Token de reset predecible', steps: ['Pedir reset → analizar token', '¿Patrón md5(user)/rand()/timestamp?', '¿Token reutilizable tras cambio de email?'] },
      { id: 'auth-oauth', title: 'Account linking abusivo', steps: ['Cuenta A con email de la víctima (sin password)', 'Linkear OAuth propio a A', '¿La víctima al loguear con OAuth cae en TU cuenta?'] },
      { id: 'auth-cookie', title: 'Cookie swap (IDOR vertical/horizontal)', steps: ['Login admin → capturar cookie', 'Login user normal → misma request', 'Replay user request con cookie admin → ¿datos admin?'] },
      { id: 'auth-idor', title: 'IDOR horizontal en API', steps: ['Endpoint con userId/orderId parametrizable', 'Reemplazar por ID de la cuenta B propia', '¿Datos privados de B? (baseline: B lee los suyos 200)'] },
    ],
  },
  {
    id: 'api',
    name: 'Estado de objetos (API)',
    accounts: 'one',
    why: 'Campos de estado mutables por el cliente.',
    tests: [
      { id: 'api-status', title: 'Manipular status de objeto', steps: ['PUT /api/orders/123 {status: refunded}', '¿Auto-reembolso? ¿marcar shipped sin enviar?', 'Probar también cancel y completed'] },
      { id: 'api-tx', title: 'Reuso de transaction_id', steps: ['Iniciar pago → obtener transaction_id', 'Completar compra', 'Reusar el mismo id en otra compra'] },
      { id: 'api-limit', title: 'Bypass de límites por estados', steps: ['Transferir 999$ de un límite de 1000$', 'Cancelar y transferir otros 999$', '¿El límite no se actualiza al cancelar?'] },
    ],
  },
  {
    id: 'tier',
    name: 'Suscripción / tiers',
    accounts: 'one',
    why: 'El servidor valida tier en UI pero no en API/media.',
    tests: [
      { id: 'tier-downgrade', title: 'Downgrade conserva privilegios', steps: ['Activar prueba premium → feature X', 'Degradar a free', '¿X sigue disponible?'] },
      { id: 'tier-js', title: 'Endpoints premium desde JS', steps: ['Descargar JS bundle del cliente', 'Listar endpoints premium', 'Llamarlos con token free → ¿200?'] },
      { id: 'tier-media', title: 'Fuga de URL de medios VIP', steps: ['En responses de detalle buscar: .m3u8 .mp4 .mp3 videoUrl previewPullUrl', 'Reproducir la URL anónimamente (curl/VLC)', '¿Reproduce sin sesión?'] },
      { id: 'tier-id', title: 'Reemplazo de ID free→paid', steps: ['Detalle de curso free devuelve {id}', 'Reemplazar por ID de curso de pago', '¿Devuelve URL reproducible sin permiso?'] },
    ],
  },
  {
    id: 'upload',
    name: 'Lógica de uploads',
    accounts: 'one',
    why: 'La validación está en el cliente o no valida contenido.',
    tests: [
      { id: 'up-bomb', title: 'Zip bomb / descompresión', steps: ['Subir 1KB zip → 1GB al descomprimir', '¿DoS del servidor? ⚠️ Coordinar con cuidado'] },
      { id: 'up-csv', title: 'Inyección CSV/Excel', steps: ['Importar CSV con =SYSTEM("calc")', '¿Fórmula viva al abrir en Excel?'] },
      { id: 'up-path', title: 'Ruta de almacenamiento predecible', steps: ['Ruta /uploads/USER_ID/filename', 'Conocer ID de otra cuenta (B) + nombre', '¿Sobreescribes archivo de B? (2 cuentas)'] },
    ],
  },
];

// Las 8 preguntas universales de la metodología
const UNIVERSAL_QUESTIONS = [
  '¿Qué pasa si salto el paso N del flujo?',
  '¿Qué pasa si envío valores negativos, cero o MAX?',
  '¿Qué pasa si repito este paso dos veces? (idempotencia)',
  '¿Qué pasa si hago A→B en vez de B→A?',
  '¿Qué pasa si dos usuarios hacen esto simultáneamente?',
  '¿Puedo modificar campos de estado "de confianza"?',
  '¿Qué pasa si elimino un campo del request en vez de ponerlo vacío?',
  '¿Qué pasa si envío un array (campo[0], campo[1]) en vez de un scalar?',
];

/**
 * Genera el plan de pruebas de lógica de negocio para un programa.
 * @param {{scope:string[], target:string}} program
 * @returns {{categories:Array, noAccountTests:number, oneAccountTests:number, twoAccountTests:number, universal:Array}}
 */
function planTests(program) {
  const cats = CATEGORIES.map(c => ({
    ...c,
    needsTwoAccounts: c.accounts === 'two',
    tests: c.tests.map(t => ({ ...t, category: c.name })),
  }));
  return {
    target: program?.target || '',
    scope: program?.scope || [],
    categories: cats,
    counts: {
      noAccount: cats.filter(c => c.accounts === 'none').reduce((n, c) => n + c.tests.length, 0),
      oneAccount: cats.filter(c => c.accounts === 'one').reduce((n, c) => n + c.tests.length, 0),
      twoAccounts: cats.filter(c => c.accounts === 'two').reduce((n, c) => n + c.tests.length, 0),
    },
    universal: UNIVERSAL_QUESTIONS,
  };
}

/**
 * Compuerta para validar un candidato de lógica de negocio antes de reportar.
 * Misma filosofía que gates.js: todas las condiciones deben cumplirse.
 */
function bizlogicChain(i) {
  const checks = [
    { id: 'biz-1', label: 'Asset dentro del scope exacto', ok: i.inScope === true },
    { id: 'biz-2', label: 'Impacto financiero/datos REAL demostrado', ok: i.impactReal === true },
    { id: 'biz-3', label: 'Reproducible ≥2 veces (mismo resultado)', ok: (i.reproducibleCount || 0) >= 2 },
    { id: 'biz-4', label: 'Solo cuentas de prueba propias (sin datos de terceros)', ok: i.testAccountsOnly === true },
    { id: 'biz-5', label: 'No es duplicado conocido (buscado en Hacktivity)', ok: i.noDuplicate === true },
    { id: 'biz-6', label: 'No es disqualifier del programa', ok: i.notDisqualifier === true },
    { id: 'biz-7', label: 'El servidor (no el cliente) es la causa', ok: i.serverSide === true },
  ];
  const sendable = checks.every(c => c.ok);
  return {
    sendable,
    summary: sendable ? '✅ CADENA DE LÓGICA DE NEGOCIO COMPLETA' : `⛔ INCOMPLETA: ${checks.filter(c => !c.ok).map(c => c.id).join(', ')}`,
    results: checks.map(c => ({ ...c, detail: c.ok ? 'OK' : 'PENDIENTE' })),
  };
}

function renderPlan(plan) {
  const lines = [`# Plan de lógica de negocio — ${plan.target || '(sin target)'}`];
  for (const c of plan.categories) {
    lines.push(`\n## ${c.name} [${c.accounts === 'two' ? '2 cuentas' : c.accounts === 'one' ? '1 cuenta' : 'sin cuenta'}]`);
    lines.push(`> ${c.why}`);
    for (const t of c.tests) lines.push(`- [ ] ${t.title}: ${t.steps.join(' → ')}`);
  }
  lines.push('\n## Preguntas universales');
  plan.universal.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  return lines.join('\n');
}

module.exports = { CATEGORIES, planTests, bizlogicChain, renderPlan, UNIVERSAL_QUESTIONS };
