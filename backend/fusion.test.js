'use strict';

// fusion.test.js — Fusión 21/09: dashboard UNION con FROM, presets incl.
// Intigriti, triage de hallazgos y guard anti-SSRF de recon-hub.
// Offline: sin red (los rechazos SSRF ocurren antes de salir).

const assert = require('assert');
const dashboard = require('./lib/dashboard');
const presets = require('./lib/presets');
const bbHub = require('./lib/bb-hub');
const reconHub = require('./lib/recon-hub');

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch((e) => { console.error('  ✗ ' + name + ': ' + e.message); process.exitCode = 1; });
}

(async () => {
  await ok('dashboard UNION trae FROM sessions y FROM reports', () => {
    let last = '';
    dashboard.getStats({ query: (sql) => { last = sql; return []; } });
    assert.match(last, /FROM sessions/);
    assert.match(last, /FROM reports/);
  });

  await ok('dashboard UNION devuelve filas con findings/sesiones/reportes', () => {
    const rows = [
      { type: 'finding', message: 'X', timestamp: '2026-09-21 00:00:00' },
      { type: 'session', message: 'S1', timestamp: '2026-09-20 00:00:00' },
    ];
    const s = dashboard.getStats({ query: () => rows });
    assert.equal(s.recentActivity.length, 2);
    assert.equal(s.recentActivity[0].type, 'finding');
  });

  await ok('presets: 4 incl. intigriti-generico', () => {
    const ids = presets.listPresets().map((p) => p.id);
    for (const id of ['openai-bugcrowd', 'cloudflare-hackerone', 'atlassian-bugcrowd', 'intigriti-generico']) {
      assert.ok(ids.includes(id), 'falta ' + id);
    }
  });

  await ok('presets.apply fija scope + program_name', () => {
    const s = { scope: [], artifacts: {} };
    const r = presets.applyPreset(s, 'openai-bugcrowd');
    assert.equal(r.ok, true);
    assert.ok(s.scope.includes('openai.com'));
    assert.match(s.program_name, /OpenAI/);
  });

  await ok('bb-hub decode responde con ok', () => {
    const g = bbHub.listGuide();
    assert.ok(Array.isArray(g) && g.length > 0);
    const d = bbHub.decode('SGVsbG8=');
    assert.ok(d && typeof d === 'object');
  });

  await ok('recon-hub no devuelve datos para IP literal (sin red)', async () => {
    assert.ok(typeof reconHub.crtshSubs === 'function');
    assert.ok(typeof reconHub.investigate === 'function');
    assert.ok(typeof reconHub.checkTakeoverHub === 'function');
    // 127.0.0.1: o la rechaza validDomain o la frena el guard anti-SSRF;
    // en ningún caso sale a red ni devuelve contactos.
    const r = await reconHub.securityTxt('127.0.0.1');
    assert.ok(!r.contactos, 'una IP literal no debe devolver contactos');
  });

  console.log(`\n${passed} pasaron`);
})();
