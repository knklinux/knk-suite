'use strict';

const assert = require('assert');
const { expandCidr, privateIp, DEFAULT_PORTS, auditLocalCameraNetwork, MAX_PORTS } = require('./lib/camera-audit');

assert.strictEqual(privateIp('192.168.1.10'), true);
assert.strictEqual(privateIp('10.0.0.1'), true);
assert.strictEqual(privateIp('172.16.0.1'), true);
assert.strictEqual(privateIp('8.8.8.8'), false);
assert.strictEqual(expandCidr('192.168.1.0/30').length, 4);
assert.throws(() => expandCidr('8.8.8.0/29'), /privadas/);
assert.throws(() => expandCidr('192.168.0.0/16'), /CIDR inválido|256/);
assert.ok(DEFAULT_PORTS.includes(554));

(async () => {
  await assert.rejects(
    () => auditLocalCameraNetwork({ cidr: '192.168.1.0/32' }),
    /autorización/,
  );
  await assert.rejects(
    () => auditLocalCameraNetwork({ cidr: '8.8.8.8/32', authorized: true }),
    /privadas/,
  );
  await assert.rejects(
    () => auditLocalCameraNetwork({ cidr: '192.168.1.0/32', host: '192.168.1.1', authorized: true }),
    /no ambos/,
  );

  const result = await auditLocalCameraNetwork({
    host: '127.0.0.1',
    ports: [554, 554, 0, 70000, ...Array.from({ length: MAX_PORTS }, (_, i) => i + 100)],
    authorized: true,
  });
  assert.strictEqual(result.authorizationConfirmed, true);
  assert.ok(result.ports.length <= MAX_PORTS);
  assert.strictEqual(new Set(result.ports).size, result.ports.length);
  assert.ok(result.cameraCandidates.every((item) => item.vulnerable === false));
  console.log('camera-audit: OK');
})().catch((error) => {
  console.error('camera-audit: FAIL', error.message);
  process.exitCode = 1;
});
