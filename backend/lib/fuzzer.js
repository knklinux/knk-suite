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

// ── Checkpoint reanudable ─────────────────────────────────────────────────
// El fuzz puede pausarse (rate-limit, 403-storm, 503, out-of-scope). Sin
// checkpoint, cada relanzamiento del pipeline re-empezaba de cero y el
// usuario percibía "el fuzz detiene el pipeline". El checkpoint guarda lo
// sondeado y lo hallado; la reanudación salta lo ya probado.
function checkpointPath(baseUrl) {
  const crypto = require('crypto');
  const key = crypto.createHash('sha1').update(String(baseUrl)).digest('hex').slice(0, 12);
  return path.join(__dirname, '..', '..', 'evidencia-poc', 'fuzz', `checkpoint-${key}.json`);
}
function loadCheckpoint(baseUrl) {
  try {
    const j = JSON.parse(fs.readFileSync(checkpointPath(baseUrl), 'utf8'));
    if (j && j.base === String(baseUrl) && Array.isArray(j.probed)) return { probed: new Set(j.probed), findings: Array.isArray(j.findings) ? j.findings : [], baseline: j.baseline || null };
  } catch {}
  return { probed: new Set(), findings: [], baseline: null };
}
function saveCheckpoint(baseUrl, cp) {
  try {
    fs.mkdirSync(path.dirname(checkpointPath(baseUrl)), { recursive: true });
    fs.writeFileSync(checkpointPath(baseUrl), JSON.stringify({
      base: String(baseUrl), ts: new Date().toISOString(),
      baseline: cp.baseline, probed: [...cp.probed], findings: cp.findings,
    }, null, 2));
  } catch {}
}
function clearCheckpoint(baseUrl) {
  try { fs.unlinkSync(checkpointPath(baseUrl)); } catch {}
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
  const cp = loadCheckpoint(base);
  const pending = words.filter((w) => !cp.probed.has(`/${w}`));
  if (opts.resume !== false && cp.probed.size > 0 && pending.length === 0) {
    clearCheckpoint(base); // completado en ejecución anterior
    cp.probed = new Set(); cp.findings = []; cp.baseline = null;
  }
  // Many bounty edges (Cloudflare etc.) responden 403 a sondas sin pinta de
  // navegador. La suite manda UA real salvo override explícito del caller.
  const UAFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';
  const UA = netMod.getUA() || UAFallback;
  let stoppedReason = null;
  let requestsMade = 0;
  let consecutiveForbidden = 0;
  let skippedCount = 0;
  const diagnostics = {};
  const baselineR = await netMod.fetch(`${base}/__knk_baseline_${Date.now()}.txt`, { timeoutMs: 15000, headers: { 'User-Agent': UA } });
  requestsMade += 1;
  let baseline = baselineR.status;
  if (!cp.baseline && ![429, 430, 509, 503].includes(baseline)) cp.baseline = baseline;
  const findings = cp.findings || [];
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
    const p = `/${w}`;
    if (opts.resume !== false && cp.probed.has(p)) { skippedCount += 1; continue; } // reanudación: ya sondeado
    const url = `${base}/${w}`;
    let r;
    try { r = await netMod.fetch(url, { timeoutMs: 15000, headers: { 'User-Agent': UA } }); } catch { continue; }
    requestsMade += 1;
    cp.probed.add(p);
    if (r.outOfScope || r.blocked) { stoppedReason = 'out-of-scope'; saveCheckpoint(base, cp); break; }
    if ([429, 430, 509].includes(r.status)) { stoppedReason = `rate-limit-${r.status}`; saveCheckpoint(base, cp); break; }
    if (r.status === 503) { stoppedReason = 'service-unavailable'; saveCheckpoint(base, cp); break; }
    consecutiveForbidden = r.status === 403 ? consecutiveForbidden + 1 : 0;
    if (consecutiveForbidden >= 3) {
      stoppedReason = 'paused-403-storm';
      diagnostics.storm403 = { count: 3, resumeHint: 'edge 403eando sondas — UA navegador aplicado; si persiste, sondear a mano con Repeater o probar otra IP/salida' };
      saveCheckpoint(base, cp); break;
    }
    const interesting = r.status !== baseline && ![404, 405].includes(r.status);
    if (interesting || r.status === 401 || r.status === 403) {
      findings.push({ path: p, status: r.status, size: (r.text || '').length, location: r.headers.location || '' });
    }
    if (requestsMade % 5 === 0) saveCheckpoint(base, cp);
  }
  if (!stoppedReason) clearCheckpoint(base);
  const resumedFrom = cp.probed.size > 0 && skippedCount > 0;

  return {
    tool: opts.tool || 'manual-paced',
    baseline, total: words.length, requestsMade,
    skippedAlreadyProbed: skippedCount,
    resumedFromCheckpoint: resumedFrom,
    diagnostics,
    findings: findings.sort((a, b) => a.path.localeCompare(b.path)),
    pacing: { mode: 'sequential-global-limiter', concurrency: 1, rateLimitMs: netMod.getRateLimit(), maxPaths: 15, stoppedReason },
  };
}

module.exports = { fuzz, loadWordlist, MAX_PATHS: 15 };