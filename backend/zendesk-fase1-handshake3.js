'use strict';
// zendesk-fase1-handshake3.js — Fase 1b (3.ª pasada): visita del Help Center de
// NUESTRA instancia (state=restricted, visible con sesión) donde el widget de
// Messaging carga de forma nativa en el dominio real. Captura de frames, red,
// storage por frame y performance — el handshake completo del visitante.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const HC = 'https://autonomo-49965.zendesk.com/hc/en-us';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-fase1-handshake.json');
const HOST_PROPIOS = /zendesk\.com|zdassets\.com|zopim\.com|zendesk-chat\.com|sunco/;

async function main() {
  const red = [];
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => {
    const j = JSON.parse(d);
    if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); return; }
    if (j.method && j.method.startsWith('network.')) {
      const p = j.params || {}; const req = p.request || {};
      if (req.url && HOST_PROPIOS.test(req.url)) red.push({ ev: j.method, url: req.url.slice(0, 220), method: req.method, status: p.response && p.response.status });
    }
  });
  const cmd = (m, p = {}) => new Promise((r, j2) => {
    const i = ++id; pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 45000);
  });

  await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  await cmd('session.subscribe', { events: ['network.beforeRequest', 'network.responseCompleted'] }).catch(() => {});
  const ctx = (await cmd('browsingContext.getTree', { maxDepth: 1 })).result.contexts[0].context;

  await cmd('browsingContext.navigate', { context: ctx, url: HC, wait: 'complete' });
  await new Promise(r => setTimeout(r, 30000)); // snippet → compose → messenger → websocket

  const tree = (await cmd('browsingContext.getTree', { maxDepth: 5 })).result.contexts;
  const frames = [];
  const walk = (nodos) => { for (const n of nodos || []) { frames.push({ ctx: n.context, url: (n.url || '').slice(0, 200) }); if (n.children) walk(n.children); } };
  walk(tree);

  const storagePorFrame = [];
  for (const f of frames) {
    const ev = await cmd('script.evaluate', {
      expression: `(() => { try {
        const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = String(localStorage.getItem(k)).slice(0, 300); }
        return JSON.stringify({ url: location.href.slice(0,150), cookies: document.cookie.slice(0, 600), localStorage: ls,
          zE: typeof window.zE !== 'undefined',
          conversacion: (typeof window.zE === 'function' ? (() => { try { return zE('messenger:get', 'conversationId') || null; } catch (e) { return null; } })() : null) });
      } catch (e) { return JSON.stringify({ err: String(e).slice(0, 120) }); } })()`,
      target: { context: f.ctx }, awaitPromise: true, resultOwnership: 'none',
    }).catch(() => null);
    const val = ev && ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    if (val) { try { storagePorFrame.push(JSON.parse(val)); } catch (e) {} }
  }

  // abrir messenger también aquí (visitante normal que pulsa el launcher)
  await cmd('script.evaluate', { expression: `(() => { try { if (typeof zE === 'function') zE('messenger', 'open'); } catch (e) {} return 'ok'; })()`, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' }).catch(() => {});
  await new Promise(r => setTimeout(r, 15000));
  const red2 = red.slice(); // snapshot pre-apertura

  const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'zendesk-hc-widget.png'), Buffer.from(shot.result.data, 'base64'));

  const tree2 = (await cmd('browsingContext.getTree', { maxDepth: 5 })).result.contexts;
  const frames2 = [];
  walk(tree2);

  fs.writeFileSync(OUT, JSON.stringify({
    fecha: new Date().toISOString(),
    paginas_visitada: HC,
    frames_inicial: frames.map(f => f.url),
    frames_tras_abrir: frames2.map(f => f.url),
    red: red2.concat(red.slice(red2.length)).slice(0, 120),
    storagePorFrame,
  }, null, 1));
  console.log('frames inicial:', frames.length, '| tras abrir messenger:', frames2.length, '| eventos red:', red2.length + (red.length - red2.length));
  frames2.forEach(f => console.log('  frame:', f.url));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
