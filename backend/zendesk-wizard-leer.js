'use strict';
// zendesk-wizard-leer.js — Lee el texto y botones del wizard de setup de
// Messaging (cada frame) y lo escribe a fichero (sin depender del escape CLI).
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const URL_SETUP = 'https://autonomo-49965.zendesk.com/admin/channels/messaging_and_social/messaging/setup';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-wizard-texto.json');

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
  const salida = [];
  for (const f of frames) {
    const expr = "JSON.stringify({u: location.href.slice(0,110), t: document.body.innerText.split('\\n').slice(0,40).join(' ~ '), b: Array.from(document.querySelectorAll('button')).map(x => x.innerText.trim()).filter(t => t && t.length < 50).slice(0, 25)})";
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: f }, awaitPromise: true, resultOwnership: 'none' }).catch(() => null);
    const v = ev && ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    let p = null;
    try { p = JSON.parse(v); } catch (e) { p = { raw: String(v).slice(0, 200) }; }
    salida.push(p);
  }
  fs.writeFileSync(OUT, JSON.stringify(salida, null, 1));
  console.log('GUARDADO:', OUT, '| frames:', salida.length);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
