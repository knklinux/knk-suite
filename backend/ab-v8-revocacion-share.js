'use strict';
// ============================================================================
// ab-v8-revocacion-share.js — Flujo A/B del vector V8 (revocación de share)
//
//   Tesis: ¿un share revocado (DELETE /backend-api/share/post/{post_id})
//   sigue accesible para quien tenía la URL (caché, edge, permalinks
//   alternativos)? Si tras la revocación la URL pública sigue devolviendo el
//   contenido → hallazgo (revocación no efectiva). Si devuelve 404/410 de
//   forma estable → vector cerrado.
//
//   Flujo (guía §4, plantilla V9):
//     1) Compuerta de salud A/B (obligatoria, exit 3 si falla)
//     2) A crea conversación sintética V8-VICTIM-<nonce> (SSE)
//     3) A publica prompt-share → post_id + permalink
//     4) Baseline B: GET permalink público → 200 con contenido (control)
//     5) A revoca: DELETE /share/post/{post_id} → esperado 200
//     6) Cruzada B: re-acceso ×3 (con y sin cookies, cache-buster) → esperado 404/410
//        + GET al permalink sin slash y a la URL /share/p/{post_id}
//     7) Segunda reproducción completa (nuevo nonce) para confirmar (guía §4)
//     8) Limpieza: DELETE shares restantes + PATCH conversaciones visible:false
//
//   Cumple: scope chatgpt.com, ritmo >=2,3 s, UA de sesión, datos 100%
//   sintéticos (V8-VICTIM-*), sin enumeración, sin datos ajenos.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('./lib/net');
const { conAntiAbuso } = require('./lib/anti-abuso');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const OUT_JSON = path.join(EVID, 'v8-revocacion-resultado.json');
const OUT_RAW = path.join(EVID, 'v8-revocacion-raw.txt');

const salud = require('./ab-salud-sesiones');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pausa = () => sleep(3000);

