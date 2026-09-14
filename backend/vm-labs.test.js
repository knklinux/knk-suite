'use strict';

const assert = require('assert');
const labs = require('./lib/vm-labs');

assert.ok(labs.PROVIDERS.some((provider) => provider.id === 'virtualbox'));
assert.ok(labs.PROVIDERS.some((provider) => provider.id === 'wsl2'));
assert.ok(labs.LAB_CATALOG.some((lab) => lab.id === 'dvwa'));

(async () => {
  const badStart = await labs.start('../host');
  assert.strictEqual(badStart.ok, false);
  const badStop = await labs.stop('vm; shutdown');
  assert.strictEqual(badStop.ok, false);
  console.log('vm-labs: OK');
})().catch((error) => {
  console.error('vm-labs: FAIL', error.message);
  process.exitCode = 1;
});
