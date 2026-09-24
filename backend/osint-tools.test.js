'use strict';

// ============================================================================
// Contrato de lib/osint-tools.js SIN red NI instalaciones reales: catálogo,
// validación de targets/args (rechazo de inyección) y estados de instalación.
// Ejecutar: node backend/osint-tools.test.js  (o npm run test:osint-tools)
// ============================================================================

const assert = require('assert');
const tools = require('./lib/osint-tools');

// 1) Catálogo: las 7 herramientas con estrategia y tipo de objetivo definidos
const expected = ['theharvester', 'sherlock', 'spiderfoot', 'social-analyzer', 'amass', 'phoneinfoga', 'sublist3r', 'yt-dlp', 'osmedeus', 'recon-ng', 'maltego-trx'];
assert.deepStrictEqual(tools.TOOLS.map((t) => t.id), expected, 'el catálogo debe tener exactamente las 11 herramientas');
for (const t of tools.TOOLS) {
  assert.ok(['pip-venv', 'git-clone', 'github-release'].includes(t.strategy), `estrategia válida para ${t.id}`);
  assert.ok(['domain', 'username', 'phone', 'ip', 'url', 'none'].includes(t.argType), `argType válido para ${t.id}`);
  assert.ok(Array.isArray(t.argTemplate) && (t.argType === 'none' ? t.argTemplate.length > 0 : t.argTemplate.some((p) => p.includes('{target}'))), `plantilla válida en ${t.id}`);
}
const ids = new Set(tools.TOOLS.map((t) => t.id));
assert.strictEqual(tools.TOOLS.length, ids.size, 'ids únicos');

// 2) Targets válidos por tipo
assert.strictEqual(tools.validTargetFor('domain', 'example.com'), true);
assert.strictEqual(tools.validTargetFor('domain', 'sub.example.com'), true);
assert.strictEqual(tools.validDomain('example.com'), true);
assert.strictEqual(tools.validTargetFor('username', 'john_doe'), true);
assert.strictEqual(tools.validPhone('+34600123456'), true);
assert.strictEqual(tools.validTargetFor('url', 'https://example.com/watch?v=abc'), true);
assert.strictEqual(tools.validTargetFor('url', 'http://sub.ejemplo.org/a/b?x=1'), true);
assert.strictEqual(tools.validTargetFor('none', ''), true);
assert.strictEqual(tools.validTargetFor('none', undefined), true);
for (const badUrl of ['http://127.0.0.1/x', 'http://192.168.1.1/', 'file:///etc/passwd', 'ftp://x.com/a', 'javascript:alert(1)', 'https://u:p@example.com/', 'https://ex ample.com/', 'no-url', '']) {
  assert.strictEqual(tools.validTargetFor('url', badUrl), false, 'url maliciosa debe rechazarse: ' + badUrl);
}
for (const bad of ['example.com/../../etc', '$(whoami)', 'example.com; rm -rf /', 'http://x.com', 'a b', 'x`id`', "a'|b", 'c:\\windows', '..\\..\\x', '', null, 42]) {
  assert.strictEqual(tools.validTargetFor('domain', bad), false, `dominio malicioso debe rechazarse: ${bad}`);
  assert.strictEqual(tools.validTargetFor('username', bad), false, `usuario malicioso debe rechazarse: ${bad}`);
  assert.strictEqual(tools.validTargetFor('phone', bad), false, `teléfono malicioso debe rechazarse: ${bad}`);
}

// 3) Args: rechazo de metacaracteres, control, exceso y configs externas
assert.strictEqual(tools.validateArgs([]), null, 'args vacío es válido');
assert.strictEqual(tools.validateArgs(['--timeout', '20']), null, 'flags simples son válidas');
for (const bad of [['x; y'], ['a&b'], ['a|b'], ['`id`'], ['$(id)'], ['a>b'], ['a<b'], ['--config', '/etc/passwd'], ['--auto'], ['x'.repeat(301)], [1]]) {
  assert.ok(tools.validateArgs(bad), `args maliciosos deben rechazarse: ${JSON.stringify(bad)}`);
}

// 4) Ejecución: targets inválidos no tocan proceso; herramienta desconocida
(async () => {
  const badRun = await tools.execCommand('sherlock', { target: 'a; b' });
  assert.strictEqual(badRun.ok, false);
  const unknown = await tools.execCommand('no-existe', { target: 'ok' });
  assert.strictEqual(unknown.ok, false);
  // Barrera "no instalada" de forma hermética: una herramienta fantasma cuyo
  // binario nunca existirá (sin depender del estado real de cada máquina).
  tools.TOOLS.push({ id: 'fantasma', name: 'Fantasma', strategy: 'github-release', binaryName: `no-existe-${Date.now()}.exe`, argType: 'domain', argTemplate: ['-d', '{target}'] });
  const ghost = await tools.execCommand('fantasma', { target: 'example.com' });
  assert.strictEqual(ghost.ok, false);
  assert.match(ghost.error, /no instalada/i);

  console.log('osint-tools: OK — catálogo (11), validación de targets/args y barreras de ejecución');
})().catch((e) => { console.error('osint-tools: FAIL', e.message); process.exitCode = 1; });
