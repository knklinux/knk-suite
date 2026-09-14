'use strict';
// zendesk-hc-snippet-check.js — ¿El HC de la instancia incluye el snippet del
// widget? Qué scripts de zendesk carga y qué iframes existen tras la carga.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-hc-snippet-check.json');

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
  await cmd('browsingContext.navigate', { context: ctx, url: 'https://autonomo-49965.zendesk.com/hc/es', wait: 'complete' });
  await new Promise(r => setTimeout(r, 15000));
  const expr = "JSON.stringify({url: location.href.slice(0,120), scripts: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => /zdassets|zendesk|zopim/.test(s)).slice(0,10), iframes: [...document.querySelectorAll('iframe')].map(f => (f.src||'(sin src)')).slice(0,10), zE: typeof window.zE, launcher: !!document.querySelector('[id*=launcher], [class*=launcher], [data-garden*=launcher]')})";
  const ev = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
  const v = ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
  const p = JSON.parse(v);
  fs.writeFileSync(OUT, JSON.stringify(p, null, 1));
  console.log(JSON.stringify(p, null, 1));
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
