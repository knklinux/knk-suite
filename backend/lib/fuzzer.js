'use strict';

// ============================================================================
// KNK SUITE v2 — Fuzzer (stealth, conservative, human-like)
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
  // Stealth mode: máximo 15 paths, concurrency 1, delay 2-4s
  const isStealth = opts.stealth !== false;
  const concurrency = isStealth ? 1 : (opts.concurrency || 3);
  const delayMs = isStealth ? (2000 + Math.floor(Math.random() * 2000)) : (opts.delayMs || 300);
  const allWords = opts.wordlist || loadWordlist();
  const words = isStealth ? allWords.slice(0, 15) : allWords; // max 15 paths en stealth

  const base = String(baseUrl).replace(/\/+$/, '');
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
      // Stealth: delay variable entre requests
      if (isStealth) await new Promise(res => setTimeout(res, 1500 + Math.floor(Math.random() * 2500)));
      else await new Promise(res => setTimeout(res, delayMs));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const sorted = findings.sort((a, b) => a.path.localeCompare(b.path));
  return {
    tool: opts.tool || (isStealth ? 'stealth' : 'native'),
    baseline, total: words.length, findings: sorted,
    stealth: isStealth,
  };
}

module.exports = { fuzz, loadWordlist };