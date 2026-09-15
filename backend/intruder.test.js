'use strict';

// ============================================================================
// intruder.test.js — tests sin red del fuzzer pequeño (acoplado al Repeater)
//
// Se inyecta un motor sendRaw FALSO (el real respeta scope+limiter y eso lo
// cubren auth-gate/CI contra el servidor real). Así ejercitamos la lógica
// pura: caps, dedup, plan, multi-posición, baseline, workers, anomalías y
// export a hallazgo. db.js es sql.js (WASM): exige initDB() y la FK de
// findings exige que la run corra bajo la sesión REAL de esa BD.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

// BD aislada ANTES de cualquier require que toque db.js
const TMPD = fs.mkdtempSync(path.join(os.tmpdir(), 'knk-intruder-test-'));
process.env.KNK_DB = path.join(TMPD, 'test.db');

const engine = require('./lib/repeater');

// ── Motor inyectable ────────────────────────────────────────────────────────
// La impl ACTIVA se cambia con setEngine() — una sola instancia del módulo
// intruder en todo el proceso (los runs Map son del módulo).
let sendRawImpl = async () => ({ ok: false, error: 'motor no configurado' });
function setEngine(fn) { sendRawImpl = fn; }

const SUT_PATH = require.resolve('./lib/intruder');
delete require.cache[SUT_PATH];
const origRequire = Module.prototype.require;
Module.prototype.require = function patched(id) {
  if (id === './repeater') {
    return { ...engine, sendRaw: (session, raw, opts) => sendRawImpl(session, raw, opts) };
  }
  return origRequire.apply(this, arguments);
};
const t = require(SUT_PATH);
Module.prototype.require = origRequire;

// ── Fake de envío ───────────────────────────────────────────────────────────
function fakeSend(raw, status, length) {
  return {
    ok: true,
    send: {
      ts: new Date().toISOString(), method: 'GET', url: 'http://t.example/', target: '/',
      requestRaw: raw, requestHeaders: {}, maxRedirects: 0,
      status, statusText: '', length, headers: {}, responseBody: 'x'.repeat(length),
      diffable: { status, length, server: null, contentType: null, location: null, setCookieCount: 0 },
    },
  };
}

// ═══════════════════════════ 1. Parser de posiciones ═══════════════════════
{
  assert.deepStrictEqual(t.extractPositions('GET /?id=§1§ HTTP/1.1'), ['1']);
  assert.deepStrictEqual(t.extractPositions('GET /?a=§x§&b=§y§ HTTP/1.1'), ['x', 'y']);
  assert.deepStrictEqual(t.extractPositions('GET /?a=§§ HTTP/1.1'), [''], 'posición vacía permitida');
  assert.deepStrictEqual(t.extractPositions('GET / HTTP/1.1'), [], 'sin § no hay posiciones');
  console.log('  ✓ extractPositions');
}

// ═══════════════ 2. applyPayload (multi-posición) ═══════════════════════════
{
  assert.strictEqual(t.applyPayload('GET /?id=§1§ HTTP/1.1', 0, '999'), 'GET /?id=999 HTTP/1.1');
  assert.strictEqual(
    t.applyPayload('GET /?a=§x§&b=§y§ HTTP/1.1', 1, 'Z'),
    'GET /?a=x&b=Z HTTP/1.1',
    'multi-posición: la no atacada conserva su original y pierde §'
  );
  assert.strictEqual(t.applyPayload('A §k§ B §k§', 0, 'P'), 'A P B k');
  console.log('  ✓ applyPayload');
}

// ═══════════════════════════ 3. Caps y dedup ════════════════════════════════
{
  const many = Array.from({ length: 120 }, (_, i) => 'p' + i).join('\n');
  const parsed = t.parsePayloadSet(many);
  assert.strictEqual(parsed.length, t.MAX_PAYLOADS, 'payloads techo a MAX_PAYLOADS');
  assert.strictEqual(parsed[0], 'p0', 'conserva orden tras dedup');

  const plan = t.buildAttackPlan(parsed, 1);
  assert.strictEqual(plan.length, t.MAX_PAYLOADS, '1 posición: un ataque por payload (50 tras el cap)');
  assert.ok(plan.length <= t.MAX_TOTAL_REQUESTS, 'y siempre bajo el techo absoluto de peticiones');
  assert.ok(plan.every((a) => a.positionIndex === 0));

  const plan2 = t.buildAttackPlan(['a', 'b', 'c', 'd'], 2);
  assert.deepStrictEqual(plan2.map((p) => p.positionIndex), [0, 1, 0, 1]);
  console.log('  ✓ caps duros: 120 payloads → 50, plan ≤ 100; pairwise rota posiciones');
}

