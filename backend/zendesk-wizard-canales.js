'use strict';
// zendesk-wizard-canales.js — Pulsa "Administrar canales" en el wizard de
// Messaging y lee la página de canales (qué canales están conectados).
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const URL_SETUP = 'https://autonomo-49965.zendesk.com/admin/channels/messaging_and_social/messaging/setup';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-canales-estado.json');

async function main() {
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
  const ctx = (await cmd('browsingContext.getTree', { maxDepth: 1 })).result.contexts[0].context;
  await cmd('browsingContext.navigate', { context: ctx, url: URL_SETUP, wait: 'complete' });
  await new Promise(r => setTimeout(r, 10000));
  const tree = (await cmd('browsingContext.getTree', { maxDepth: 4 })).result.contexts;
  const frames = [];
  const walk = (nodos, out) => { for (const n of nodos || []) { out.push(n.context); if (n.children) walk(n.children, out); } };
  walk(tree, frames);
  // pulsar el botón en el frame que lo tiene
  let pulsado = false;
  for (const f of frames) {
    const ev = await cmd('script.evaluate', { expression: "(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Administrar canales'); if (b) { b.click(); return 'pulsado'; } return 'no-esta'; })()", target: { context: f }, awaitPromise: true, resultOwnership: 'none' }).catch(() => null);
    const v = ev && ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    if (v === 'pulsado') { pulsado = true; break; }
  }
  console.log('botón pulsado:', pulsado);
  await new Promise(r => setTimeout(r, 8000));
  // leer la página resultante
  const tree2 = (await cmd('browsingContext.getTree', { maxDepth: 4 })).result.contexts;
  const frames2 = [];
  walk(tree2, frames2);
  const salida = { pulsado, url_final: null, paginas: [] };
  for (const f of frames2) {
    const expr = "JSON.stringify({u: location.href.slice(0,130), t: document.body.innerText.split('\\n').slice(0,50).join(' ~ ')})";
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: f }, awaitPromise: true, resultOwnership: 'none' }).catch(() => null);
    const v = ev && ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    try { const p = JSON.parse(v); if (p.t && p.t.length > 60) { salida.paginas.push(p); if (!salida.url_final) salida.url_final = p.u; } } catch (e) {}
  }
  fs.writeFileSync(OUT, JSON.stringify(salida, null, 1));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
