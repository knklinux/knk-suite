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
  const timeout = Math.min(opts.timeoutMs || 30000, 30000); // Hard cap at 30s
  const toolMap = { httpx: 'httpx-toolkit' };
  const binary = toolMap[tool] || tool;
  // Simple execSync with spawn-based timeout to avoid hangs
  const dockerExecCmd = `docker exec ${CONTAINER} ${binary} ${args}`;
  const prefix = _dockerCmd();
  const cmd = prefix ? `${prefix} "${dockerExecCmd}"` : dockerExecCmd;
  try {
    const { spawnSync } = require('child_process');
    const [shellCmd, ...shellArgs] = cmd.includes('sg ')
      ? ['sg', 'docker', '-c', dockerExecCmd]
      : ['/bin/sh', '-c', cmd];
    const r = spawnSync(shellCmd, shellArgs, {
      encoding: 'utf8',
      timeout,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = (r.stdout || '').trim();
    if (r.error && !out) throw r.error;
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: String(e.stdout || '') + String(e.stderr || '').slice(0, 500), missing: false };
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