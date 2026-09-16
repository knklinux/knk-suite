'use strict';
// ============================================================================
// oast.test.js — tests del OAST integrado, SIN red externa.
//
// Monta un servidor interactsh de fixture en localhost que habla el protocolo
// real (register → guarda clave pública; poll → cifra con AES-256-CTR + RSA-
// OAEP la interacción). Se verifican:
//   * zbase32 (vector: 5 bytes a cero → 'yyyyyyyy', alfabeto canónico)
//   * descifrado round-trip AES-CTR + RSA-OAEP-SHA256
//   * registro contra el fixture (y fallback al siguiente servidor si el
//     primero falla, como con la lista pública)
//   * generación de payloads con formato interactsh (cid+nonce.host)
//   * poll que entrega una interacción cifrada → correlación con el payload,
//     hit registrado y hallazgo creado con evidencia en disco
//   * idempotencia: segundo golpe del mismo payload → MISMO hallazgo, +1 hit
//   * convertHitManually con autoCreateFindings desactivado
// ============================================================================

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.KNK_DB = path.join(os.tmpdir(), `oast-test-${Date.now()}.db`);

const oast = require('./lib/oast');
const db = require('./db');

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FALLO — ${name}: ${e.message}`); process.exitCode = 1; }
}

// ── fixture de servidor interactsh (protocolo real, localhost) ──────────────
const registry = new Map(); // cid → { publicKeyPem }
const hitsQueue = [];       // interacciones a entregar en el próximo poll

function makeServer(port = 0) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/register' && req.method === 'POST') {
      let b = '';
      req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const { publicKey, secretKey, correlationID } = JSON.parse(b);
        assert.ok(publicKey && secretKey && correlationID, 'register incompleto');
        const pem = Buffer.from(publicKey, 'base64').toString('utf8');
        assert.ok(pem.includes('PUBLIC KEY'), 'publicKey debe ser PEM SPKI b64');
        registry.set(correlationID, { publicKeyPem: pem });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'registration successful' }));
      });
      return;
    }
    if (url.pathname === '/poll') {
      const cid = url.searchParams.get('id');
      const entry = registry.get(cid);
      if (!entry) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'correlation id not found' })); return; }
      const interactions = hitsQueue.splice(0, hitsQueue.length);
      const data = interactions.map((it) => {
        const aesKey = crypto.randomBytes(32);
        const encryptedKey = crypto.publicEncrypt({ key: entry.publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-ctr', aesKey, iv);
        const enc = Buffer.concat([iv, cipher.update(Buffer.from(JSON.stringify(it))), cipher.final()]);
        return { aesKey: encryptedKey.toString('base64'), data: enc.toString('base64') };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: data.map((d) => d.data), aesKey: data[0] ? data[0].aesKey : null, extra: [], tldData: [] }));
      return;
    }
    if (url.pathname === '/deregister') { registry.delete(url.searchParams.get('id') || ''); res.writeHead(200); res.end('{}'); return; }
    res.writeHead(404); res.end();
  });
}

(async () => {
  console.log('oast.test.js');

  ok('zbase32: 5 bytes a cero → yyyyyyyy (alfabeto canónico)', () => {
    assert.strictEqual(oast.zbase32Encode(Buffer.alloc(5, 0)), 'yyyyyyyy');
  });

  await db.initDB(); // prepara la db temporal para las aserciones de hallazgos

  ok('descifrado round-trip AES-256-CTR + RSA-OAEP-SHA256', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const aesKey = crypto.randomBytes(32);
    const encKey = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey);
    const iv = crypto.randomBytes(16);
    const plain = Buffer.from(JSON.stringify({ protocol: 'dns', 'full-id': 'x' }));
    const c = crypto.createCipheriv('aes-256-ctr', aesKey, iv);
    const enc = Buffer.concat([iv, c.update(plain), c.final()]);
    const dec = oast.decryptInteraction(privateKey.export({ type: 'pkcs1', format: 'pem' }), encKey.toString('base64'), enc.toString('base64'));
    assert.strictEqual(dec.protocol, 'dns');
  });

  // ── servidor de fixture + deps de db temporales ──────────────────────────
  const srv = makeServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oast-ev-'));
  // db REAL (temporal): el hallazgo se inserta donde lo leen las aserciones
  const SESS = db.getOrCreateSession().id;
  const deps = { db, getSession: () => ({ id: SESS }) };

  // ── registro (con fallback: primero un servidor muerto, luego el fixture) ─
  await oast.start({ server: `http://127.0.0.1:1,http://127.0.0.1:${port}`, pollIntervalMs: 60000, autoCreateFindings: true }, deps);
  ok('registro con fallback al segundo servidor de la lista', () => {
    assert.ok(oast._state.session, 'sin sesión tras start');
    assert.ok(oast._state.session.correlationID.length >= 3);
  });

  // ── payloads ──────────────────────────────────────────────────────────────
  const payloads = oast.newPayloads(3);
  ok('3 payloads generados con formato interactsh', () => {
    assert.strictEqual(payloads.length, 3);
    for (const p of payloads) {
      assert.ok(p.domain.indexOf('.127.0.0.1:') !== -1, 'host del fixture en el payload: ' + p.domain);
      assert.ok(p.key.length === oast._state.session.correlationID.length + 13);
      assert.ok(p.httpUrl.startsWith('http://'));
    }
  });

  // ── golpe conocido → hallazgo con evidencia ───────────────────────────────
  const p0 = payloads[0];
  hitsQueue.push({
    protocol: 'dns', 'full-id': p0.key, 'remote-address': '203.0.113.7:53',
    timestamp: new Date().toISOString(),
  });
  const r1 = await oast.pollOnce(deps);
  ok('poll entrega el golpe cifrado y lo correlaciona', () => {
    assert.strictEqual(r1.new, 1);
    const hit = oast.listHits()[0];
    assert.strictEqual(hit.payloadId, p0.id);
    assert.strictEqual(hit.unknown, false);
    assert.strictEqual(hit.remoteAddress, '203.0.113.7:53');
  });

  let findingId = null;
  ok('golpe → hallazgo OAST creado automáticamente', () => {
    const findings = db.getFindings(SESS);
    const f = findings.find((x) => x.type === 'OAST');
    assert.ok(f, 'no hay hallazgo OAST');
    findingId = f.id;
    assert.ok(/OOB DNS confirmado/.test(f.summary), 'summary: ' + f.summary);
    assert.strictEqual(f.severity, 'medium');
    assert.strictEqual(f.details.oastPayload, p0.domain);
    assert.ok(f.details.evidence.length === 1 && fs.existsSync(f.details.evidence[0]), 'evidencia en disco');
    assert.ok(fs.readFileSync(f.details.evidence[0], 'utf8').includes('203.0.113.7'), 'evidencia con la IP remota');
  });

  // ── segundo golpe del mismo payload → MISMO hallazgo, +1 interacción ─────
  hitsQueue.push({ protocol: 'http', 'full-id': p0.key, 'remote-address': '203.0.113.8:80', timestamp: new Date().toISOString(), 'raw-request': 'GET / HTTP/1.1' });
  await oast.pollOnce(deps);
  ok('segundo golpe: mismo hallazgo acumulado (no duplicado)', () => {
    const f = db.getFinding(SESS, findingId);
    assert.strictEqual(f.details.hits, 2);
    assert.strictEqual(f.details.interactions.length, 2);
    const oastFindings = db.getFindings(SESS).filter((x) => x.type === 'OAST');
    assert.strictEqual(oastFindings.length, 1, 'solo un hallazgo OAST en la sesión');
  });

  // ── golpe de otra sesión (cid ajeno) → unknown, sin hallazgo ─────────────
  hitsQueue.push({ protocol: 'smtp', 'full-id': 'otrocid12345678901234567', 'remote-address': '1.1.1.1' });
  await oast.pollOnce(deps);
  ok('cid ajeno → hit unknown, sin hallazgo nuevo', () => {
    const hit = oast.listHits()[0];
    assert.strictEqual(hit.unknown, true);
    assert.strictEqual(hit.payloadId, null);
    assert.strictEqual(db.getFindings(SESS).filter((x) => x.type === 'OAST').length, 1);
  });

  // ── modo manual: autoCreateFindings=false + convertHitManually ───────────
  const st = oast.status();
  oast._state.autoCreateFindings = false;
  const p1 = oast.newPayloads(1)[0];
  hitsQueue.push({ protocol: 'ldap', 'full-id': p1.key, 'remote-address': '10.0.0.9:389' });
  await oast.pollOnce(deps);
  const hit2 = oast.listHits()[0];
  ok('modo manual: el golpe no crea hallazgo solo', () => {
    assert.strictEqual(hit2.findingId, null);
    assert.strictEqual(db.getFindings(SESS).filter((x) => x.type === 'OAST').length, 1);
  });
  const conv = oast.convertHitManually(hit2.id, deps);
  ok('convertHitManually crea el hallazgo con evidencia', () => {
    assert.ok(conv.findingId);
    const f = db.getFinding(SESS, conv.findingId);
    assert.strictEqual(f.details.protocol, 'ldap');
    assert.ok(fs.existsSync(f.details.evidence[0]));
  });

  // ── status coherente ──────────────────────────────────────────────────────
  ok('status refleja payloads/hits/errores', () => {
    const s = oast.status();
    assert.strictEqual(s.registered, true);
    assert.ok(s.payloads >= 4);
    assert.ok(s.hits >= 4);
  });

  await oast.stop({ keepPayloads: false });
  srv.close();

  // limpieza de evidencia del tmp y del estado real del usuario
  fs.rmSync(dir, { recursive: true, force: true });
  try { fs.rmSync(path.join(os.homedir(), '.knk-suite', 'oast-state.json'), { force: true }); } catch { /* nada */ }

  console.log(`oast.test.js: ${passed} ok`);
  process.exit(process.exitCode || 0);
})();
