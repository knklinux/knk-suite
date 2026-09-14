'use strict';
// zendesk-ekr-snippet.js — Descarga el snippet ekr (loader del messaging) y
// extrae las URLs del backend del widget (websocket + api de conversaciones).
//   node backend/zendesk-ekr-snippet.js
const { abrirCanal } = require('./lib/browser');
const path = require('path'), os = require('os'), fs = require('fs');

const SNIPPET = 'https://static.zdassets.com/ekr/snippet.js?key=7e7de6fa-f07e-4231-8f8d-454e095d1794';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-ekr-snippet-urls.json');

(async () => {
  const canal = await abrirCanal({
    port: 9340,
    perfil: path.join(os.homedir(), '.knk-suite', 'browser-profile', 'zendesk-recon'),
    url: 'about:blank',
  });

  // Función inyectada como expresión simple: sin regex con escapes raros en
  // el shell — usamos split() sobre comillas para extraer URLs.
  const expr = [
    "(async () => {",
    "  const t = await fetch('" + SNIPPET + "').then(r => r.text());",
    "  const trozos = t.split(/['\\\"\\s()]+/);",
    "  const urls = [...new Set(trozos.filter(x => x.startsWith('https://')))].slice(0, 40);",
    "  return JSON.stringify({ len: t.length, urls });",
    "})()",
  ].join('\n');

  const r = await canal.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });

  if (r.exceptionDetails) {
    console.error('Excepción en la página:', r.exceptionDetails.exception.description);
    process.exit(1);
  }
  const texto = typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value);
  console.log(texto);
  fs.writeFileSync(OUT, texto);
  console.log('\nGuardado en: ' + OUT);
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
