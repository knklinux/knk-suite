'use strict';

// ============================================================================
// KNK SUITE v2 — Fuzzer (wordlist local, rate limit suave)
// ============================================================================

const fs = require('fs');
const path = require('path');
const { fetch } = require('./net');

const WORDLIST = path.join(__dirname, '..', '..', 'data', 'common.txt');

function loadWordlist() {
  try {
    return fs.readFileSync(WORDLIST, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return ['admin', 'api', 'config', '.env', 'robots.txt', '.git', 'backup', 'login', 'dashboard', 'wp-admin', 'test', 'dev', 'staging', 'tmp', 'upload', 'logs', 'phpinfo.php', 'info.php'];
  }
}

async function fuzz(baseUrl, opts = {}) {
  const { concurrency = 3, delayMs = 300 } = opts;
  const base = String(baseUrl).replace(/\/+$/, '');
  const words = opts.wordlist || loadWordlist();
  const baselineR = await fetch(`${base}/__knk_baseline_${Date.now()}.txt`, { timeoutMs: 15000 });
  const baseline = baselineR.status;
  const findings = [];
  let idx = 0;

  const worker = async () => {
    while (idx < words.length) {
      const w = words[idx++];
      const url = `${base}/${w}`;
      try {
        const r = await fetch(url, { timeoutMs: 15000 });
        const interesting = r.status !== baseline && ![404, 405].includes(r.status);
        if (interesting || r.status === 401 || r.status === 403) {
          findings.push({ path: `/${w}`, status: r.status, size: (r.text || '').length, location: r.headers.location || '' });
        }
      } catch { /* skip */ }
      await new Promise(res => setTimeout(res, delayMs));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const sorted = findings.sort((a, b) => a.path.localeCompare(b.path));
  return { tool: opts.tool || 'native', baseline, total: words.length, findings: sorted };
}

module.exports = { fuzz, loadWordlist };