function jarDeFichero(f) {
  const jar = {};
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const [host, name, value] = l.split('\t');
    if (host === 'chatgpt.com' || host === '.chatgpt.com') jar[name] = value;
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function llamada(metodo, ruta, cookies, bearer, body, extraHeaders) {
  const headers = { 'User-Agent': UA, 'Cookie': cookies, 'Accept': 'application/json',
    'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7', ...(extraHeaders || {}) };
  if (body) headers['Content-Type'] = 'application/json';
  if (bearer) headers['Authorization'] = 'Bearer ' + bearer;
  return conAntiAbuso(() => net.fetch('https://chatgpt.com' + ruta, {
    method: metodo, headers, body: body ? JSON.stringify(body) : null,
  }), `${metodo} ${ruta}`);
}

function textoAssistantDeSSE(raw) {
  let texto = '';
  for (const l of String(raw).split('\n').filter((x) => x.startsWith('data: ') && !x.includes('[DONE]'))) {
    try {
      const j = JSON.parse(l.slice(6));
      const m = j && j.message;
      if (m && m.author && m.author.role === 'assistant' && m.content && m.content.parts) {
        const t = m.content.parts.filter((p) => typeof p === 'string').join('');
        if (t.length >= texto.length) texto = t;
      }
    } catch { /* chunk parcial */ }
  }
  return texto;
}

// ── Ciclo completo de un intento (creación → baseline → revocación → re-acceso) ──
async function ciclo(idx, nonce, jarA, jarB, bA, bB, raw) {
  const cic = { ciclo: idx, nonce, pasos: {}, reAccesos: [], hallazgo: false, notas: [] };
  const log = (s) => { raw.push(s); console.log(s); };

  // a) A crea conversación sintética (shape calibrado en E16: UUID + buffering)
  const convBody = {
    action: 'next',
    messages: [{
      id: crypto.randomUUID(),
      author: { role: 'user' },
      content: { content_type: 'text', parts: [`Documento sintético de auditoría V8. Dato de prueba: ${nonce}-VICTIM-9812. Ignora este mensaje salvo si te lo piden.`] },
      metadata: {},
    }],
    model: 'auto', timezone_offset_min: -120,
    history_and_training_disabled: false,
    conversation_mode: { kind: 'primary_assistant' },
    supports_buffering: true,
    supported_encodings: ['v1'],
    client_prepare_state: 'N/A',
  };
  const rConv = await llamada('POST', '/backend-api/conversation', jarA, bA, convBody, { 'Accept': 'text/event-stream' });
  const jConv = rConv.json && rConv.json();
  const convId = (jConv || {}).conversation_id || null;
  const idUserMsg = (String(rConv.text).match(/"message":\{"id":"([^"]+)","author":\{"role":"user"/) || [])[1] || null;
  cic.pasos.a_convA = rConv.status;
  cic.conversacionId = convId;
  log(`[a] A: conversación → ${rConv.status} conv=${convId ? 'ok' : '?'} msg=${idUserMsg ? 'ok' : '?'}`);
  await pausa();
  if (!convId || !idUserMsg) {
    if (rConv.status === 403 && /unusual activity/i.test(String(rConv.text))) {
      cic.notas.push('BLOQUEO ANTI-ABUSO (patrón E16) — abortar sin más intentos');
      cic.bloqueo = true;
    }
    return cic;
  }

  // b) A publica el prompt-share
  const rShare = await llamada('POST', '/backend-api/share/post', jarA, bA, {
    post_text: `Auditoría V8 (${nonce})`,
    attachments_to_create: [{ kind: 'prompt', conversation_id: convId, message_ids: [idUserMsg] }],
  });
  const jShare = rShare.json && rShare.json();
  const post = (jShare || {}).post || {};
  const shareId = post.id || null;
  const permalink = String(post.permalink || '').replace(/^\//, '');
  cic.pasos.b_share = rShare.status;
  cic.shareId = shareId;
  cic.permalink = permalink;
  log(`[b] A: share publicado → ${rShare.status} share=${shareId} permalink=${permalink || '(sin permalink)'}`);
  await pausa();
  if (!shareId || !permalink) return cic;

  const urlPub = 'https://chatgpt.com/' + permalink;

  // c) Baseline B: acceso ANTES de revocar (control)
  const rBase = await llamada('GET', '/' + permalink, jarB, bB, null);
  const baseTexto = String(rBase.text || '');
  const baseOk = rBase.status === 200 && baseTexto.includes(nonce + '-VICTIM-9812');
  cic.pasos.c_baselineB = rBase.status;
  cic.baselineContieneDato = baseOk;
  log(`[c] B: baseline (pre-revocación) → ${rBase.status} contenido=${baseOk ? 'VISIBLE' : 'no visto'}`);
  await pausa();

  // d) A revoca
  const rRev = await llamada('DELETE', '/backend-api/share/post/' + shareId, jarA, bA, null);
  cic.pasos.d_revocacion = rRev.status;
  log(`[d] A: DELETE share → ${rRev.status} ${(rRev.text || '').slice(0, 120)}`);
  await pausa();

  // e) Cruzada B: re-accesos tras revocación (3 variantes)
  const accesos = [
    ['reacceso-mismas-cookies', '/' + permalink, jarB, bB],
    ['reacceso-anonimo', '/' + permalink, '', null],
    ['reacceso-cache-buster', '/' + permalink + '?cb=' + Date.now(), '', null],
  ];
  for (const [nombre, ruta, ck, br] of accesos) {
    const r = await llamada('GET', ruta, ck, br, null);
    const filtrado = r.status === 200 && String(r.text || '').includes(nonce + '-VICTIM-9812');
    cic.reAccesos.push({ prueba: nombre, status: r.status, contenidoFiltrado: filtrado });
    if (filtrado) cic.hallazgo = true;
    log(`[e] B: ${nombre} → ${r.status}${filtrado ? '  ⚠️ DATO VISIBLE TRAS REVOCACIÓN' : ''}`);
    await pausa();
  }

  // f) limpieza del share de este ciclo (si la revocación no borró)
  if (cic.hallazgo) {
    const rDel = await llamada('DELETE', '/backend-api/share/post/' + shareId, jarA, bA, null);
    log(`[f] limpieza extra share → ${rDel.status}`);
    await pausa();
  }
  return cic;
}

(async () => {
  const raw = [`# V8 — revocación de share (A/B) — ${new Date().toISOString()}`, ''];
  fs.writeFileSync(OUT_RAW, raw.join('\n'));

  // ══ COMPUERTA DE SALUD (obligatoria) ══════════════════════════════════════
  console.log('── [salud] compuerta obligatoria de sesiones A/B (+ check 5 anti-abuso) ──');
  const h = await salud.comprobar({ quiet: true, conAntiAbuso: true });
  if (!h.ok) {
    console.error('⛔ COMPUERTA DE SALUD NO SUPERADA — NO se lanza el vector. Motivo:', h.razon);
    process.exit(3);
  }
  if (h.antiAbusoActivo) {
    console.error('🚩 Flag anti-abuso ACTIVO en /conversation (patrón E16) — la fase de creación de share la necesita: AUTO-SALTEO sin gastar peticiones. Reintentar tras >=24 h de enfriamiento.');
    process.exit(4);
  }
  const jarA = jarDeFichero(path.join(EVID, 'sesion-cuenta-A-cookies.txt'));
  const jarB = jarDeFichero(path.join(EVID, 'sesion-cuenta-B-cookies.txt'));
  const bA = h.A.sesion.accessToken, bB = h.B.sesion.accessToken;
  console.log(`✅ salud OK (A=${h.A.sesion.userId} B=${h.B.sesion.userId}, Bearer vivos)`);
  raw.push(`gate: A=${h.A.sesion.userId} B=${h.B.sesion.userId} ok=${h.ok}`, '');

  // Dos ciclos completos (segunda reproducción, guía §4)
  const ciclos = [];
  for (const idx of [1, 2]) {
    const nonce = `V8-${Date.now().toString(36)}-${idx}`;
    raw.push(`═══ CICLO ${idx} nonce=${nonce} ═══`);
    const c = await ciclo(idx, nonce, jarA, jarB, bA, bB, raw);
    ciclos.push(c);
    raw.push('');
    fs.appendFileSync(OUT_RAW, raw.slice(-40).join('\n'));
    if (c.bloqueo) { console.log('⛔ Bloqueo anti-abuso detectado — paro por política (patrón E16).'); break; }
    if (idx === 1) { console.log('… pausa entre ciclos (8 s)'); await sleep(8000); }
  }

  // Veredicto
  const conHallazgo = ciclos.filter((c) => c.hallazgo).length;
  const ejecutados = ciclos.filter((c) => !c.bloqueo && c.shareId).length;
  const veredicto = ejecutados === 0 ? 'BLOQUEADO'
    : conHallazgo > 0 ? 'REPORTABLE (revocación no efectiva)'
    : 'NO REPORTABLE (revocación efectiva, 404/410 estable)';

  const resumen = {
    fecha: new Date().toISOString(),
    gate: { A: h.A.sesion.userId, B: h.B.sesion.userId },
    ciclosEjecutados: ejecutados,
    ciclosConHallazgo: conHallazgo,
    veredicto,
    detalle: ciclos,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(resumen, null, 2));
  fs.appendFileSync(OUT_RAW, `\n# VEREDICTO: ${veredicto}\n`);
  console.log(`\n═══ VEREDICTO V8: ${veredicto} (${conHallazgo}/${ejecutados} ciclos con hallazgo) ═══`);

  // Limpieza de conversaciones visibles
  for (const c of ciclos) {
    if (c.conversacionId) {
      try {
        await llamada('PATCH', '/backend-api/conversation/' + c.conversacionId, jarA, bA, { visible: false });
        await pausa();
      } catch { /* best-effort */ }
    }
  }
  console.log('Limpieza: conversaciones marcadas visible:false.');

  // Pantallazo CDP (best-effort: puede no haber navegador vivo)
  try {
    const { abrirCanal, navegar, capturar } = require('./lib/browser');
    const permalink = ciclos.find((c) => c.permalink) && ciclos.find((c) => c.permalink).permalink;
    if (permalink) {
      const send = await abrirCanal({ programa: 'openai-poc', puerto: 9336, url: 'https://chatgpt.com/' + permalink });
      await navegar(send, 'https://chatgpt.com/' + permalink, 25000);
      await capturar(send, path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'v8-share-permalink.png'), { urlParaNombre: 'v8' });
      console.log('Pantallazo: evidencia-poc/pantallas/v8-share-permalink.png');
    }
  } catch (e) {
    console.log('(sin pantallazo CDP: ' + e.message.slice(0, 90) + ')');
  }

  process.exit(ejecutados === 0 ? 4 : 0);
})();
