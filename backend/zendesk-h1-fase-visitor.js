'use strict';
// zendesk-h1-fase-visitor.js — H1 fase 1 (visitor A): abrir el widget, enviar
// el mensaje marcador SYNTHETIC-Z-CONV-A-<ts> y capturar el conversation_id
// real del storage del widget (clave *.conversationId o el que aparezca tras
// el envío). Evidencia: zendesk-h1-visitor-a.json + pantallazo.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const MARCADOR = 'SYNTHETIC-Z-CONV-A-' + Date.now();
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-h1-visitor-a.json');

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
    pasos[nombre] = v; console.log(nombre + ':', String(v).slice(0, 160));
    return v;
  };

  // 1) abrir el widget por API
  await evaluar('open', "(() => { try { zE('webWidget', 'open'); return 'abierto'; } catch (e) { return 'err:' + String(e).slice(0,60); } })()");
  await new Promise(r => setTimeout(r, 6000));

  // 2) buscar el input de mensaje dentro de TODOS los iframes (incluidos about:blank
  //    con mismo origen — el widget clásico los inyecta) y escribir el marcador
  const exprEscribir = "(() => { const out = []; const frames = [window].concat(Array.from(document.querySelectorAll('iframe')).map(f => { try { return f.contentWindow; } catch (e) { return null; } })); for (const w of frames) { if (!w) continue; try { const d = w.document; const input = d.querySelector('textarea, [contenteditable=true], input[type=text]'); if (input) { input.focus(); if (input.contentEditable === 'true') { input.textContent = '" + MARCADOR + "'; } else { input.value = '" + MARCADOR + "'; input.dispatchEvent(new Event('input', {bubbles: true})); } const btn = [...d.querySelectorAll('button')].find(b => /send|enviar/i.test(b.getAttribute('aria-label') || '') || /send|enviar/i.test(b.innerText || '')); if (btn) { btn.click(); out.push('enviado-via-boton'); } else { input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', keyIdentifier: 'Enter', bubbles: true })); out.push('enter-disparado'); } } } catch (e) { out.push('cross: ' + String(e).slice(0, 40)); } } return JSON.stringify(out); })()";
  await evaluar('escribir', exprEscribir);
  await new Promise(r => setTimeout(r, 12000));

  // 3) dump de localStorage de todos los frames accesibles buscando el conversation id
  const exprDump = "(() => { const out = []; const frames = [window].concat(Array.from(document.querySelectorAll('iframe')).map(f => { try { return f.contentWindow; } catch (e) { return null; } })); for (const w of frames) { if (!w) continue; try { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = String(w.localStorage.getItem(k)).slice(0, 200); } out.push({ href: w.location.href.slice(0, 80), ls: o }); } catch (e) {} } return JSON.stringify(out); })()";
  await evaluar('dump', exprDump);

  const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'zendesk-h1-visitor-a.png'), Buffer.from(shot.result.data, 'base64'));
  fs.writeFileSync(OUT, JSON.stringify({ fecha: new Date().toISOString(), marcador: MARCADOR, pasos }, null, 1));
  console.log('GUARDADO:', OUT);
  await cmd('session.end', {}).catch(() => {});
  ws.close(); process.exit(0);
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
