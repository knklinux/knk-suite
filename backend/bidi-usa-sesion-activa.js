'use strict';
// bidi-usa-sesion-activa.js — Reutiliza la sesión BiDi ya activa (sin session.new)
//   node backend/bidi-usa-sesion-activa.js 'EXPR_JS'
const WebSocket = require('ws');
async function main() {
  const expr = process.argv[2];
  if (!expr) { console.error('falta expr'); process.exit(1); }
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50*1024*1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p={}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id: i, method: m, params: p})); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout '+m)); } }, 60000); });
  // listar contextos sin crear sesión: getTree requiere sesión... probamos con evaluación directa
  // Firefox: si "Session already started", el primer comando tras conectar usa la sesión implícita
  const r = await cmd('script.evaluate', { expression: expr, target: { context: 'top' }, awaitPromise: true, resultOwnership: 'none' })
    .catch(async e => {
      // fallback: intentar con browsingContext.getTree primero
      const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
      const ctx = tree.result.contexts[0].context;
      return cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    });
  console.log(JSON.stringify(r.result).slice(0, 5000));
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
