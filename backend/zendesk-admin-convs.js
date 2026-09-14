'use strict';
// zendesk-admin-convs.js — Desde la sesión admin de nuestra instancia, listar
// las conversaciones de messaging (la del visitante con el marcador debe
// aparecer). Candidatos de endpoint + búsqueda del marcador.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const MARCADOR = 'SYNTHETIC-Z-CONV-A-1788820722176';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-admin-convs.json');

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
  await cmd('browsingContext.navigate', { context: ctx, url: 'https://autonomo-49965.zendesk.com/agent/home/tickets', wait: 'complete' });
  await new Promise(r => setTimeout(r, 9000));

  const fetchJSON = async (url, metodo = 'GET', cuerpo = null) => {
    const expr = "(async () => { try { const r = await fetch(" + JSON.stringify(url) + ", { method: " + JSON.stringify(metodo) + ", credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }" + (cuerpo ? ", body: JSON.stringify(" + JSON.stringify(cuerpo) + ")" : '') + " }); return JSON.stringify({ s: r.status, c: (await r.text()).slice(0, 1500) }); } catch (e) { return JSON.stringify({ s: -1, c: String(e).slice(0, 80) }); } })()";
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    try { return JSON.parse(ev.result.result.value); } catch (e) { return { s: -2, c: 'parse' }; }
  };

  const candidatos = [
    '/api/v2/conversations',
    '/api/v2/sunco/conversations',
    '/api/v2/smooch/conversations',
    '/api/v2/chat/conversations',
    '/api/v2/messages',
    '/api/v2/inbox/conversations',
  ];
  const resultados = [];
  for (const c of candidatos) {
    const r = await fetchJSON(c);
    resultados.push({ endpoint: c, status: r.s, cuerpo: r.c.slice(0, 600) });
    console.log(c, '→', r.s, r.c.slice(0, 120));
    await new Promise(x => setTimeout(x, 3000));
  }
  fs.writeFileSync(OUT, JSON.stringify({ fecha: new Date().toISOString(), marcador_buscado: MARCADOR, resultados }, null, 1));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
