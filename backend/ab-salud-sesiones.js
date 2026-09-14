'use strict';
// ============================================================================
// ab-salud-sesiones.js — Informe de salud de las sesiones A/B antes de un vector
// COMPUERTA OBLIGATORIA: todos los drivers A/B llaman a comprobar() y reutilizan
// informe.A.sesion / informe.B.sesion (user.id + accessToken) sin repetir peticiones.
//
//   node ab-salud-sesiones.js            # informe completo + JSON
//   node ab-salud-sesiones.js --quiet    # solo JSON + exit code (compuerta)
//   node ab-salud-sesiones.js --con-ant-abuso   # añade el check 5 (sonda /conversation)
//
// Qué comprueba (en este orden, pausa >=2,2 s entre peticiones):
//   1) /api/auth/session con cookies de A → 200, user.id y accessToken presentes
//   2) /api/auth/session con cookies de B → ídem
//   3) Compuerta A≠B: user.id distintos (discriminador real de cuenta;
//      el id de /backend-api/me es device id ua-… y NO sirve)
//   4) /backend-api/me con Bearer de A y de B → 200 (token vivo, no revocado)
//   5) OPCIONAL (--con-ant-abuso): SONDA de anti-abuso en /conversation con A
//      → 1 ÚNICA petición, SIN reintentos. Detecta el 403 "Unusual activity"
//      (patrón E16) para que los drivers bloqueados por ese flag (E16/E17/E18)
//      se AUTO-SALTEEN sin gastar sus peticiones en una pared.
//      Coste: 1 petición. Los vectores que NO tocan /conversation no deben
//      activarla (el flag no afecta a /files, /share, /me, etc.).
//
// Salida: evidencia-poc/http/salud-sesiones-informe.json  (+ .txt legible)
// Exit code: 0 = sesiones sanas (se puede lanzar el vector); 1 = NO lanzar;
//            4 = sesiones sanas PERO flag anti-abuso activo (solo con check 5).
//
// Uso como compuerta en un driver A/B:
//   const salud = require('./ab-salud-sesiones');
//   const ok = await salud.comprobar();   // { ok, A, B, razon }
//   if (!ok.ok) process.exit(1);
// Driver que toca /conversation (E16/E17/E18) — con auto-skip del flag:
//   const ok = await salud.comprobar({ conAntiAbuso: true });
//   if (!ok.ok) process.exit(1);
//   if (ok.antiAbusoActivo) { /* saltar el vector sin gastar peticiones */ process.exit(4); }
//
// Cumplimiento: 4 peticiones autenticadas totales, rate limit >=2,2 s,
// solo cuentas propias A/B, sin enumeración ni datos de terceros.
// ============================================================================
const fs = require('fs');
const path = require('path');
const net = require('./lib/net');
const v13 = require('./lib/v13-detector');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const JAR_A = path.join(EVID, 'sesion-cuenta-A-cookies.txt');
const JAR_B = path.join(EVID, 'sesion-cuenta-B-cookies.txt');
const OUT_JSON = path.join(EVID, 'salud-sesiones-informe.json');
const OUT_TXT = path.join(EVID, 'salud-sesiones-informe.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jarDeFichero(f) {
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const jar = {};
  for (const l of lines) {
    const [host, name, value] = l.split('\t');
    if (host === 'chatgpt.com' || host === '.chatgpt.com') jar[name] = value;
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function sesionCompleta(cookieHeader) {
  const r = await net.fetch('https://chatgpt.com/api/auth/session', {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Cookie': cookieHeader, 'Accept': 'application/json', 'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7' },
  });
  const text = r.text || (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return {
    status: r.status,
    userId: j && j.user && j.user.id,
    email: j && j.user && j.user.email,
    accessToken: j && j.accessToken || null,
    expires: j && j.expires || null,
  };
}

async function sesionCompletaSegura(cookieHeader) {
  try {
    return await sesionCompleta(cookieHeader);
  } catch (e) {
    return { status: 0, userId: null, email: null, accessToken: null, expires: null, error: e.message };
  }
}

async function meConBearer(bearer) {
  const r = await net.fetch('https://chatgpt.com/backend-api/me', {
    method: 'GET',
    headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7', 'Authorization': 'Bearer ' + bearer },
  });
  let j = null;
  try { j = r.json(); } catch {}
  return { status: r.status, id: j && j.id, revocado: r.status === 401 && /token_revoked/i.test(r.text || '') };
}

/**
 * Check 5 — SONDA de anti-abuso en /conversation (cuenta A).
 * UNA sola petición, SIN reintentos: el anti-abuso (patrón E16) se detecta y
 * se reporta; insistir es exactamente lo que la política E16 prohíbe.
 * Devuelve { activo: boolean, status: number }.
 */
async function sondaAntiAbuso(bearer, cookieHeader, pausaMs) {
  await sleep(pausaMs);
  let r;
  try {
    r = await net.fetch('https://chatgpt.com/backend-api/conversation', {
      method: 'POST',
      headers: {
        'User-Agent': UA, 'Cookie': cookieHeader, 'Authorization': 'Bearer ' + bearer,
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Content-Type': 'application/json', 'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        action: 'next',
        messages: [{ id: crypto.randomUUID(), author: { role: 'user' }, content: { content_type: 'text', parts: ['ping de disponibilidad'] } }],
        model: 'auto', timezone_offset_min: -120, supports_buffering: true,
        supported_encodings: ['v1'], conversation_mode: { kind: 'primary_assistant' },
        force_paragen: false, force_paragen_model_slug: '', force_nulligen: false,
        force_rate_limit: false, reset_rate_limits: false,
        websocket_request_id: crypto.randomUUID(),
      }),
    });
  } catch (e) {
    return { activo: false, status: 0, error: e.message }; // sin red no hay flag que detectar
  }
  const texto = r.text || '';
  const activo = r.status === 403 && /unusual activity/i.test(texto);
  return { activo, status: r.status, fragmento: texto.slice(0, 160) };
}

/** Comprueba ambas sesiones. Devuelve { ok, A, B, razon, informe, antiAbusoActivo } */
async function comprobar({ pausaMs = 2200, quiet = false, conAntiAbuso = false } = {}) {
  const informe = { ts: new Date().toISOString(), checks: [], ok: false, razon: null, A: null, B: null, antiAbusoActivo: false };
  const check = (n, desc, estado, detalle) => {
    informe.checks.push({ n, desc, estado, detalle });
    if (!quiet) console.log(`[${n}] ${desc} → ${estado} ${detalle || ''}`);
  };

  // 1) Sesión A (si falta el jar, la sesión se marca como muerta sin lanzar)
  const sA = await sesionCompletaSegura(fs.existsSync(JAR_A) ? jarDeFichero(JAR_A) : '');
  const okA = sA.status === 200 && sA.userId && sA.accessToken;
  check(1, 'A: /api/auth/session 200 con user.id y accessToken', okA ? 'OK' : 'FALLO',
    `status=${sA.status} user=${sA.userId || 'null'} token=${sA.accessToken ? 'sí' : 'no'}`);
  // sesion completo se expone para que los drivers A/B reutilicen el resultado
  // (user.id + accessToken) SIN repetir las peticiones (rate limit).
  informe.A = { userId: sA.userId, expires: sA.expires, token: !!sA.accessToken, sesion: okA ? sA : null };
  await sleep(pausaMs);

  // 2) Sesión B
  const sB = await sesionCompletaSegura(fs.existsSync(JAR_B) ? jarDeFichero(JAR_B) : '');
  const okB = sB.status === 200 && sB.userId && sB.accessToken;
  check(2, 'B: /api/auth/session 200 con user.id y accessToken', okB ? 'OK' : 'FALLO',
    `status=${sB.status} user=${sB.userId || 'null'} token=${sB.accessToken ? 'sí' : 'no'}`);
  informe.B = { userId: sB.userId, expires: sB.expires, token: !!sB.accessToken, sesion: okB ? sB : null };
  await sleep(pausaMs);

  // 3) Compuerta A≠B
  const distintos = sA.userId && sB.userId && sA.userId !== sB.userId;
  check(3, 'Compuerta A≠B (user.id distintos)', distintos ? 'OK' : 'FALLO',
    `${sA.userId} vs ${sB.userId}`);
  if (!distintos) informe.razon = 'A y B resuelven a la misma cuenta (o una sesión muerta)';

  // V13: ids legítimos ya resueltos → allowlist del detector pasivo
  if (sA.userId) v13.registrarEntidadesConocidas([sA.userId]);
  if (sB.userId) v13.registrarEntidadesConocidas([sB.userId]);
  await sleep(pausaMs);

  // 4) Bearer vivo en ambas (solo si 1-3 pasan)
  if (okA && okB && distintos) {
    const mA = await meConBearer(sA.accessToken);
    await sleep(pausaMs);
    const mB = await meConBearer(sB.accessToken);
    const okBearer = mA.status === 200 && mB.status === 200;
    check(4, 'Bearer vivo en /backend-api/me (A y B)', okBearer ? 'OK' : 'FALLO',
      `A=${mA.status}${mA.revocado ? ' (token_revoked)' : ''} B=${mB.status}${mB.revocado ? ' (token_revoked)' : ''}`);
    if (!okBearer) informe.razon = 'accessToken revocado o caducado en alguna cuenta';
  } else {
    check(4, 'Bearer vivo (omitido)', 'OMITIDO', 'falló 1-3');
  }

  // 5) SONDA anti-abuso (opcional, solo drivers que tocan /conversation)
  if (conAntiAbuso && okA && okB && distintos) {
    const sonda = await sondaAntiAbuso(sA.accessToken, fs.existsSync(JAR_A) ? jarDeFichero(JAR_A) : '', pausaMs);
    informe.antiAbusoActivo = sonda.activo;
    check(5, 'Sonda anti-abuso /conversation (A, 1 petición sin reintentos)',
      sonda.activo ? 'FLAG ACTIVO' : (sonda.status === 0 ? 'SIN RED (no bloquea)' : 'OK — libre'),
      `status=${sonda.status}${sonda.fragmento ? ' | ' + sonda.fragmento.replace(/\n/g, ' ') : ''}`);
  if (sonda.activo) {
      informe.razonFlag = 'flag anti-abuso ACTIVO en /conversation (patrón E16): los vectores que lo tocan deben auto-saltearse (exit 4)';
    }
  } else if (conAntiAbuso) {
    check(5, 'Sonda anti-abuso (omitida)', 'OMITIDO', 'falló 1-3 — no se gasta la petición');
  }
  // Nota: el flag anti-abuso NO va en informe.razon (eso anularía ok=true y
  // haría fallar también a los vectores que NO tocan /conversation). Va en
  // razonFlag + antiAbusoActivo: sesiones sanas ≠ /conversation desbloqueado.

  informe.ok = !informe.razon && informe.checks.every((c) => c.estado === 'OK' || c.estado === 'OMITIDO' || c.estado === 'FLAG ACTIVO' || c.estado === 'SIN RED (no bloquea)');
  if (!informe.razon && !informe.ok) informe.razon = 'algún check no pasó';
  // La sonda NO marca las sesiones como no sanas: son sanas, pero el driver
  // consulte informe.antiAbusoActivo (o el exit 4) para auto-saltearse.
  if (informe.razonFlag && !informe.razon) informe.razon = informe.razonFlag; // solo informativo para el .txt; ok ya calculado

  fs.writeFileSync(OUT_JSON, JSON.stringify(informe, null, 2));
  fs.writeFileSync(OUT_TXT, [
    `# Informe de salud de sesiones A/B — ${informe.ts}`,
    `Veredicto: ${informe.ok ? 'SANAS — se puede lanzar el vector' : 'NO SANAS — NO lanzar el vector'}${informe.razon ? ' (' + informe.razon + ')' : ''}`,
    ...informe.checks.map((c) => `[${c.n}] ${c.desc} → ${c.estado} ${c.detalle || ''}`),
  ].join('\n') + '\n');
  return informe;
}

module.exports = { comprobar, sondaAntiAbuso };

(async () => {
  if (require.main !== module) return;
  const quiet = process.argv.includes('--quiet');
  const conAntiAbuso = process.argv.includes('--con-ant-abuso');
  const informe = await comprobar({ quiet, conAntiAbuso });
  if (quiet) {
    console.log(informe.ok && !informe.antiAbusoActivo ? 'ok' : (informe.antiAbusoActivo ? 'flag-activo' : 'false'));
  } else {
    console.log(`\nVeredicto: ${informe.ok && !informe.antiAbusoActivo ? '✅ SESIONES SANAS — se puede lanzar el vector' : (informe.ok && informe.antiAbusoActivo ? '✅ SESIONES SANAS · 🚩 FLAG ANTI-ABUSO ACTIVO — solo vectores SIN /conversation; los E16/E17/E18 se auto-saltean (exit 4)' : '⛔ NO SANAS — NO lanzar: ' + (informe.razon || ''))}`);
  }
  process.exit(informe.ok ? (informe.antiAbusoActivo ? 4 : 0) : 1);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(2); });
