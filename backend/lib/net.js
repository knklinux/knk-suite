'use strict';

// ============================================================================
// KNK SUITE v2 — HTTP helpers (custom UA, rate limit, scope awareness)
// ============================================================================

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const UA_SUFFIX = 'knk-suite/2.0 (bug bounty research; see OPPLAN for scope/authorization)';

// ── UA global configurable ──────────────────────────
let _customUA = null;
function setUA(ua) { _customUA = ua; }
function getUA() { return _customUA || DEFAULT_UA; }

// ── Rate limiter global ─────────────────────────────
let _minDelayMs = 500; // default 2 req/s
function setRateLimit(delayMs) { _minDelayMs = delayMs; }
let _lastRequest = 0;
async function _throttle() {
  const elapsed = Date.now() - _lastRequest;
  if (elapsed < _minDelayMs) await new Promise(r => setTimeout(r, _minDelayMs - elapsed));
  _lastRequest = Date.now();
}

// ── Scope filter ────────────────────────────────────
let _scope = [];
function setScope(scope) { _scope = Array.isArray(scope) ? scope : []; }
function inScope(host) {
  if (!_scope.length) return true; // sin scope definido, todo pasa
  const h = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  for (const entry of _scope) {
    const e = String(entry).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!e) continue;
    if (e.startsWith('*.')) {
      const base = e.slice(2);
      if (h === base || h.endsWith('.' + base)) return true;
    } else if (h === e || h.endsWith('.' + e)) {
      return true;
    }
  }
  return false;
}

// ── Evidence directory ──────────────────────────────
let _evidenciaDir = path.join(os.homedir(), '.knk-suite', 'evidencia');
function setEvidenciaDir(dir) { _evidenciaDir = dir; fs.mkdirSync(dir, { recursive: true }); }
function getEvidenciaDir() { return _evidenciaDir; }
function saveEvidence(name, data) {
  const dir = getEvidenciaDir();
  fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const file = path.join(dir, `${ts}_${safe}`);
  fs.writeFileSync(file, data, data instanceof Buffer ? null : 'utf8');
  return file;
}

// ── HTTP fetch ──────────────────────────────────────
function fetch(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 15000, maxRedirects = 5 } = opts;
  return _throttle().then(() => new Promise((resolve) => {
    // Check scope
    try {
      const host = new URL(url).hostname;
      if (!inScope(host)) {
        return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, outOfScope: true });
      }
    } catch { /* malformed URL */ }

    const mod = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const fullUA = `${getUA()} ${UA_SUFFIX}`;
    const reqHeaders = { 'User-Agent': fullUA, Accept: '*/*', ...headers };
    let payload = body;
    if (body && typeof body !== 'string') {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (payload) reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    const req = mod.request(u, { method, headers: reqHeaders, timeout: timeoutMs }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        res.resume();
        return resolve(fetch(new URL(res.headers.location, url).toString(), { ...opts, maxRedirects: maxRedirects - 1 }));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({
        ok: res.statusCode >= 200 && res.statusCode < 300,
        status: res.statusCode,
        headers: res.headers,
        text: data,
        json: () => { try { return JSON.parse(data); } catch { return null; } },
      }));
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  }));
}

async function getJson(url, opts = {}) { const r = await fetch(url, opts); return r.json(); }
async function getText(url, opts = {}) { const r = await fetch(url, opts); return r.ok ? r.text : ''; }

function normalizeHost(input) {
  let h = String(input || '').trim().toLowerCase();
  if (!h) return '';
  h = h.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  h = h.split('/')[0].split(':')[0];
  return h;
}

function qs(v) { return encodeURIComponent(v); }

module.exports = {
  fetch, getJson, getText, normalizeHost, qs,
  setUA, getUA, setRateLimit, setScope, inScope,
  setEvidenciaDir, getEvidenciaDir, saveEvidence,
  DEFAULT_UA, UA_SUFFIX,
};