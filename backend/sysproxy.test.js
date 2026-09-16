'use strict';
// ============================================================================
// sysproxy.test.js — tests del aviso de «proxy del sistema en manos de otro
// programa» del tab Red Tor, sin tocar el registro real.
//
//   * parseSystemProxy (extraído de getSystemProxyState) interpreta fixtures
//     de salida de `reg query` igual que en producción:
//       - disabled  → null
//       - 127.0.0.1:8080 (estilo Burp) → enabled, isTor=false
//       - socks=127.0.0.1:9050 (route-all de KNK) → enabled, isTor=true
//       - registro vacío / enabled sin server → estado con server null
//   * la ruta GET /tor/system-proxy está montada y responde el shape del aviso
//     (montada con express, igual que en producción)
//   * getSystemProxyState añade knkManaged sobre lo que devuelve el parser
// ============================================================================

const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

process.env.KNK_DB = path.join(os.tmpdir(), `sysproxy-test-${Date.now()}.db`);

const tor = require('./lib/tor');
const { router } = require('./routes');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('sysproxy.test.js');

  // ── 1) parseSystemProxy con fixtures de `reg query` ──────────────────────
  const q = (enable, server) => ({
    ProxyEnable: enable ? 'ProxyEnable    REG_DWORD    0x1' : 'ProxyEnable    REG_DWORD    0x0',
    ProxyServer: server === undefined ? null : `ProxyServer    REG_SZ    ${server}`,
    ProxyOverride: null,
  });

  ok('proxy desactivado → null', () => {
    assert.strictEqual(tor.parseSystemProxy(q(false, '127.0.0.1:8080')), null);
  });

  ok('estilo Burp 127.0.0.1:8080 → enabled, no-Tor', () => {
    const s = tor.parseSystemProxy(q(true, '127.0.0.1:8080'));
    assert.deepStrictEqual(
      { enabled: s.enabled, server: s.server, isTor: s.isTor },
      { enabled: true, server: '127.0.0.1:8080', isTor: false },
    );
  });

  ok('estilo route-all socks=127.0.0.1:9050 → isTor', () => {
    const s = tor.parseSystemProxy(q(true, 'socks=127.0.0.1:9050'));
    assert.strictEqual(s.isTor, true);
    assert.strictEqual(s.enabled, true);
  });

  ok('registro sin ProxyServer pero enabled → server null, estado no-null', () => {
    const s = tor.parseSystemProxy(q(true, undefined));
    assert.strictEqual(s.enabled, true);
    assert.strictEqual(s.server, null);
    assert.strictEqual(s.isTor, false);
  });

  ok('null crudo (sin reg / no-Windows) → null', () => {
    assert.strictEqual(tor.parseSystemProxy(null), null);
  });

  ok('getSystemProxyState (live) añade knkManaged al estado del parser', () => {
    const s = tor.getSystemProxyState();
    if (s === null) return; // máquina sin proxy del sistema: nada que afirmar
    assert.ok(typeof s.knkManaged === 'boolean');
    assert.ok(typeof s.enabled === 'boolean');
  });

  // ── 2) ruta GET /tor/system-proxy montada (express, como en producción) ──
  await new Promise((resolve) => {
    const app = express();
    app.use('/', router);
    const srv = app.listen(0, '127.0.0.1', async () => {
      try {
        const port = srv.address().port;
        const get = (p2) => new Promise((res2, rej2) => {
          http.get({ host: '127.0.0.1', port, path: p2 }, (r) => {
            let b = '';
            r.on('data', (c) => { b += c; });
            r.on('end', () => res2({ status: r.statusCode, body: b }));
          }).on('error', rej2);
        });

        const r1 = await get('/tor/system-proxy');
        ok('GET /tor/system-proxy responde shape del aviso', () => {
          assert.strictEqual(r1.status, 200);
          const j = JSON.parse(r1.body);
          assert.ok(j.ok === true);
          assert.ok(j.available === true);
          assert.ok('state' in j);
          if (j.state !== null) {
            for (const k of ['enabled', 'server', 'isTor', 'knkManaged']) assert.ok(k in j.state);
          }
        });

        const r2 = await get('/tor/status');
        ok('GET /tor/status sigue funcionando (sin regresión)', () => {
          const j = JSON.parse(r2.body);
          assert.ok(j && typeof j === 'object');
        });

        srv.close(() => resolve());
      } catch (e) { srv.close(); console.error(e); process.exit(1); }
    });
  });

  console.log(`sysproxy.test.js: ${passed} ok`);
})();
