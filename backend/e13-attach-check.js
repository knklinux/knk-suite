'use strict';
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
async function main() {
  const ws = new WebSocket(`ws://127.0.0.1:9344/session`, { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p = {}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 30000); });
  await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
  const ctx = tree.result.contexts[0];
  const expr = `JSON.stringify({
    adjuntos: [...document.querySelectorAll('[class*=attachment]')].map(e => e.innerText.replace(/\s+/g,' ').trim()).filter(t => /\.(txt|png|jpg|pdf)/i.test(t)),
    fileInputs: document.querySelectorAll('input[type=file]').length,
    dropzone: !!document.querySelector('[class*=dropzone], [class*=upload]')
  })`;
  const r = await cmd('script.evaluate', { expression: expr, target: { context: ctx.context }, awaitPromise: true, resultOwnership: 'none' });
  console.log(r.result.result.value);
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
