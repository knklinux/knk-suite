'use strict';

// ============================================================================
// KNK SUITE v2 — CHECKLIST DEL ALTA DE CUENTA DE TEST (+ decisión por barrera)
// ----------------------------------------------------------------------------
// Objetivo: que obtener una cuenta/partner de test en un target Eligible sea un
// proceso con checklist reproducible y la decisión por barrera AUTOMATIZADA:
//   · Si el alta exige KYC/documento real   → bloquear (nunca KYC).
//   · Si es/IP da run-rate limit de CF      → pausar (IP-cap), no forzar.
//   · Si falta email de test controlado     → bloquear (no usar correo real).
//   · Si el flujo exige evadir controles    → bloquear.
// Es la Fase "cuenta/partner" del engagement red team (ver docs/bugbounty/
// PLAN-ALTAS-ELEGIBLE-2026-08-30.md y docs/crypto-com-recon/ALTA-*.md).
// La regla de oro sigue siendo la del stack: ni KYC real, ni forzar contra
// Cloudflare, ni cuentas de terceros, ni datos personales.
// ============================================================================

function item(id, label, ok, detail, lesson) {
  return { id, label, ok: ok === true, detail, lesson };
}

// Fases del alta. Los gates alt-gN recorren el ciclo completo: email de test →
// login → confirmar cuenta; y cada vía (email | Google/SSO | exchange) tiene su
// propio conjunto de gates en vía*.
const FASES = [
  { id: 'fase-alta', nombre: 'Preparación de identidad de test (sin KYC)', resume: ['email', 'login', 'confirmar'] },
];

// Decisión automatizada por barrera. Se llama con el estado levantado en el
// campo (mismo divisor que usamos para gates KYC/IP-cap en las ALTA-*.md).
function decision(input) {
  const r = [];
  const flag = (k) => input[k] === true || String(input[k] || '').toLowerCase() === 'true';

  // Regla dura: nunca KYC (documento/identidad real).
  if (flag('exigeKYC')) {
    r.push(item('alta-bar-k1', 'Nunca se hace KYC', false,
      'El alta exige KYC/documento real → NO se hace.', 'Marginar target y pasar al siguiente; regla del stack.'));
  } else {
    r.push(item('alta-bar-k1', 'Sin KYC en el alta', true, 'Alta sin KYC (web/travel o email principal).'));
  }

  // Regla dura: no forzar cuando Cloudflare limita la IP.
  if (flag('ipCaptured')) {
    r.push(item('alta-bar-k2', 'No forzar contra IP-cap', false,
      'Cloudflare limita la IP al registrar → pausar (min horas), no reintentar en bucle.', 'Esperar; usar otra red; documentar estado.'));
  } else {
    r.push(item('alta-bar-k2', 'Sin IP-cap', true, 'Sin limitación de IP en el registro.'));
  }

  // Email de test controlado (nunca correo personal real).
  if (flag('emailTest') || (input.emailTest && /@/i.test(String(input.emailTest))) ) {
    r.push(item('alta-bar-k3', 'Email de test controlado', true, `Email de test: ${input.emailTest || 'proporcionado'} (controlado, sin datos personales).`));
  } else {
    r.push(item('alta-bar-k3', 'Email de test controlado', false, 'Falta un email de test que se reciba y controles. Es el único insumo externo que bloquea.', 'No usar correo personal real.'));
  }

  // No evadir controles (WAF/CAPTCHA) ni tocar cuentas ajenas.
  if (flag('evadirControles')) {
    r.push(item('alta-bar-k4', 'Sin evasión de controles', false, 'El alta exige evadir WAF/CAPTCHA o usar cuenta/identidad ajena → no hacer.', 'Regla del stack: nada fuera de política.'));
  } else {
    r.push(item('alta-bar-k4', 'Sin evasión de controles', true, 'Alta por la vía legítima (formulario/IdP), sin bypassear controles.'));
  }

  const sendable = r.every((x) => x.ok);
  return { sendable, summary: sendable ? '✅ ALTA VIABLE (sin barrera dura)' : `⛔ BLOQUEADO por barrera: ${r.filter(x => !x.ok).map(x => x.id).join(', ')}`, results: r };
}

