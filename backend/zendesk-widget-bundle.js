'use strict';
// zendesk-widget-bundle.js — Descarga el bundle del messaging widget de
// Zendesk y extrae dominios + rutas API relevantes para el surface-map.
//   node backend/zendesk-widget-bundle.js
const { abrirCanal } = require('./lib/browser');
const path = require('path'), os = require('os'), fs = require('fs');

const BUNDLE = 'https://static.zdassets.com/z2-sunco-widget/z2-messaging-widget.js';
const OUT = path.join(__dirname, '..', 'evidencia-poc', 'http', 'zendesk-messaging-bundle-rutas.json');

(async () => {
  const canal = await abrirCanal({
    port: 9340,
    perfil: path.join(os.homedir(), '.knk-suite', 'browser-profile', 'zendesk-recon'),
    url: 'about:blank',
  });

  const expr = [
    "fetch('" + BUNDLE + "')",
    '.then(r => r.text())',
    '.then(t => {',
    '  const urls = [...new Set((t.match(/https?:\\/\\/[a-z0-9.-]+\\.[a-z]{2,}[a-z0-9\\/._-]*/gi) || []))];',
    '  const rutas = [...new Set((t.match(/\\/[a-z0-9_-]+(?:\\/[a-z0-9_-]+){1,4}/gi) || []))]',
    "    .filter(p => /api|conversation|message|session|user|agent|auth/i.test(p)).slice(0, 60);",
    "  const dominios = urls.filter(u => /api|realtime|socket|zendesk|zdassets|smooch|sunco/i.test(u)).slice(0, 25);",
    '  return JSON.stringify({ len: t.length, dominios, rutas });',
    '})',
  ].join('\n');

  const r = await canal.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });

  const texto = typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result);
  console.log(texto.slice(0, 2500));
  fs.writeFileSync(OUT, texto);
  console.log('\nGuardado en: ' + OUT);
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