// ═══════════════════ 4. Run completa con motor inyectado ════════════════════
(async () => {
  const db = require('./db');
  await db.initDB();
  const SESSION = { id: db.getOrCreateSession().id, scope: [], out_of_scope: [] };

  // motor: 200/100 para todo menos id=999 → 500/10000 (anomalía doble)
  setEngine(async (session, raw) => {
    const m = raw.match(/id=(\d+)/);
    const v = m ? Number(m[1]) : 0;
    if (v === 999) return fakeSend(raw, 500, 10000);
    return fakeSend(raw, 200, 100);
  });

  const raw = 'GET /api/item?id=§1§ HTTP/1.1\nHost: t.example\n\n';
  const started = await t.startRun(SESSION, { raw, payloadText: '1\n2\n3\n999\n4\n5\n6\n7' });
  assert.strictEqual(started.ok, true, 'run arranca');
  assert.strictEqual(started.run.totalRequests, 8);
  assert.strictEqual(started.run.status, 'running');

  let run = started.run;
  for (let i = 0; i < 100 && run.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 50));
    run = t.getRun(SESSION.id, run.id);
  }
  assert.strictEqual(run.status, 'completed', 'run completa');
  assert.strictEqual(run.completedRequests, 8);
  assert.strictEqual(run.results.length, 8);
  assert.ok(run.baseline, 'baseline capturado');
  assert.strictEqual(run.baseline.status, 200, 'baseline: petición sin § (id=1)');
  assert.ok(run.anomalies.minorityStatus.includes(500), 'status 500 minoritario detectado');
  assert.ok(
    run.anomalies.lengthOutliers.some((o) => o.payload === '999'),
    'outlier de longitud detectado para 999'
  );
  console.log('  ✓ run completa + baseline + anomalías');

  // export a hallazgo (misma sesión → FK satisfecha) y verificación en BD
  // sin nota → el summary es la plantilla con el payload
  const f = t.toFinding(SESSION.id, run.id, 3);
  assert.strictEqual(f.ok, true, 'export a hallazgo');
  assert.ok(f.finding.summary.includes('[Intruder]'), 'plantilla [Intruder] en el summary');
  assert.ok(f.finding.summary.includes('999'), 'el payload exportado es el 999');
  // con nota → la nota manda (mismo criterio que el Repeater)
  const fn = t.toFinding(SESSION.id, run.id, 3, 'nota de prueba');
  assert.strictEqual(fn.finding.summary, 'nota de prueba');
  const stored = db.getFindings(SESSION.id);
  assert.strictEqual(stored.length, 2, 'los dos exports persistidos');
  assert.ok(stored.some((x) => x.summary && x.summary.includes('[Intruder]')), 'la plantilla está en la BD');
  assert.ok(stored.some((x) => x.summary === 'nota de prueba'), 'la nota está en la BD');
  assert.strictEqual(t.toFinding(SESSION.id, run.id, 999).ok, false, 'índice inexistente → error limpio');
  console.log('  ✓ export a hallazgo persistido en BD');

  // ═══════════════════ 5. Abort a mitad de run ══════════════════════════════
  setEngine(async (session, raw2) => {
    await new Promise((r) => setTimeout(r, 120));
    return fakeSend(raw2, 200, 10);
  });
  const s2 = await t.startRun(SESSION, { raw: 'GET /?id=§1§ HTTP/1.1\nHost: t.example\n\n', payloadText: '1\n2\n3\n4\n5\n6\n7\n8' });
  assert.strictEqual(s2.ok, true);
  await new Promise((r) => setTimeout(r, 400)); // garantiza ≥1 retorno de 120ms antes del abort
  const ab = t.abortRun(SESSION.id, s2.run.id);
  assert.strictEqual(ab.ok, true, 'abort aceptado');
  assert.strictEqual(ab.run.status, 'aborted');

  let final = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 50));
    final = t.getRun(SESSION.id, s2.run.id);
    if (final.status !== 'running') break; // aborted (workers aún en vuelo) o completed
  }
  assert.ok(final.completedRequests < final.totalRequests, 'el abort evitó completar todas las peticiones');
  assert.ok(final.completedRequests > 0, 'pero alguna ya había volado (comportamiento esperado)');
  assert.strictEqual(t.abortRun(SESSION.id, s2.run.id).ok, false, 'abort doble rechazado');
  console.log(`  ✓ abort a mitad de run: ${final.completedRequests}/${final.totalRequests} completadas`);

  fs.rmSync(TMPD, { recursive: true, force: true });
  console.log('\nintruder: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
