'use strict';

// ============================================================================
// KNK SUITE v2 — Integración Docker (ejecuta herramientas en contenedor Kali)
// ============================================================================

const { execSync } = require('child_process');

const CONTAINER = process.env.KNK_KALI_CONTAINER || 'knk-kali';

function isRunning() {
  try {
    const out = execSync(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`, { encoding: 'utf8', timeout: 5000 }).trim();
    return out === 'true';
  } catch { return false; }
}

function exec(tool, args, opts = {}) {
  const timeout = opts.timeoutMs || 120000;
  const cmd = `docker exec ${CONTAINER} ${tool} ${args}`;
  try {
    const out = execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e.stdout || '') + String(e.stderr || '') };
  }
}

function ensureRunning() {
  if (isRunning()) return true;
  try {
    execSync(`docker start ${CONTAINER}`, { encoding: 'utf8', timeout: 30000 });
    return isRunning();
  } catch { return false; }
}

module.exports = { CONTAINER, isRunning, exec, ensureRunning };