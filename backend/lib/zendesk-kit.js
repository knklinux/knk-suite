'use strict';
// ============================================================================
// lib/zendesk-kit.js — Kit común de los drivers Zendesk (H1/H2/E16-remarco)
//
// Patrones heredados del kit OpenAI: pacing 3s, UA real de Firefox (implícito:
// todo va por el navegador BiDi, nunca fabricamos UA), V13 en toda captura,
// evidencia en evidencia-poc/http/, auto-salteo con código de salida nombrado
// cuando falta un prerrequisito.
//
// Restricciones de cumplimiento (CUMPLIMIENTO-CLLMSE-2026-09-08):
//   - Solo autonomo-49965.zendesk.com y nuestra account_key.
//   - CERO sondas a hosts zdassets (solo la carga natural del widget).
//   - Datos 100% sintéticos (SYNTHETIC-Z-*).
//   - El fallo de un prerrequisito = skip limpio, nunca peticiones a ciegas.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const v13 = require('./v13-detector');

const SUB = 'autonomo-49965.zendesk.com';
const ACCOUNT_KEY = 'df3d609f-14a9-4a77-b441-73602a4aaab2';
const HTTP_DIR = path.join(__dirname, '..', '..', 'evidencia-poc', 'http');
const HARVEST = path.join(HTTP_DIR, 'zendesk-fase1-handshake.json');

// Códigos de salida nombrados (cada driver documenta el suyo)
const EXIT = {
  SIN_CANAL: 21,            // messaging sin conectar (wizard incompleto) — H1
  SIN_AGENTE: 22,           // AI agent sin configurar — H2
  SIN_WIZARD_O_CANARIO: 23, // wizard incompleto o canario no público — E16
  ERROR_CANAL: 30,          // BiDi no disponible
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pacing = () => sleep(3000); // política del programa: >=2s; nosotros 3s

function guardarEvidencia(nombre, obj) {
  const f = path.join(HTTP_DIR, nombre);
  fs.writeFileSync(f, JSON.stringify(obj, null, 1));
  console.log('evidencia:', f);
  return f;
}

// ── Sesión BiDi (una conexión por driver: evita el leak de sesión) ──────────
async function conSesion() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p = {}) => new Promise((r, j2) => {
    const i = ++id; pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 45000);
  });
  await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const ctx0 = (await cmd('browsingContext.getTree', { maxDepth: 1 })).result.contexts[0].context;

  const evalJSON = async (ctx, expr) => {
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    const v = ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    try { return JSON.parse(v); } catch (e) { return { _raw: String(v).slice(0, 300) }; }
  };
  // fetch same-origin con la sesión del navegador (admin o visitante, según ctx)
  const fetchNavegador = async (ctx, url, metodo = 'GET', cuerpo = null) => {
    const expr = `fetch('${url}', { method: '${metodo}', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin'` +
      (cuerpo ? `, body: JSON.stringify(${JSON.stringify(cuerpo)})` : '') +
      `}).then(async r => JSON.stringify({ status: r.status, cuerpo: (await r.text()).slice(0, 4000) })).catch(e => JSON.stringify({ status: -1, cuerpo: String(e).slice(0, 200) }))`;
    const r = await evalJSON(ctx, expr);
    return (r && r.status !== undefined) ? r : { status: -1, cuerpo: JSON.stringify(r).slice(0, 300) };
  };

  return {
    ws, cmd, ctx0, evalJSON, fetchNavegador,
    navegar: async (ctx, url, espera = 8000) => { await cmd('browsingContext.navigate', { context: ctx, url, wait: 'complete' }); await sleep(espera); },
    captura: async (ctx, nombre) => {
      const s = await cmd('browsingContext.captureScreenshot', { context: ctx });
      fs.writeFileSync(path.join(__dirname, '..', '..', 'evidencia-poc', 'pantallas', nombre), Buffer.from(s.result.data, 'base64'));
    },
    cerrar: async () => { await cmd('session.end', {}).catch(() => {}); ws.close(); },
  };
}

// frames cuyo src apunta a hosts reales del widget (no about:blank)
function framesReales(nodos, out = []) {
  for (const n of nodos || []) {
    if (n.url && /zendesk\.com|zdassets\.com/.test(n.url) && !n.url.startsWith('https://' + SUB + '/hc')) out.push(n.url.slice(0, 160));
    if (n.children) framesReales(n.children, out);
  }
  return out;
}
const arbolFrames = (nodos, out = []) => {
  for (const n of nodos || []) { out.push(n.context); if (n.children) arbolFrames(n.children, out); }
  return out;
};

// ── Prerrequisito 1: canal de Messaging vivo ────────────────────────────────
// Señal fiable: sessionToken/conversationStartedAt en localStorage del HC.
// (El widget de messaging nuevo vive en iframes about:blank con contenido
// inyectado — los src externos no son la señal.)
async function verificarCanal(S) {
  const out = { vivo: false, frames: [], fuente: '', senales: null };
  // (a) atajo por harvest previo
  try {
    const h = JSON.parse(fs.readFileSync(HARVEST, 'utf8'));
    const reales = (h.frames_inicial || []).filter(u => /zdassets\.com|zendesk/.test(u) && !/\/hc\/es$/.test(u) && !u.startsWith('about:'));
    if (reales.length) { out.vivo = true; out.frames = reales; out.fuente = 'harvest'; return out; }
  } catch (e) { /* sin harvest: seguimos con check en vivo */ }
  // (b) check en vivo sobre el HC
  await S.navegar(S.ctx0, `https://${SUB}/hc/es`, 15000);
  const tree = (await S.cmd('browsingContext.getTree', { maxDepth: 5 })).result.contexts;
  out.frames = framesReales(tree);
  const exprSenal = "JSON.stringify((() => { const s = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.indexOf('sessionToken') >= 0 || k.indexOf('conversationStartedAt') >= 0) s[k] = String(localStorage.getItem(k)).slice(0, 80); } return s; })())";
  for (const c of arbolFrames(tree)) {
    const r = await S.evalJSON(c, exprSenal).catch(() => null);
    if (r && !r._raw && Object.keys(r).length) {
      out.vivo = true; out.senales = r; out.fuente = 'sessionToken-localStorage';
      break;
    }
  }
  if (!out.vivo) out.vivo = out.frames.length > 0;
  if (!out.fuente) out.fuente = 'check-en-vivo';
  return out;
}

// ── Prerrequisito 2: AI agent configurado en la instancia ───────────────────
async function verificarAgente(S) {
  await S.navegar(S.ctx0, `https://${SUB}/admin/ai/ai-agents/ai-agents`, 9000);
  const candidatos = ['/api/v2/ai/agents', '/api/v2/bots', '/api/v2/sunco/bots'];
  const detalles = [];
  for (const c of candidatos) {
    const r = await S.fetchNavegador(S.ctx0, c);
    detalles.push({ endpoint: c, status: r.status });
    if (r.status === 200 && /agent|bot|id/i.test(r.cuerpo)) {
      return { configurado: true, endpoint: c, respuesta: r.cuerpo.slice(0, 1500), detalles };
    }
    await pacing();
  }
  return { configurado: false, detalles };
}

// ── V13: escaneo de cualquier texto capturado antes de escribir evidencia ───
function v13Escanea(texto, fuente) {
  return v13.escanear(texto, { fuente }); // null = limpio; alerta ya se registra sola
}

module.exports = {
  SUB, ACCOUNT_KEY, EXIT, HTTP_DIR, HARVEST,
  sleep, pacing, guardarEvidencia, conSesion,
  framesReales, arbolFrames, verificarCanal, verificarAgente, v13Escanea,
};
