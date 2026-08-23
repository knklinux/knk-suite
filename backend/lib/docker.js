'use strict';

// ============================================================================
// KNK SUITE v2 — Integración Docker Kali
// Usa sg docker porque el usuario no está en el grupo docker
// spawnSync con timeout hard para evitar bloqueos
// ============================================================================

const { spawnSync } = require('child_process');

const CONTAINER = process.env.KNK_KALI_CONTAINER || 'knk-kali';

let _needsSg = true; // siempre sg en esta máquina

function isRunning() {
  try {
    const r = spawnSync('sg', ['docker', '-c', `docker inspect -f '{{.State.Running}}' ${CONTAINER}`], {
      encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe']
    });
    return r.stdout.trim() === 'true';
  } catch { return false; }
}

function exec(tool, args, opts = {}) {
  const timeout = Math.min(opts.timeoutMs || 10000, 10000); // hard cap 10s
  const toolMap = { httpx: 'httpx-toolkit' };
  const binary = toolMap[tool] || tool;
  const dockerExecCmd = `docker exec ${CONTAINER} ${binary} ${args}`;

  try {
    const r = spawnSync('sg', ['docker', '-c', dockerExecCmd], {
      encoding: 'utf8',
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      killSignal: 'SIGKILL',
    });
    const out = (r.stdout || '').trim();
    if (r.error && !out) return { ok: false, output: '', missing: false };
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e.message || '').slice(0, 200), missing: false };
  }
}

function ensureRunning() {
  if (isRunning()) return true;
  try {
    spawnSync('sg', ['docker', '-c', `docker start ${CONTAINER}`], {
      encoding: 'utf8', timeout: 30000, stdio: 'ignore'
    });
    return isRunning();
  } catch { return false; }
}

module.exports = { CONTAINER, isRunning, exec, ensureRunning };