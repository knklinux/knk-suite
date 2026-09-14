'use strict';

// ============================================================================
// KNK SUITE v2 — Helper de RACE CONDITIONS (clase biz-race)
// ----------------------------------------------------------------------------
// TOCTOU en operaciones single-use: redeem, claim, bonus, coupon, withdraw.
// El helper abre una ronda acotada de peticiones del mismo flujo (mismo payload),
// separadas por el limitador global, y compara las respuestas para detectar
// aplicación múltiple de una operación que debería ser de una sola vez.
//
// Seguridad:
//  · Usa el throttle global de net.js incluso al espaciar una ronda; no oculta
//    actividad ni permite ráfagas sin límite.
//  · Nunca completa transacciones reales: el caller controla el payload; este
//    helper solo dispara el request y cuenta respuestas.
//  · Un solo helper de prueba por ronda — no es un DoS (N configurable, por
//    defecto 5, máx 5).
// ============================================================================

const netMod = require('./net');

// Abre N peticiones de una ronda con separación mínima transparente. Las
// solicitudes pueden solaparse si una respuesta tarda más que el intervalo,
// pero cada inicio pasa por el throttle global y nunca se genera una ráfaga.
async function lanzarRonda(url, { metodo = 'POST', cuerpo = null, cabeceras = {}, n = 5, timeoutMs = 12000, authorization = false } = {}) {
  if (authorization !== true) return { ok: false, error: 'Requiere autorización explícita y cuenta/recurso de test propios' };
  // Scope + anti-SSRF (igual que net.fetch): con scope vacío se bloquean hosts
  // internos (loopback/LAN/metadata) — no se puede racear contra infra local.
  let host = null;
  try { host = new URL(url).hostname; } catch { return { ok: false, error: 'URL malformada' }; }
  const permitido = await netMod.hostAllowed(host).catch(() => false);
  if (!permitido) {
    return { ok: false, error: 'Fuera de scope', outOfScope: true };
  }

  const nReq = Math.max(1, Math.min(n || 5, 5)); // clamp 1..5, no ráfagas grandes
  const startAll = Date.now();
  const respuestas = [];
  const solicitudes = [];
  const enviar = (idx) => {
    const t0 = Date.now();
    return netMod.fetch(url, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo,
      timeoutMs,
    }).then((r) => {
      respuestas.push({ idx, status: r.status, ms: Date.now() - t0, body: (r.text || '').slice(0, 2000), headers: r.headers || {}, error: r.error });
      return r;
    }).catch((e) => {
      respuestas.push({ idx, status: 0, ms: Date.now() - t0, error: e.message });
      return null;
    });
  };

  // Se espacian las aperturas y se mantienen las promesas pendientes para
  // observar una posible TOCTOU sin permitir un bypass del limitador.
  for (let i = 0; i < nReq; i++) {
    solicitudes.push(enviar(i));
    if (i < nReq - 1) await new Promise((resolve) => setTimeout(resolve, netMod.getRateLimit()));
  }
  await Promise.all(solicitudes);

  const exito = respuestas.filter((r) => r.status && r.status >= 200 && r.status < 300);
  return {
    ok: true,
    url, metodo, n: nReq,
    totalMs: Date.now() - startAll,
    exitos: exito.length,
    fallos: respuestas.length - exito.length,
    statuses: respuestas.map((r) => r.status).sort(),
    respuestas: respuestas.sort((a, b) => a.idx - b.idx),
    posibleRace: exito.length > 1,
    pacing: { mode: 'global-limiter-spaced', minIntervalMs: netMod.getRateLimit(), maxConcurrentStarts: nReq },
  };
}

// Analiza una ronda: ¿es indicio de race? Compara si la operación single-use
// se aplicó más de una vez (más de un 2xx/201 con el mismo id de recurso).
function analizarRonda(ronda, { recursoKey = 'id' } = {}) {
  if (!ronda || !ronda.ok) return { probableRace: false, nota: 'sin ronda válida' };
  const ok = ronda.respuestas.filter((r) => r.status && r.status >= 200 && r.status < 300);
  if (ok.length <= 1) return { probableRace: false, nota: `${ok.length} éxito — single-use respetado` };

  // Si >1 éxito, verificar si el recurso se creó/consumió varias veces
  const ids = new Set();
  ok.forEach((r) => {
    try {
      const j = JSON.parse(r.body);
      const v = j && (j[recursoKey] !== undefined ? j[recursoKey] : (j.data && j.data[recursoKey]));
      if (v !== undefined) ids.add(String(v));
    } catch { /* body no JSON */ }
  });
  const probableRace = ok.length > 1 && ids.size === ok.length;
  return {
    probableRace,
    nota: probableRace
      ? `⚠️ ${ok.length} éxitos con ${ids.size} recursos distintos → posible doble-aplicación`
      : `${ok.length} éxitos pero mismo recurso (${ids.size}) → idempotente o dedup`,
    exitos: ok.length, recursosDistintos: ids.size,
  };
}

// Ronda de prueba completa: lanza, analiza y devuelve veredicto legible.
async function probarRace(url, opts = {}) {
  const ronda = await lanzarRonda(url, opts);
  const analisis = analizarRonda(ronda, { recursoKey: opts.recursoKey || 'id' });
  return { ...ronda, ...analisis };
}

module.exports = { lanzarRonda, analizarRonda, probarRace };
