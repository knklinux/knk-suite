'use strict';
// e13-estado-panel.js — Consulta el estado del submission del E13 en el panel
// USO: node backend/e13-estado-panel.js
// Requiere: Firefox con login de Bugcrowd activo en puerto BiDi 9344.
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'e13-panel-estado.json');

async function main() {
  const ws = new WebSocket('ws://127.0.0.1:9344/session', { maxPayload: 50*1024*1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0; const pend = new Map();
  ws.on('message', d => { const j = JSON.parse(d); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
  const cmd = (m, p={}) => new Promise((r, j2) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({id: i, method: m, params: p})); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j2(new Error('timeout '+m)); } }, 45000); });
  const ses = await cmd('session.new', { capabilities: { alwaysMatch: {} } });
  const tree = await cmd('browsingContext.getTree', { maxDepth: 1 });
  const ctx = tree.result.contexts[0].context;

  // verificar login
  const exprLogin = "var o={};o.usuario=(document.body.innerText.match(/knk_[A-Za-z0-9_]+/)||[null])[0];o.loginBtn=/hacker login/i.test(document.body.innerText);JSON.stringify(o)";
  const rL = await cmd('script.evaluate', { expression: exprLogin, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
  const login = JSON.parse(rL.result.value);
  if (!login.usuario || login.loginBtn) {
    console.log('SIN-LOGIN — el usuario debe loguearse en la ventana de Firefox primero');
    console.log('login detectado:', JSON.stringify(login));
    await cmd('session.end', {}).catch(()=>{});
    ws.close();
    process.exit(2);
  }
  console.log('Login OK:', login.usuario);

  // navegar al submission del E13
  await cmd('browsingContext.navigate', { context: ctx, url: 'https://bugcrowd.com/submissions/b8370246-cd3f-4446-b074-f9fc05df9d2d', wait: 'complete' });
  await new Promise(r => setTimeout(r, 8000));

  // extraer estado
  const exprEstado = [
    "(function(){",
    "  var t = document.body.innerText;",
    "  var o = {};",
    "  o.url = location.href.slice(0, 120);",
    "  o.titulo = (t.match(/Upload SAS URL[^\n]{0,200}/) || [null])[0];",
    "  o.estados = (t.match(/\b(New|Triaged|Resolved|Closed|Unresolved|Duplicate|Out of Scope|Not Reproducible|Informative|Informational|Awarded|Partial)\b/g) || []).slice(0, 10);",
    "  o.comentariosTriager = (t.match(/(triager|triage|moderator)[^\n]{0,150}/gi) || []).slice(0, 5);",
    "  o.puntos = (t.match(/(\d+)\s*points?/i) || [null])[0];",
    "  o.vrt = (t.match(/(Broken Access Control[^\n]{0,80}|Missing Function Level[^\n]{0,60})/) || [null])[0];",
    "  o.primerasLineas = t.slice(0, 1500);",
    "  return JSON.stringify(o);",
    "})()"
  ].join('\n');
  const rE = await cmd('script.evaluate', { expression: exprEstado, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
  const estado = JSON.parse(rE.result.value);
  fs.writeFileSync(OUT, JSON.stringify(estado, null, 1));
  console.log('ESTADO E13:', JSON.stringify({ estados: estado.estados, puntos: estado.puntos, vrt: estado.vrt, comentarios: estado.comentariosTriager }, null, 1));
  console.log('GUARDADO:', OUT);

  // screenshot
  const shot = await cmd('browsingContext.captureScreenshot', { context: ctx });
  fs.writeFileSync(path.join(__dirname, '..', 'evidencia-poc', 'pantallas', 'e13-panel-estado.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('SCREENSHOT: evidencia-poc/pantallas/e13-panel-estado.png');
  await cmd('session.end', {}).catch(()=>{});
  ws.close();
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
