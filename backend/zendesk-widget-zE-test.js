'use strict';
// zendesk-widget-zE-test.js — Test definitivo del widget clásico vía su API zE:
// abrir, consultar estado/conversación y volcar TODO el localStorage completo
// (los iframes about:blank del Web Widget heredan el origen del padre — el
// widget vive ahí inyectado, no en un src externo).
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-widget-ze-api.json');

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

  const pasos = {};
  const evaluar = async (nombre, expr) => {
    const ev = await cmd('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' }).catch(e => null);
    const v = ev && ev.result && (ev.result.result && ev.result.result.value !== undefined ? ev.result.result.value : ev.result.result);
    pasos[nombre] = v;
    console.log(nombre + ':', String(v).slice(0, 200));
    return v;
  };

  // 1) estado del widget y apertura por API
  await evaluar('open', "(() => { try { zE('webWidget', 'open'); return 'abierto'; } catch (e) { return 'err: ' + String(e).slice(0,80); } })()");
  await new Promise(r => setTimeout(r, 8000));
  // 2) APIs de estado del widget clásico
  await evaluar('estado', "(() => { try { return JSON.stringify({ isOpen: zE('webWidget:get', 'display') || null, chatLog: (() => { try { const l = zE('webWidget:get', 'chat:log'); return l ? Object.keys(l).slice(0,5) : null; } catch (e) { return 'n/a'; } })(), dept: (() => { try { return zE('webWidget:get', 'chat:department'); } catch (e) { return 'n/a'; } })() }); } catch (e) { return 'err ' + String(e).slice(0,80); } })()");
  // 3) localStorage COMPLETO (sin truncar claves de widget)
  await evaluar('ls-completo', "(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = String(localStorage.getItem(k)).slice(0, 500); } return JSON.stringify(o); })()");
  // 4) cookies completas
  await evaluar('cookies', "document.cookie");
  // 5) iframes con su contentDocument accesible (título interno del widget)
  await evaluar('iframes-doc', "JSON.stringify([...document.querySelectorAll('iframe')].map(f => { let t = null, u = null; try { t = f.contentDocument && f.contentDocument.title; u = f.contentDocument && f.contentDocument.location.href; } catch (e) { t = 'cross-origin'; } return { src: (f.src || 'about:blank').slice(0, 60), doc: u ? u.slice(0, 100) : null, titulo: t }; }))");

  const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'zendesk-widget-ze-api.png'), Buffer.from(shot.result.data, 'base64'));
  fs.writeFileSync(OUT, JSON.stringify({ fecha: new Date().toISOString(), pasos }, null, 1));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
