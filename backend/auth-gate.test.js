'use strict';
// ============================================================================
// auth-gate.test.js — AUDITORÍA del gate de token sobre TODAS las rutas de /api
//
// El gate vive en UN middleware de index.js montado en '/api' antes de ambos
// routers (main + cámaras públicas). Ese diseño cubre automáticamente cualquier
// ruta nueva — este test lo demuestra en lugar de suponerlo:
//
//   1. Lee el stack real de Express y extrae TODAS las rutas montadas bajo
//      /api (main router + public-webcams-router), con su método.
//   2. Golpea cada una SIN token: todas deben responder 401.
//   3. La única superficie pública permitida es exactamente GET /api/health:
//      subrutas y otros métodos → 401.
//   4. Con token, una muestra de rutas de lectura responde 200.
//   5. authorize() rechaza sockets no-loopback aunque traigan token.
//
// Si alguien montara un router antes del gate, sus rutas responderían 200/302
// aquí y el test reventaría. Cero tráfico externo (KNK_OFFLINE=1).
// ============================================================================

process.env.KNK_DB = `/tmp/knk-gate-${process.pid}.db`;
process.env.KNK_OFFLINE = '1';
process.env.KNK_PORT = '0';

const assert = require('assert');
const http = require('http');

let passed = 0;
const failures = [];
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); }
  else { failures.push(name); console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); }
}

function request(port, method, url, headers = {}) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path: url, method, headers, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    r.on('error', (e) => resolve({ status: 0, headers: {}, err: String(e.message) }));
    if (method !== 'GET' && method !== 'HEAD') r.write('{}');
    r.end();
  });
}

(async () => {
  const { app, server } = require('./index');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const auth = require('./lib/auth');
  const TOK = auth.getToken();
  const H = { 'x-knk-token': TOK };

  // ── 1) Inventario dinámico de rutas montadas bajo /api ────────────────────
  const apiLayers = app._router.stack.filter(
    (l) => l.name === 'router' && l.regexp && l.regexp.test('/api/x')
  );
  ok('hay routers montados bajo /api', apiLayers.length >= 2, `${apiLayers.length} routers`);

  const routes = [];
  for (const layer of apiLayers) {
    for (const sub of layer.handle.stack) {
      if (!sub.route) continue;
      const method = Object.keys(sub.route.methods || { get: 1 })[0].toUpperCase();
      routes.push({ method, path: '/api' + sub.route.path });
    }
  }
  ok('inventario con suficientes rutas', routes.length > 100, `${routes.length} rutas encontradas`);

  // ── 2) TODAS las rutas sin token → 401 (salvo GET /health → 200) ─────────
  let gated = 0; let leaked = [];
  for (const { method, path } of routes) {
    const isPublic = method === 'GET' && path === '/api/health';
    const expected = isPublic ? 200 : 401;
    const r = await request(port, method, path);
    if (r.status === expected) { if (!isPublic) gated++; continue; }
    leaked.push(`${method} ${path} → ${r.status}${r.err ? ' (' + r.err + ')' : ''} (esperado ${expected})`);
  }
  ok('TODAS las rutas sin token responden 401', leaked.length === 0,
    `${gated} rutas gated${leaked.length ? ' · FILTRAN: ' + leaked.slice(0, 5).join(' | ') : ''}`);
  const health = routes.find((r) => r.path === '/api/health' && r.method === 'GET');
  ok('GET /api/health sigue público', !!health && !leaked.some((l) => l.includes('/api/health') && l.includes('esperado 200')));

  // ── 3) La superficie pública es EXACTAMENTE GET /api/health ──────────────
  ok('GET /api/health/sub → 401', (await request(port, 'GET', '/api/health/sub')).status === 401);
  ok('POST /api/health → 401', (await request(port, 'POST', '/api/health')).status === 401);
  ok('GET /api/health con token → 200', (await request(port, 'GET', '/api/health', H)).status === 200);

  // ── 4) Con token, muestra de lectura → 200 ───────────────────────────────
  for (const p of ['/api/session', '/api/findings', '/api/cameras/public/sources']) {
    const r = await request(port, 'GET', p, H);
    ok(`GET ${p} con token → 200`, r.status === 200, `got ${r.status}`);
  }

  // ── 5) authorize() rechaza sockets externos y tokens inválidos ───────────
  ok('socket NO loopback → rechazado aunque haya token',
    auth.authorize({ headers: { 'x-knk-token': TOK }, socket: { remoteAddress: '192.168.1.50' } }) === false);
  ok('token inválido → rechazado',
    auth.authorize({ headers: { 'x-knk-token': 'deadbeef'.repeat(6) }, socket: { remoteAddress: '127.0.0.1' } }) === false);
  ok('sin credenciales → rechazado',
    auth.authorize({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }) === false);

  server.close();
  try { require('fs').unlinkSync(process.env.KNK_DB); } catch {}

  console.log(failures.length === 0
    ? `\nauth-gate: OK — ${routes.length} rutas auditadas, solo GET /api/health pública`
    : `\nauth-gate: ${failures.length} fallos`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
