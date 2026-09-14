'use strict';
// bidi-sesion.js — Sesión WebDriver BiDi persistente contra Firefox 9344
// Uso:  node backend/bidi-sesion.js 'JSON_ARRAY_DE_COMANDOS'
// Cada comando: {"op":"eval","expr":"..."} | {"op":"nav","url":"..."} | {"op":"shot","file":"x.png"}
// Ejecuta la lista en el contexto activo y imprime resultados JSON.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PUERTO = process.env.BIDI_PORT || 9344;

async function main() {
  const ops = JSON.parse(process.argv[2] || '[]');
  const ws = new WebSocket(`ws://127.0.0.1:${PUERTO}/session`, { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (method, params = {}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + method)); } }, 30000); });

  const ses = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const sid = ses.result.sessionId;
  await cmd('session.subscribe', { events: ['browsingContext.load'] });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
  const ctx = tree.result.contexts[0].context;

  const out = [];
  for (const op of ops) {
    if (op.op === 'nav') {
      await cmd('browsingContext.navigate', { context: ctx, url: op.url, wait: 'complete' }).catch(e => out.push({ op: 'nav', err: e.message }));
      out.push({ op: 'nav', url: op.url });
    } else if (op.op === 'eval') {
      const r = await cmd('script.evaluate', { expression: op.expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
      out.push({ op: 'eval', result: r.result && (r.result.result || r.result) , err: r.error });
    } else if (op.op === 'shot') {
      const r = await cmd('browsingContext.captureScreenshot', { context: ctx });
      const f = path.resolve(op.file);
      fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
      out.push({ op: 'shot', file: f, bytes: fs.statSync(f).size });
    } else if (op.op === 'wait') {
      await new Promise(r => setTimeout(r, op.ms || 2000));
      out.push({ op: 'wait', ms: op.ms });
    }
  }
  console.log(JSON.stringify(out, null, 1));
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
