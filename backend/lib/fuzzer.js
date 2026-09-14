'use strict';

// ============================================================================
// KNK SUITE v2 — Fuzzer conservador y manual-paced
// ============================================================================

const fs = require('fs');
const path = require('path');
const netMod = require('./net');

const WORDLIST = path.join(__dirname, '..', '..', 'data', 'common.txt');

function loadWordlist() {
  try {
    return fs.readFileSync(WORDLIST, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return ['admin', 'api', 'config', '.env', 'robots.txt', '.git', 'backup', 'login', 'dashboard', 'wp-admin', 'test', 'dev', 'staging', 'tmp', 'upload', 'logs', 'phpinfo.php', 'info.php'];
  }
}

async function fuzz(baseUrl, opts = {}) {
  // El fuzzing de la suite es secuencial y está sujeto al limitador global.
  // La confirmación es deliberadamente obligatoria también en la API de módulo,
  // para que ningún caller interno pueda convertirlo en un escáner automático.
  const maxPaths = Math.min(15, Math.max(1, Number(opts.maxPaths) || 15));
  const pacingBase = { mode: 'manual-confirmation-required', concurrency: 1, rateLimitMs: netMod.getRateLimit(), maxPaths: 15, stoppedReason: 'manual-confirmation-required' };
  if (opts.manualConfirm !== true || opts.scopeApproved !== true) {
    return { tool: opts.tool || 'manual-paced', baseline: null, total: 0, requestsMade: 0, findings: [], pacing: { ...pacingBase, stoppedReason: opts.manualConfirm === true ? 'scope-approval-required' : 'manual-confirmation-required' } };
  }
  const allWords = Array.isArray(opts.wordlist) ? opts.wordlist : loadWordlist();
  const words = allWords
    .map((word) => String(word).trim())
    .filter((word) => /^[A-Za-z0-9._~-]{1,100}$/.test(word))
    .slice(0, maxPaths);
  const base = String(baseUrl).replace(/\/+$/, '');
  let stoppedReason = null;
  let requestsMade = 0;
  let consecutiveForbidden = 0;
  const baselineR = await netMod.fetch(`${base}/__knk_baseline_${Date.now()}.txt`, { timeoutMs: 15000 });
  requestsMade += 1;
  const baseline = baselineR.status;
  const findings = [];
  if (baselineR.outOfScope || baselineR.blocked) {
    return {
      tool: opts.tool || 'manual-paced', baseline, total: words.length, requestsMade,
      findings, pacing: { ...pacingBase, mode: 'sequential-global-limiter', stoppedReason: 'out-of-scope' },
    };
  }
  if ([429, 430, 509].includes(baseline)) {
    return { tool: opts.tool || 'manual-paced', baseline, total: words.length, requestsMade, findings,
      pacing: { ...pacingBase, mode: 'sequential-global-limiter', stoppedReason: `rate-limit-${baseline}` } };
  }
  if (baseline === 503) {
    return { tool: opts.tool || 'manual-paced', baseline, total: words.length, requestsMade, findings,
      pacing: { ...pacingBase, mode: 'sequential-global-limiter', stoppedReason: 'service-unavailable' } };
  }
  for (const w of words) {
    const url = `${base}/${w}`;
    let r;
    try { r = await netMod.fetch(url, { timeoutMs: 15000 }); } catch { continue; }
    requestsMade += 1;
    if (r.outOfScope || r.blocked) { stoppedReason = 'out-of-scope'; break; }
    if ([429, 430, 509].includes(r.status)) { stoppedReason = `rate-limit-${r.status}`; break; }
    if (r.status === 503) { stoppedReason = 'service-unavailable'; break; }
    consecutiveForbidden = r.status === 403 ? consecutiveForbidden + 1 : 0;
    if (consecutiveForbidden >= 2) { stoppedReason = 'repeated-forbidden'; break; }
    const interesting = r.status !== baseline && ![404, 405].includes(r.status);
    if (interesting || r.status === 401 || r.status === 403) {
      findings.push({ path: `/${w}`, status: r.status, size: (r.text || '').length, location: r.headers.location || '' });
    }
  }

  return {
    tool: opts.tool || 'manual-paced',
    baseline, total: words.length, requestsMade,
    findings: findings.sort((a, b) => a.path.localeCompare(b.path)),
    pacing: { mode: 'sequential-global-limiter', concurrency: 1, rateLimitMs: netMod.getRateLimit(), maxPaths: 15, stoppedReason },
  };
}

module.exports = { fuzz, loadWordlist, MAX_PATHS: 15 };