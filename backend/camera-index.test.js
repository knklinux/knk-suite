'use strict';

const assert = require('assert');
const { distanceKm, normalize, dedupe } = require('./lib/camera-index');

assert.ok(distanceKm(40.4168, -3.7038, 40.4168, -3.7038) < 0.001);
const first = normalize({ id: 'a', ip: '192.0.2.1', port: 554, lat: 40.4168, lon: -3.7038, timestamp: 'now' }, 'shodan', { lat: 40.4168, lon: -3.7038 });
assert.strictEqual(first.vulnerable, false);
assert.strictEqual(first.authorization, 'not-established');
assert.strictEqual(first.distanceKm, 0);
const duplicateFromOtherSource = { ...first, source: 'other' };
const unique = dedupe([first, duplicateFromOtherSource, normalize({ id: 'b', name: 'public cam' }, 'windy', null)]);
assert.strictEqual(unique.length, 2);
console.log('camera-index: OK');
