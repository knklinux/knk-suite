'use strict';
// zendesk-widget-clasico.js — Click del launcher del Web Widget clásico en el
// HC real de nuestra instancia, captura de frames reales, storage, perf y
// identificador de conversación (el equivalente del messenger en el widget clásico).
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-widget-clasico.json');

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
  await new Promise(r => setTimeout(r, 12000));

  // click del launcher (el div/iframe del launcher del widget clásico)
  const click = await cmd('script.evaluate', {
    expression: "(() => { const c = document.querySelector('[id*=launcher], [class*=launcher], [data-garden*=launcher], #web-widget, #zEWebLauncher'); if (c) { c.click(); return 'click ' + (c.id || c.className).slice(0, 40); } return 'sin launcher'; })()",
    target: { context: ctx }, awaitPromise: true, resultOwnership: 'none',
  });
  const vClick = click.result && (click.result.result && click.result.result.value || click.result.result);
  console.log('click launcher:', vClick);
  await new Promise(r => setTimeout(r, 15000));

  // árbol completo de frames tras abrir
  const tree = (await cmd('browsingContext.getTree', { maxDepth: 5 })).result.contexts;
  const frames = [];
  const walk = (nodos, out) => { for (const n of nodos || []) { out.push(n.context); if (n.children) walk(n.children, out); } };
  walk(tree, frames);
  const captura = { click_launcher: vClick, frames: [], storage: [] };
  for (const f of frames) {
    const expr = "JSON.stringify({u: location.href.slice(0,160), cookies: document.cookie.slice(0,400), ls: (() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = String(localStorage.getItem(k)).slice(0, 250); } return o; })()})";
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: f }, awaitPromise: true, resultOwnership: 'none' }).catch(() => null);
    const v = ev && ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    try { const p = JSON.parse(v); captura.frames.push(p.u); if (Object.keys(p.ls || {}).length || (p.cookies || '').length > 10) captura.storage.push(p); } catch (e) {}
  }
  // perf del top (endpoints de conversación)
  const perf = await cmd('script.evaluate', {
    expression: "JSON.stringify(performance.getEntriesByType('resource').map(e => e.name).filter(u => /conversation|sunco|smooch|zopim|chat|message/i.test(u)).slice(0, 25))",
    target: { context: ctx }, awaitPromise: true, resultOwnership: 'none',
  }).catch(() => null);
  const vPerf = perf && perf.result && (perf.result.result && perf.result.result.value || perf.result.result);
  try { captura.endpoints_conversacion = JSON.parse(vPerf); } catch (e) { captura.endpoints_conversacion = []; }

  const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'zendesk-widget-abierto-clasico.png'), Buffer.from(shot.result.data, 'base64'));
  fs.writeFileSync(OUT, JSON.stringify(captura, null, 1));
  console.log('frames tras abrir:', captura.frames.length);
  captura.frames.forEach(f => console.log('  ', f));
  console.log('endpoints conversación:', JSON.stringify(captura.endpoints_conversacion).slice(0, 500));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
