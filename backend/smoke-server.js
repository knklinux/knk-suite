'use strict';

// ============================================================================
// KNK SUITE v2.1 — Smoke test del servidor (sin tráfico a objetivos externos)
// Arranca backend/index.js en un puerto efímero con DB temporal y comprueba
// las rutas principales. Uso: npm run smoke
// ============================================================================

process.env.KNK_DB = `/tmp/knk-smoke-${process.pid}.db`;
process.env.KNK_OFFLINE = '1';
process.env.KNK_PORT = '0';

const http = require('http');
const fs = require('fs');

function get(port, url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, headers }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.end();
  });
}

(async () => {
  const { server } = require('./index');
  // Esperar a que el servidor esté escuchando
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  const checks = [];
  checks.push(['/api/pipeline/phases', 200]);
  checks.push(['/api/session', 200]);
  checks.push(['/api/findings', 200]);
  checks.push(['/api/status', 200]);

  let failed = 0;
  for (const [path, expected] of checks) {
    const r = await get(port, path);
    const ok = r.status === expected;
    console.log(`${ok ? 'PASS' : 'FAIL'} GET ${path} -> ${r.status} (esperado ${expected})`);
    if (!ok) failed++;
  }

  // Comprobación de autenticación cuando hay API key
  process.env.KNK_API_KEY = 'test-key';
  delete require.cache[require.resolve('./index')];
  server.close();
  const { server: server2 } = require('./index');
  await new Promise(resolve => server2.once('listening', resolve));
  const port2 = server2.address().port;
  const unauth = await get(port2, '/api/findings');
  const auth = await get(port2, '/api/findings', { 'x-knk-api-key': 'test-key' });
  console.log(`${unauth.status === 401 ? 'PASS' : 'FAIL'} API key rechaza sin header (${unauth.status})`);
  console.log(`${auth.status === 200 ? 'PASS' : 'FAIL'} API key acepta con header (${auth.status})`);
  if (unauth.status !== 401) failed++;
  if (auth.status !== 200) failed++;

  server2.close();
  try { fs.unlinkSync(process.env.KNK_DB); } catch {}

  console.log(failed === 0 ? 'Smoke server: OK' : `Smoke server: ${failed} fallos`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
