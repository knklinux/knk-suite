'use strict';

// ============================================================================
// KNK SUITE v2 — Integración Docker Kali (usa sg docker si el usuario no
// está en el grupo docker)
// ============================================================================

const { execSync } = require('child_process');

const CONTAINER = process.env.KNK_KALI_CONTAINER || 'knk-kali';

// Detect if we need sg docker (user not in docker group)
let _needsSg = null;
function _dockerCmd() {
  if (_needsSg === null) {
    try {
      execSync('docker ps', { encoding: 'utf8', timeout: 3000, stdio: 'ignore' });
      _needsSg = false;
    } catch {
      _needsSg = true;
    }
  }
  return _needsSg ? 'sg docker -c' : '';
}

function isRunning() {
  try {
    const prefix = _dockerCmd();
    const cmd = prefix
      ? `${prefix} "docker inspect -f '{{.State.Running}}' ${CONTAINER}"`
      : `docker inspect -f '{{.State.Running}}' ${CONTAINER}`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
    return out === 'true';
  } catch { return false; }
}

function exec(tool, args, opts = {}) {
  const timeout = opts.timeoutMs || 120000;
  // Map tool names to Kali binary names
  const toolMap = { httpx: 'httpx-toolkit' };
  const binary = toolMap[tool] || tool;
  const prefix = _dockerCmd();
  const cmd = prefix
    ? `${prefix} "docker exec ${CONTAINER} ${binary} ${args}"`
    : `docker exec ${CONTAINER} ${binary} ${args}`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e.stdout || '') + String(e.stderr || ''), missing: false };
  }
}

function ensureRunning() {
  if (isRunning()) return true;
  try {
    const prefix = _dockerCmd();
    const cmd = prefix
      ? `${prefix} "docker start ${CONTAINER}"`
      : `docker start ${CONTAINER}`;
    execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    return isRunning();
  } catch { return false; }
}

module.exports = { CONTAINER, isRunning, exec, ensureRunning };