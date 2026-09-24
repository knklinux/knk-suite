'use strict';

// ============================================================================
// Test end-to-end de lib/proxy.js con objetivo HTTP local controlado.
// Comprueba: arranque, petición HTTP a través del proxy, historial con cuerpos,
// interceptor (drop + edición de raw), replay y CA servible.
// Ejecutar: node backend/proxy.test.js  (o npm run test:proxy)
// ============================================================================

const http = require('http');
const assert = require('assert');

process.env.KNK_PROXY_ALLOW_PRIVATE = '1'; // el objetivo es loopback controlado

const proxy = require('./lib/proxy');

(async () => {
  // 1) Objetivo local que responde JSON + material para el scanner pasivo
  // (cookie sin flags, pocas cabeceras de seguridad y un secreto "falso")
  const target = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'knktestsid=abc123; Path=/'); // sin HttpOnly/Secure/SameSite
    if (req.url.includes('secreto')) {
      return res.end(JSON.stringify({ ok: true, config: { apiKey: 'AKIAIOSFODNN7EXAMPLE' } })); // gitleaks:allow
    }
    res.end(JSON.stringify({ ok: true, path: req.url, echo: req.headers['x-knk-test'] || null }));
  });
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const tPort = target.address().port;

  // 2) Arranque del proxy (puerto efímero)
  const started = await proxy.start({ port: 0 });
  assert.ok(started.ok && started.port > 0, 'proxy arrancado');
  const pPort = started.port;

  // 3) Petición a través del proxy (request absoluto http://)
  const viaProxy = await new Promise((resolve, reject) => {
    // Absolute-form (como los navegadores hacia un proxy): path = URL absoluta
    const req = http.request({ host: '127.0.0.1', port: pPort, path: `http://127.0.0.1:${tPort}/saludo?x=1`, headers: { 'X-KNK-Test': 'hola' } }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject); req.end();
  });
  assert.strictEqual(viaProxy.status, 200);
  assert.ok(viaProxy.body.includes('"/saludo?x=1"'), 'respuesta del objetivo vía proxy');

  // 4) Historial captura método/URL/status/cuerpos
  const hist = proxy.history({ limit: 10 });
  const hit = hist.entries.find((e) => e.path === '/saludo?x=1');
  assert.ok(hit, 'entrada en historial');
  assert.strictEqual(hit.status, 200);
  assert.ok(hit.resBodyPreview.includes('"ok":true'), 'cuerpo de respuesta capturado');
  const full = proxy.historyEntry(hit.id);
  assert.ok(full.entry.raw.startsWith('GET /saludo?x=1 HTTP/1.1'), 'raw de petición reconstruible');

  // 5) Interceptor ON: la petición se retiene y puede editarse antes de reenviar
  proxy.setIntercept(true);
  const delayed = new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: pPort, path: `http://127.0.0.1:${tPort}/interceptada` }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', () => resolve({ status: 0, body: '' })); req.end();
  });
  await new Promise((r) => setTimeout(r, 300));
  const pend = proxy.pendingList();
  assert.strictEqual(pend.count, 1, 'petición retenida');
  // Editar el raw: añadir cabecera X-KNK-Edited
  const raw = proxy.applyRawEdit(pend.pending[0].raw, 'X-KNK-Test', 'sí');
  proxy.resolvePending(pend.pending[0].id, { action: 'forward', raw });
  const result = await delayed;
  assert.strictEqual(result.status, 200);
  assert.ok(result.body.includes('"echo":"sí"'), 'edición del interceptor llegó al objetivo');
  proxy.setIntercept(false);

  // 6) Interceptor: drop también funciona
  proxy.setIntercept(true);
  const dropped = new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: pPort, path: `http://127.0.0.1:${tPort}/dropme` }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0)); req.end();
  });
  await new Promise((r) => setTimeout(r, 300));
  const pend2 = proxy.pendingList();
  proxy.resolvePending(pend2.pending[0].id, { action: 'drop' });
  assert.strictEqual(await dropped, 502, 'drop → 502 al cliente');
  proxy.setIntercept(false);

  // 7) Replay de la entrada del historial
  const rep = await proxy.replay(hit.id, { raw: full.entry.raw.replace('/saludo?x=1', '/saludo?replay=1') });
  assert.ok(rep.ok && rep.entry.status === 200, 'replay con edición');
  assert.ok(rep.entry.path === '/saludo?replay=1');

  // 8) CA servible y con clave
  const ca = proxy.ensureCA();
  assert.ok(ca.certPem.includes('BEGIN CERTIFICATE') && ca.keyPem.includes('PRIVATE KEY'));

  // 9) Anti-SSRF: sin allowPrivate, loopback bloqueado y replay rechazado
  proxy._state.allowPrivate = false;
  assert.strictEqual(proxy.isPrivateIp('127.0.0.1'), true, '127.0.0.1 detectado como privado');
  assert.strictEqual(proxy.isPrivateIp('::ffff:7f00:1'), true, 'IPv4-mapped IPv6 detectado como privado');
  const blockedReplay = await proxy.replay(hit.id);
  assert.strictEqual(blockedReplay.ok, false, 'replay de host privado rechazado');
  proxy.setScope(['allowed.test']);
  const rejectedScope = proxy.setScope('allowed.test');
  assert.strictEqual(rejectedScope.ok, false, 'scope no-array rechazado');
  assert.deepStrictEqual(proxy.status().scope, ['allowed.test'], 'scope previo conservado');
  proxy.setScope([]);
  proxy._state.allowPrivate = true;

  // Petición a /secreto vía proxy: activa la regla AWS del scanner pasivo
  await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: pPort, path: `http://127.0.0.1:${tPort}/secreto`, headers: {} }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', resolve);
    });
    req.on('error', reject); req.end();
  });

  // ── Scanner pasivo: el objetivo ya sirvió cabeceras/cookies/secretos ──────
  const sc = proxy.scannerStatus();
  assert.ok(sc.hostsMissingHeaders >= 1, 'scanner: host con cabeceras ausentes detectado');
  assert.ok(sc.hostsWithCookieIssues >= 1, 'scanner: cookie sin flags detectada');
  assert.ok(sc.secretsFound >= 1, 'scanner: secreto del objetivo detectado');
  assert.ok(sc.secrets.every((x) => !String(x.redacted).includes('AKIA')), 'scanner: secreto redactado');
  // el sink lo instala routes.js en producción; aquí un colector de prueba
  const scanSink = require('./lib/proxy-scanner');
  const collected = [];
  scanSink.setFindingSink((f) => { collected.push(f); return collected.length; });
  const flushed = proxy.scannerFlush('sess-proxy-test');
  assert.ok(flushed.created >= 3, 'scanner: flush crea hallazgos (headers+cookie+secreto)');
  assert.ok(collected.every((x) => x.details.proxyScan.key), 'scanner: hallazgos con dedup key');
  assert.ok(collected.every((x) => !JSON.stringify(x.details).includes('AKIAIOSFODNN7EXAMPLE')), 'scanner: ningún hallazgo con el secreto en claro');

  target.close(); proxy.stop();
  console.log('proxy: OK — objetivo local, historial, interceptor (edición+drop), replay, CA, barrera privada y scanner pasivo');
  process.exit(0);
})().catch((e) => { console.error('proxy: FAIL', e.message); process.exit(1); });
