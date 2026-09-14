'use strict';
// zendesk-fase1-canales.js — Fase 1a: extraer el account_key del messaging widget
// desde el Admin Center de la instancia propia (BiDi 9344, sesión admin del trial).
//   node backend/zendesk-fase1-canales.js
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const SUB = 'autonomo-49965.zendesk.com';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-fase1-canales.json');

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

  const evalJSON = async (expr) => {
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    const r = ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    try { return JSON.parse(r); } catch (e) { return { raw: String(r).slice(0, 500), error: ev.result && ev.result.exceptionDetails && 'excepción en página' }; }
  };

  const resultados = [];
  // Candidatos de URL de canales/messaging en Admin Center
  const candidatos = [
    `https://${SUB}/admin/channels/messaging`,
    `https://${SUB}/admin/conversation_channels/messaging`,
    `https://${SUB}/admin/channels`,
  ];

  for (const url of candidatos) {
    await cmd('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
    await new Promise(r => setTimeout(r, 7000));
    const p = await evalJSON(`JSON.stringify({
      url: location.href.slice(0, 160),
      titulo: document.title.slice(0, 80),
      h1: (document.querySelector('h1') || {}).textContent || '',
      texto: document.body.innerText.slice(0, 900),
      links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href)
        .filter(h => h.includes('/admin/') && /(messag|channel|widget|social)/i.test(h)))].slice(0, 20),
      claves: [...new Set((document.documentElement.innerHTML.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []))].slice(0, 10)
    })`);
    resultados.push({ candidato: url, ...p });
    console.log('---', url, '→', p.url, '| h1:', (p.h1 || '').slice(0, 50), '| claves:', (p.claves || []).length);
    if (p.claves && p.claves.length) break;
  }

  const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'zendesk-fase1-canales.png'), Buffer.from(shot.result.data, 'base64'));
  fs.writeFileSync(OUT, JSON.stringify(resultados, null, 1));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
