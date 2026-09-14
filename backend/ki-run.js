'use strict';
// ki-run.js — script persistente con sesión única que acepta la expresión por stdin
// y mantiene el proceso vivo entre reinicios de Firefox.
const WebSocket = require('ws');
const fs = require('fs');
const SERVER_PORT = 9345;
const CHILD_PORT = 9344;

// Mini-servidor HTTP para ejecutar expresiones sin agotar las sesiones BiDi
const http = require('http');
let wsActual = null;
let idCmd = 0;
const pendientes = new Map();

function conectarBiDi() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${CHILD_PORT}/session`, { maxPayload: 50*1024*1024 });
    ws.on('open', () => res(ws));
    ws.on('error', rej);
    ws.on('message', d => {
      const j = JSON.parse(d);
      if (j.id && pendientes.has(j.id)) { pendientes.get(j.id)(j); pendientes.delete(j.id); }
    });
    wsActual = ws;
  });
}

async function main() {
  await conectarBiDi();
  let sesId = null;
  const servidor = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        if (body === 'RELOAD') {
          if (wsActual) wsActual.close();
          await conectarBiDi();
          res.writeHead(200); res.end('recargado');
          return;
        }
        if (body === 'SESSION') {
          const r = await enviar('session.new', { capabilities: { alwaysMatch: {} } });
          sesId = r.result ? r.result.sessionId : null;
          res.writeHead(200); res.end(JSON.stringify({ sesId }));
          return;
        }
        if (body.startsWith('TREE')) {
          const tree = await enviar('browsingContext.getTree', { maxDepth: 2 });
          res.writeHead(200); res.end(JSON.stringify(tree.result).slice(0, 2000));
          return;
        }
        // formato: CTX<ctx>|EXPR expr
        const [prefijo, ...resto] = body.split('|');
        const expr = resto.join('|');
        const ctx = prefijo.replace('CTX', '');
        const r = await enviar('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true, resultOwnership: 'none' });
        res.writeHead(200);
        res.end(JSON.stringify(r.result).slice(0, 100000));
      } catch (e) {
        res.writeHead(500); res.end('FALLO: ' + e.message);
      }
    });
  });
  servidor.listen(SERVER_PORT);
  console.log('Servidor BiDi persistente en :' + SERVER_PORT);
  // mantener vivo
  setInterval(() => {}, 60000);
}
function enviar(method, params) {
  return new Promise((r, j2) => {
    const i = ++idCmd; pendientes.set(i, r);
    wsActual.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pendientes.has(i)) { pendientes.delete(i); j2(new Error('timeout ' + method)); } }, 90000);
  });
}
main().catch(e => { console.error('FALLO:', e.message); process.exit(1); });
