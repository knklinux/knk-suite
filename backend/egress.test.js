'use strict';
// ============================================================================
// egress.test.js — tests del indicador de salida del Dashboard, sin red.
//
//   * matriz de prioridad de resolveMode (burp > tor > sistema > directo)
//   * payload completo con net.setProxy activo/inactivo (proxy real local)
//   * la ruta GET /egress montada responde el shape esperado
//   * detalle: con proxy de la UI el modo es 'burp' aunque el sistema tenga
//     otro proxy — y el detalle distingue UI de env
// ============================================================================

const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.KNK_DB = path.join(os.tmpdir(), `egress-test-${Date.now()}.db`);

const netMod = require('./lib/net');
const egress = require('./lib/egress');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}

(async () => {
  console.log('egress.test.js');

  // ── 1) matriz de prioridad ──
  ok('burp gana sobre todo lo demás', () => {
    const r = egress.resolveMode({
      burp: { active: true, proxy: 'http://127.0.0.1:8080', source: 'UI (tab Labs)' },
      sys: { enabled: true, isTor: true, server: 'socks=127.0.0.1:9050', knkManaged: true },
    });
    assert.strictEqual(r.mode, 'burp');
    assert.strictEqual(r.label, 'PROXY EXTERNO');
  });
  ok('sin burp: tor (sistema enrutado)', () => {
    const r = egress.resolveMode({ burp: { active: false }, sys: { enabled: true, isTor: true, server: 'socks=127.0.0.1:9050' } });
    assert.strictEqual(r.mode, 'tor');
  });
  ok('sin burp ni tor: proxy del sistema', () => {
    const r = egress.resolveMode({ burp: { active: false }, sys: { enabled: true, isTor: false, server: '127.0.0.1:8080' } });
    assert.strictEqual(r.mode, 'system');
  });
  ok('disabled por sistema → directo (enabled manda)', () => {
    const r = egress.resolveMode({ burp: { active: false }, sys: { enabled: false, isTor: false, server: 'socks=127.0.0.1:9050' } });
    assert.strictEqual(r.mode, 'direct');
  });
  ok('sin sistema (Linux sin reg) y sin burp → directo', () => {
    const r = egress.resolveMode({ burp: { active: false }, sys: null });
    assert.strictEqual(r.mode, 'direct');
  });
  ok('proxy del sistema deshabilitado con burp inactivo → directo', () => {
    const r = egress.resolveMode({ burp: { active: false }, sys: { enabled: false, server: null, isTor: false } });
    assert.strictEqual(r.mode, 'direct');
  });

  // ── 2) payload con proxy real activado vía net.setProxy ──
  netMod.setProxy(null);
  const st0 = await egress.statusPayload();
  ok('sin proxy: payload coherente (directo o sistema según el host)', () => {
    assert.ok(['direct', 'system', 'tor'].includes(st0.mode), st0.mode);
    assert.strictEqual(st0.ok, true);
    assert.strictEqual(st0.burp.active, false);
  });

  netMod.setProxy('http://127.0.0.1:18087');
  const st1 = await egress.statusPayload();
  ok('con setProxy: mode=burp y detalle correcto', () => {
    assert.strictEqual(st1.mode, 'burp');
    assert.strictEqual(st1.burp.proxy, 'http://127.0.0.1:18087');
    assert.ok(st1.detail.includes('18087'), st1.detail);
  });
  ok('source refleja UI (no hay KNK_PROXY en el entorno del test)', () => {
    assert.ok(st1.burp.source.includes('UI'), st1.burp.source);
  });
  netMod.setProxy(null);

  // ── 3) ruta montada ──
  const express = require('express');
  const router = express.Router();
  egress.mount(router);
  const layer = router.stack.find((l) => l.route && l.route.path === '/egress');
  ok('GET /egress montado', () => {
    assert.ok(layer, 'no está en el router');
    assert.ok(layer.route.methods.get, 'no es GET');
  });
  await new Promise((resolve) => {
    const req = { method: 'GET', url: '/egress', query: {}, headers: {} };
    const res = {
      json(o) {
        try {
          assert.strictEqual(o.ok, true);
          assert.ok(['direct', 'system', 'tor', 'burp'].includes(o.mode), o.mode);
          assert.ok('tor' in o && 'system' in o && 'burp' in o);
          passed++; console.log('  ok — handler /egress devuelve el shape completo');
        } catch (e) {
          console.error('  FALLO — handler /egress:', e.message); process.exitCode = 1;
        }
        resolve();
      },
      status() { return this; },
    };
    Promise.resolve(layer.route.stack[layer.route.stack.length - 1].handle(req, res, () => {})).catch(() => resolve());
  });

  console.log(`egress: ${passed} ok`);
  if (process.exitCode) process.exit(process.exitCode);
})();
