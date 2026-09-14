'use strict';
// zendesk-subdominio.js — Descubre el subdominio exacto del trial de Zendesk
// navegando el portal de cuenta de Zendesk con la sesión del perfil real (BiDi 9344).
//   node backend/zendesk-subdominio.js
// Todo en UNA conexión WebSocket: session.new → getTree → navegar → extraer.
// (Varias conexiones seguidas filtran sesión y bloquean session.new.)
const WebSocket = require('ws');

const DESTINOS = [
  'https://www.zendesk.com/account/',      // cuenta del cliente: lista instancias
  'https://auth.zendesk.com/access/login', // portal de auth (por si hay SSO)
  'https://www.zendesk.com/my-trial/',
];
// subdominios de marketing/infra que NO son instancias de clientes
const MARKETING = /^(virtualevents|cxtrends|support|status|academy|developer|engage|static|download|www|signup|relate|auth|accounts|d1e0akm0bzs8ba|ekr)\./;

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p = {}) => new Promise((r, j2) => {
    const i = ++id; pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout ' + m)); } }, 30000);
  });

  await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  await cmd('session.subscribe', { events: ['browsingContext.load'] });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
  const ctx = tree.result.contexts[0].context;

  const extraer = `
    JSON.stringify({
      url: location.href.slice(0, 160),
      titulo: document.title.slice(0, 70),
      loginForm: !!document.querySelector('input[type=email], input[type=password]'),
      texto: [...new Set(document.body.innerText.match(/[a-z0-9][a-z0-9-]*\\.zendesk\\.com/g) || [])].slice(0, 15),
      links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href)
        .filter(h => /^[a-z]+:\\/\\/[a-z0-9][a-z0-9-]*\\.zendesk\\.com/.test(h) && !h.includes('www.zendesk.com')))].slice(0, 15)
    })`;

  const encontrados = new Set();
  for (const destino of DESTINOS) {
    await cmd('browsingContext.navigate', { context: ctx, url: destino, wait: 'complete' });
    await new Promise(r => setTimeout(r, 6000));
    const ev = await cmd('script.evaluate', { expression: extraer, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
    const val = ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    console.log('---', destino, '---');
    if (typeof val !== 'string') { console.log('(eval sin valor)', JSON.stringify(ev.result).slice(0, 400)); continue; }
    const p = JSON.parse(val);
    // normalizar links a hostname y filtrar marketing
    const hosts = [...p.texto, ...p.links.map(h => h.split('/')[2])].filter(s => s && !MARKETING.test(s));
    hosts.forEach(h => encontrados.add(h));
    console.log(JSON.stringify({ url: p.url, loginForm: p.loginForm, hallados: hosts }, null, 1).slice(0, 900));
    if (hosts.length) break;
  }

  console.log('=== RESULTADO ===');
  console.log(encontrados.size ? [...encontrados].join(', ') : 'SIN INSTANCIA EN PORTAL (probablemente no logueado en zendesk.com)');
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
