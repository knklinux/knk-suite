'use strict';

// ============================================================================
// lan-relay.test.js — tests sin red
//
// Verifican las barreras del relé de la LAN: qué URLs se aceptan, cómo se
// clasifica el content-type de una cámara y que un destino no permitido se
// rechaza ANTES de abrir cualquier socket. Ninguna prueba contacta una cámara.
// ============================================================================

const assert = require('assert');
const http = require('http');

const relay = require('./lib/lan-relay');
const { publicCamerasRouter } = require('./lib/public-webcams-router');

// ── clasificación del content-type ──────────────────────────────────
assert.strictEqual(relay.classifyLocalContentType('image/jpeg'), 'image');
assert.strictEqual(relay.classifyLocalContentType('image/jpeg; charset=binary'), 'image');
assert.strictEqual(relay.classifyLocalContentType('IMAGE/PNG'), 'image');
assert.strictEqual(relay.classifyLocalContentType('multipart/x-mixed-replace; boundary=myboundary'), 'mjpeg');
assert.strictEqual(relay.classifyLocalContentType('text/html'), 'unsupported');
assert.strictEqual(relay.classifyLocalContentType('application/json'), 'unsupported');
assert.strictEqual(relay.classifyLocalContentType(''), 'unknown');
assert.strictEqual(relay.classifyLocalContentType(undefined), 'unknown');

// ── qué se puede relayar y por qué no ───────────────────────────────
assert.strictEqual(relay.relayBlockReason('http://192.168.1.64:8080/stream1'), null);
assert.strictEqual(relay.relayBlockReason('http://10.0.0.9/axis-cgi/mjpg/video.cgi'), null);
assert.strictEqual(relay.relayBlockReason('https://192.168.1.64:8443/ISAPI/Streaming/channels/101/picture'), null);

assert.ok(/VLC/.test(relay.relayBlockReason('rtsp://192.168.1.64:554/Streaming/Channels/101')));
assert.ok(/privada/.test(relay.relayBlockReason('http://8.8.8.8:8080/video')), 'nunca una IP pública');
assert.ok(/privada/.test(relay.relayBlockReason('http://127.0.0.1:8086/api/status')), 'nunca loopback');
assert.ok(/privada/.test(relay.relayBlockReason('http://169.254.169.254/latest/meta-data')), 'nunca metadata cloud');
assert.ok(/puerto/.test(relay.relayBlockReason('http://192.168.1.64:8081/video')), 'fuera de los puertos de cámara');
assert.ok(/puerto/.test(relay.relayBlockReason('http://192.168.1.64:22/')), 'SSH jamás');
assert.ok(/credenciales/.test(relay.relayBlockReason('http://admin:12345@192.168.1.64:8080/video')));
assert.ok(relay.relayBlockReason('no-es-una-url') !== null);
assert.ok(relay.relayBlockReason('') !== null);

// ── rechazo sin abrir sockets ──────────────────────────────────────
function fakeRes() {
  return {
    status: null,
    body: null,
    headers: {},
    headersSent: false,
    set(headers) { Object.assign(this.headers, headers); return this; },
    status(code) { this.status = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
    destroy() { this.destroyed = true; },
  };
}

(async () => {
  const rejected = fakeRes();
  const result = await relay.proxyLocalStream('http://8.8.8.8:8080/video', rejected);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(rejected.status, 400, 'un destino no permitido se rechaza sin contactarlo');
  assert.ok(/privada/.test(rejected.body.error));

  // RTSP no pasa del proxy (el aviso "ábrelo en VLC" lo da relayBlockReason,
  // que es lo que consume la UI).
  const badProto = fakeRes();
  const r2 = await relay.proxyLocalStream('rtsp://192.168.1.64:554/live', badProto);
  assert.strictEqual(r2.ok, false);
  assert.ok(/http\(s\)/.test(badProto.body.error));

  const publicSnapshot = await relay.relayLocalSnapshot('http://8.8.8.8:8080/snap.jpg');
  assert.strictEqual(publicSnapshot.ok, false);
  assert.ok(/privada/.test(publicSnapshot.error));

  const loopbackSnapshot = await relay.relayLocalSnapshot('https://127.0.0.1:8443/snap.jpg');
  assert.strictEqual(loopbackSnapshot.ok, false);

  // ── el relé no expone HTML: un panel de administración se corta ───
  // No se puede levantar un servidor en 192.168/16 desde el test sin tocar la
  // red real, así que se comprueba la barrera de clasificación, que es la que
  // decide si se reenvía el cuerpo.
  assert.strictEqual(relay.classifyLocalContentType('text/html; charset=utf-8'), 'unsupported');

  // ── el router expone las rutas del relé ───────────────────────────
  const paths = publicCamerasRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  for (const expected of [
    'GET /cameras/local/stream',
    'GET /cameras/local/relay',
    'GET /cameras/local/check',
    'GET /cameras/public/snapshot',
    'GET /cameras/public/sources',
    'GET /cameras/public',
  ]) {
    assert.ok(paths.includes(expected), `falta la ruta ${expected}`);
  }

  // ── coherente con la validación de public-webcams ─────────────────
  const publicWebcams = require('./lib/public-webcams');
  assert.strictEqual(publicWebcams.validateLocalSnapshotUrl('http://192.168.1.64:8080/x').ok, true);
  assert.strictEqual(publicWebcams.validateLocalSnapshotUrl('http://192.168.1.64:8080/x').url, 'http://192.168.1.64:8080/x');

  console.log('lan-relay: OK');
})().catch((error) => {
  console.error('lan-relay: FALLO —', error.message);
  process.exit(1);
});

// El módulo no debe dejar handles abiertos si todo se rechazó antes de conectar.
process.on('exit', (code) => {
  if (code === 0 && http.globalAgent && http.globalAgent.sockets) {
    const open = Object.keys(http.globalAgent.sockets).length;
    if (open > 0) {
      console.error(`lan-relay: FALLO — quedaron ${open} sockets abiertos`);
      process.exitCode = 1;
    }
  }
});
