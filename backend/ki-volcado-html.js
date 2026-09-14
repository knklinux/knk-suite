'use strict';
// ki-volcado-html.js — Volcado del HTML de la página del programa (con login activo)
// y búsqueda del JSON embebido de known issues (React props del portal).
const WebSocket = require('ws');
const fs = require('fs');
async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50*1024*1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p={}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id: i, method: m, params: p})); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout '+m)); } }, 40000); });
  const ses = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
  const ctx = tree.result.contexts[0].context;
  const expr = "document.documentElement.outerHTML.length";
  const r = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
  console.log('HTML len:', r.result.value);
  // buscar menciones de known_issue en el HTML
  const expr2 = "JSON.stringify({ ki: (document.documentElement.outerHTML.match(/known_issue[^\"']{0,70}/g) || []).slice(0, 10), disc: (document.documentElement.outerHTML.match(/disclosures\/[a-f0-9-]{8}/g) || []).slice(0, 12), grupo: (document.documentElement.outerHTML.match(/target_groups\/[a-f0-9-]{36}\/known_issue_stats/g) || []).slice(0, 8) })";
  const r2 = await cmd('script.evaluate', { expression: expr2, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
  console.log(r2.result.value);
  await cmd('session.end', {});
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
