'use strict';

// ============================================================================
// KNK SUITE v2.1 — Smoke test del servidor (sin tráfico a objetivos externos)
// Arranca backend/index.js en un puerto efímero con DB temporal y comprueba:
//   1. /api/health es público (200 sin token)
//   2. Las rutas de API exigen token (401 sin cabecera)
//   3. Con el token efímero del propio backend responden 200
// Modelo de auth actual: token SIEMPRE activo (KNK_API_TOKEN o
// ~/.knk-suite/api-token) vía cookie knk_token o cabecera X-KNK-Token.
// Uso: npm run smoke
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
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;

  // Token efímero que genera/persiste el propio backend (auth.js)
  const { getToken } = require('./lib/auth');
  const authHeaders = { 'x-knk-token': getToken() };

  let failed = 0;

  // 1) /api/health público
  const health = await get(port, '/api/health');
  console.log(`${health.status === 200 ? 'PASS' : 'FAIL'} GET /api/health sin token -> ${health.status} (esperado 200)`);
  if (health.status !== 200) failed++;

  // 2) Auth siempre activa: sin token → 401
  for (const path of ['/api/pipeline/phases', '/api/session', '/api/findings', '/api/status']) {
    const r = await get(port, path);
    const ok = r.status === 401;
    console.log(`${ok ? 'PASS' : 'FAIL'} GET ${path} sin token -> ${r.status} (esperado 401)`);
    if (!ok) failed++;
  }

  // 3) Con token → 200
  for (const [path, expected] of [
    ['/api/pipeline/phases', 200],
    ['/api/session', 200],
    ['/api/findings', 200],
    ['/api/status', 200],
  ]) {
    const r = await get(port, path, authHeaders);
    const ok = r.status === expected;
    console.log(`${ok ? 'PASS' : 'FAIL'} GET ${path} con token -> ${r.status} (esperado ${expected})`);
    if (!ok) failed++;
  }

  server.close();
  try { fs.unlinkSync(process.env.KNK_DB); } catch {}

  console.log(failed === 0 ? 'Smoke server: OK' : `Smoke server: ${failed} fallos`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
