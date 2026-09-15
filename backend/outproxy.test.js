'use strict';
// ============================================================================
// outproxy.test.js — tests del proxy de salida (Burp-style) sin red externa
//
//   * activación con validación (URL válida / inválida / vacía) sobre net.js
//   * persistencia en config.json REDIRIGIDA a un tmp (CONFIG_CANDIDATES)
//   * quitar el proxy restaura la salida directa y limpia la config
//   * sondas de conectividad contra un proxy HTTP REAL local:
//       - proxy vivo      → probe HTTP y CONNECT responden
//       - puerto muerto   → error claro, sin colgar
//   * estado: source correcto (memoria vs config) y respeto de KNK_PROXY env
// ============================================================================

const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

// BD aislada ANTES de cualquier require de módulos que la usen
process.env.KNK_DB = path.join(os.tmpdir(), `outproxy-test-${Date.now()}.db`);

const TMP_CFG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'outproxy-cfg-'));
const TMP_CFG = path.join(TMP_CFG_DIR, 'config.json');

const netMod = require('./lib/net');
const outproxy = require('./lib/outproxy');
const { CONFIG_KEY, CONFIG_CANDIDATES } = outproxy;

// la persistencia del módulo apunta al config real del repo — para el test la
// redirigimos a un tmp sustituyendo la lista de candidatos
CONFIG_CANDIDATES.splice(0, CONFIG_CANDIDATES.length, TMP_CFG);

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}

// ── proxy HTTP real de prueba ────────────────────────────────────────────────
// Acepta GET absoluto (http) y CONNECT (https), como Burp en miniatura.
function startFakeProxy() {
  const server = http.createServer((req, res) => {
    // petición absoluta proxied (http): responder eco del Host
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`proxy-echo host=${req.headers.host || '?'}`);
  });
  server.on('connect', (req, socket) => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    // túnel mínimo: contestamos con un banner y cerramos — basta para que la
    // sonda de CONNECT reciba el 200 y devuelva ok
    setTimeout(() => socket.destroy(), 50);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  console.log('outproxy.test.js');

  // ── 1) estado inicial: sin proxy ──
  netMod.setProxy(null);
  const st0 = outproxy.statusPayload();
  ok('estado inicial: sin proxy activo', () => {
    assert.strictEqual(st0.active, false);
    assert.strictEqual(st0.proxy, null);
  });

  // ── 2) activación con validación ──
  ok('setProxy acepta http://127.0.0.1:8080', () => {
    netMod.setProxy('http://127.0.0.1:8080');
    const st = outproxy.statusPayload();
    assert.strictEqual(st.active, true);
    assert.strictEqual(st.proxy, 'http://127.0.0.1:8080');
  });
  ok('setProxy rechaza esquema no-http', () => {
    assert.throws(() => netMod.setProxy('socks5://127.0.0.1:9050'), /http/);
  });
  ok('setProxy(null) restaura salida directa', () => {
    netMod.setProxy(null);
    assert.strictEqual(outproxy.statusPayload().active, false);
  });

  // ── 3) persistencia en config redirigida ──
  // (se ejerce vía writeConfig interno usando el mount en un router dummy)
  const express = require('express');
  const router = express.Router();
  outproxy.mount(router);
  function call(method, url, body) {
    return new Promise((resolve, reject) => {
      const req = { method, url, body, headers: {} };
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(o) { resolve({ status: this.statusCode, body: o }); },
      };
      const layer = router.stack.find((l) => {
        const r = l.route;
        if (!r) return false;
        if (r.path !== url.replace(/^\//, '/')) return false;
        return Boolean(r.methods[method.toLowerCase()]);
      });
      if (!layer) return reject(new Error(`ruta no montada: ${method} ${url}`));
      Promise.resolve(layer.route.stack[layer.route.stack.length - 1].handle(req, res, () => {}))
        .catch(reject);
    });
  }

  const fake = await startFakeProxy();
  try {
    // activar (persiste en TMP_CFG)
    const act = await call('POST', '/outproxy', { proxy: `http://127.0.0.1:${fake.port}` });
    ok('POST /outproxy activa y persiste', () => {
      assert.strictEqual(act.status, 200);
      assert.strictEqual(act.body.active, true);
      const cfg = JSON.parse(fs.readFileSync(TMP_CFG, 'utf8'));
      assert.strictEqual(cfg[CONFIG_KEY], `http://127.0.0.1:${fake.port}`);
      assert.strictEqual(netMod.getProxy().hostname, '127.0.0.1');
    });

    // estado: source = config (tmp)
    const st1 = await call('GET', '/outproxy', undefined);
    ok('GET /outproxy: source=config tras activar', () => {
      assert.strictEqual(st1.body.active, true);
      assert.ok(st1.body.source.includes('config'), st1.body.source);
    });

    // test de conectividad contra el proxy vivo (HTTP + CONNECT)
    const t1 = await call('POST', '/outproxy/test', {});
    ok('test contra proxy vivo: HTTP y CONNECT ok', () => {
      assert.strictEqual(t1.body.ok, true);
      assert.strictEqual(t1.body.results.http.ok, true, JSON.stringify(t1.body.results.http));
      assert.strictEqual(t1.body.results.https.ok, true, JSON.stringify(t1.body.results.https));
    });

    // test contra un puerto muerto: error claro, sin colgar
    const t2 = await call('POST', '/outproxy/test', { proxy: 'http://127.0.0.1:1' });
    ok('test contra puerto muerto: fallo claro (no cuelga)', () => {
      assert.strictEqual(t2.body.ok, false);
      assert.strictEqual(t2.body.results.http.ok, false);
      assert.ok(t2.body.results.http.error, 'debe incluir mensaje de error');
    });

    // quitar: restaura directa y limpia la config
    const del = await call('DELETE', '/outproxy', undefined);
    ok('DELETE /outproxy restaura salida directa y limpia config', () => {
      assert.strictEqual(del.body.active, false);
      const cfg = JSON.parse(fs.readFileSync(TMP_CFG, 'utf8'));
      assert.strictEqual(cfg[CONFIG_KEY], undefined);
      assert.strictEqual(netMod.getProxy(), null);
    });

    // POST con URL inválida → 400
    const bad = await call('POST', '/outproxy', { proxy: 'no-soy-una-url' });
    ok('POST con URL inválida → 400', () => {
      assert.strictEqual(bad.status, 400);
      assert.strictEqual(bad.body.ok, false);
    });

    // POST vacío → 400
    const empty = await call('POST', '/outproxy', { proxy: '' });
    ok('POST vacío → 400', () => {
      assert.strictEqual(empty.status, 400);
    });
  } finally {
    fake.server.close();
    netMod.setProxy(null);
    try { fs.rmSync(TMP_CFG_DIR, { recursive: true, force: true }); } catch {}
  }

  // ── 4) KNK_PROXY env: el payload lo refleja ──
  process.env.KNK_PROXY = 'http://127.0.0.1:9999';
  netMod.setProxy('http://127.0.0.1:9999');
  const stEnv = outproxy.statusPayload();
  ok('con KNK_PROXY el estado marca source=env', () => {
    assert.strictEqual(stEnv.active, true);
    assert.ok(stEnv.source.startsWith('env'), stEnv.source);
  });
  delete process.env.KNK_PROXY;
  netMod.setProxy(null);

  console.log(`outproxy: ${passed} ok`);
  if (process.exitCode) process.exit(process.exitCode);
})();
