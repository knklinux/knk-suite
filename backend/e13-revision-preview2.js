'use strict';
// e13-revision-preview2.js — Segunda pasada: nombres de todos los adjuntos en la página
//   y contenido real del editor de descripción (CodeMirror/textarea oculto).
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PUERTO = 9344;

async function main() {
  const ws = new WebSocket(`ws://127.0.0.1:${PUERTO}/session`, { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (method, params = {}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + method)); } }, 30000); });

  await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
  const ctx = tree.result.contexts[0];

  const expr = `JSON.stringify((() => {
    const page = document.body.innerText;
    const nombres = ['sas-upload-raw.txt','sas-upload-raw-CLEAN.txt','sas-round3-contenido.txt','sas-ip-binding-analisis.txt','e13-descarga-B.png'];
    const presentes = nombres.filter(n => page.includes(n));
    // textareas/inputs ocultos con contenido largo
    const campos = [...document.querySelectorAll('textarea, input[type=hidden]')]
      .map(t => ({ name: t.name || t.id || '(sin nombre)', len: (t.value||'').length }))
      .filter(c => c.len > 200);
    // editores rich (contenteditable)
    const ce = [...document.querySelectorAll('[contenteditable="true"]')].map(e => (e.innerText||'').length);
    return { presentes, camposGrandes: campos, contenteditableLens: ce,
      embedEnPagina: (page.match(/!\\[[^\\]]*\\]\\(https:\\/\\/bugcrowd[^)]*\\)/g) || []).map(e => e.slice(0,80)) };
  })())`;

  const r = await cmd('script.evaluate', { expression: expr, target: { context: ctx.context }, awaitPromise: true, resultOwnership: 'none' });
  console.log(r.result.result ? r.result.result.value : JSON.stringify(r.result));
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