// ── Compuerta altaChain ──
// Une la decisión por barrera + el checklist del ciclo completo del alta.
// Devuelve { sendable, summary, results } compatible con verdictToText().
function altaChain(i) {
  const r = [];
  const g = (id, label, ok, detail, lesson) => r.push({ id, label, ok: ok === true, detail, lesson });

  // 1) Barreras (si alguna cae, el alta NO puede continuar y decide por sí sola).
  const bar = decision(i);
  for (const b of bar.results) r.push(b);

  if (!bar.sendable) {
    // Si hay barrera dura, los gates de ciclo quedan pendientes de verificación
    // (no se inventan): la decisión es BLOQUEAR y pasar a otro target.
    return { sendable: false, summary: bar.summary, results: r };
  }

  // 2) Email de test listo y controlado.
  g('alta-g1', 'Email de test listo (controlado, sin datos personales)', !!i.emailTest,
    i.emailTest ? `Email: ${i.emailTest}` : 'Falta el email de test controlado.',
    'Nada de correo personal real; debe poder leerse el correo de confirmación.');

  // 3) Login con la cuenta de test.
  g('alta-g2', 'Login con la cuenta de test completado', i.loginOk === true,
    i.loginOk ? 'Sesión iniciada con la cuenta de test.' : 'Login no completado aún.',
    'Login por la vía real del programa (email Devise, Google/SSO, o cuenta de intercambio).');

  // 4) Confirmación de que la cuenta queda operativa: el endpoint de perfil/account
  //    devuelve 200 con datos propios. (Es el gate de éxito de la Fase 1.)
  g('alta-g3', 'Cuenta confirmada (endpoint /account devuelve 200 con datos propios)', i.account200 === true,
    i.account200 ? 'GET /account → 200 con datos propios.' : 'Sin 200 autenticado en /account (aún).',
    'Sin poder leer su propio estado, la cuenta no sirve para cerrar gates biz.');

  // 5) Dos cuentas propias A/B disponibles (para biz-idflujo / IDOR).
  g('alta-g4', 'Dos cuentas propias A/B disponibles', i.dosCuentas === true,
    i.dosCuentas ? 'Cuentas A y B propias listas.' : 'Solo una cuenta (falta la B).',
    'Se necesitan 2 cuentas propias para el cruce A→B (IDOR/authz).');

  // 6) Vía de alta coherente con el target (informativo, no bloquea si no aplica).
  const viaEmail = i.via === 'email' || /merchant|devise|sign_up/i.test(i.via || '');
  const viaSso = i.via === 'sso' || i.via === 'google' || /google|sso|oidc|keycloak|ssono/i.test(i.via || '');
  const viaExchange = i.via === 'exchange' || /exchange|app|kyc|mobile/i.test(i.via || '');
  g('alta-g5', 'Vía de alta real del target (prioriza la que evita KYC)', !!i.via,
    viaEmail ? `Vía email (Devise/Rails): ${i.via}` : (viaSso ? `Vía SSO/Google (IdP del realm): ${i.via}` : (viaExchange ? `Vía cuenta de intercambio (probable KYC): ${i.via}` : (i.via ? `Vía: ${i.via}` : 'Sin vía identificada.'))),
    'La vía se decide en el RECON (IdP real del target), no en el alta: priorizar Google/email (sin KYC) frente a exchange (probable KYC, alta-bar-k1). Lección de campo #5, metodología.');

  const sendable = r.every((x) => x.ok);
  return { sendable, summary: sendable ? '✅ ALTA COMPLETA — cuenta operativa' : `⛔ INCOMPLETA: ${r.filter(x => !x.ok).map(x => x.id).join(', ')}`, results: r };
}

module.exports = { altaChain, decision, FASES };