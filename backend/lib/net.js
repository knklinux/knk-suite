'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns').promises;
const net = require('net');

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const UA_SUFFIX = 'knk-suite/2.0 (authorized security research)';
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

// Servicios externos de confianza necesarios para el pipeline (parser de
// programas y recon pasivo). SIEMPRE pasan por isSafePublicHost (SSRF).
const TRUSTED_SERVICES = new Set([
  'yeswehack.com', 'www.yeswehack.com',        // parser de programas
  'crt.sh',                                     // recon: subdominios
  'web.archive.org',                            // recon: wayback
  'api.hackertarget.com',                       // recon: fallback
  'html.duckduckgo.com',                        // recon/dorks: emails
  'www.bing.com',                               // dorks
  'services.nvd.nist.gov',                      // scan: CVEs
  'ifconfig.me',                                // status: verificación VPN
]);
let _customUA = null;
let _scope = [];
let _outOfScope = [];
let _minDelayMs = 1500;
let _stealthMode = true;
let _maxBatch = 30;
let _lastRequest = 0;
let _batchCount = 0;
let _batchStart = 0;
let _evidenciaDir = path.join(os.homedir(), '.knk-suite', 'evidencia');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function setUA(ua) { _customUA = String(ua || '').slice(0, 300) || null; }
function getUA() { return _customUA || DEFAULT_UA; }
function setRateLimit(ms) { _minDelayMs = Math.max(800, Math.min(Number(ms) || 1500, 60000)); }
function setStealth(value) { _stealthMode = !!value; }
function setMaxBatch(value) { _maxBatch = Math.max(1, Math.min(Number(value) || 30, 1000)); }
async function throttle() {
  const now = Date.now();
  if (!_batchStart || now - _batchStart > 60000) { _batchStart = now; _batchCount = 0; }
  if (++_batchCount > _maxBatch) { await sleep(30000); _batchStart = Date.now(); _batchCount = 1; }
  let delay = _minDelayMs;
  if (_stealthMode) delay += Math.floor(delay * (0.1 + Math.random() * 0.25));
  const remaining = delay - (Date.now() - _lastRequest);
  if (remaining > 0) await sleep(remaining);
  _lastRequest = Date.now();
}

function normalizeHost(input) {
  let value = String(input || '').trim().toLowerCase();
  if (!value) return '';
  try { if (value.includes('://')) value = new URL(value).hostname; } catch { return ''; }
  value = value.split('/')[0];
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  return value.replace(/\.$/, '');
}
function isTrustedService(host) {
  return TRUSTED_SERVICES.has(normalizeHost(host));
}
function isPrivateHost(input) {
  const host = normalizeHost(input);
  if (!host) return true;
  if (net.isIP(host) === 4) {
    const p = host.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  if (net.isIP(host) === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
  return /^(localhost|localhost\.local|ip6-localhost|metadata\.google\.internal)$/i.test(host);
}
function setScope(scope) { _scope = Array.isArray(scope) ? scope.filter(Boolean) : []; }
function setOutOfScope(scope) { _outOfScope = Array.isArray(scope) ? scope.filter(Boolean) : []; }
function matchesRule(host, rule) {
  const raw = String(rule || '').trim().toLowerCase();
  const wildcard = raw.startsWith('*.');
  const base = normalizeHost(wildcard ? raw.slice(2) : raw);
  return !!base && (wildcard ? host.endsWith(`.${base}`) && host !== base : host === base);
}
function inScope(host) {
  const normalized = normalizeHost(host);
  if (!normalized || isPrivateHost(normalized) || !_scope.length) return false;
  if (_outOfScope.some(rule => matchesRule(normalized, rule))) return false;
  return _scope.some(rule => matchesRule(normalized, rule));
}
async function isSafePublicHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized || isPrivateHost(normalized)) return false;
  if (net.isIP(normalized)) return true;
  try {
    const addresses = await dns.lookup(normalized, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(record => !isPrivateHost(record.address));
  } catch { return false; }
}
function setEvidenciaDir(dir) { _evidenciaDir = path.resolve(String(dir)); fs.mkdirSync(_evidenciaDir, { recursive: true }); }
function getEvidenciaDir() { return _evidenciaDir; }
function saveEvidence(name, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  if (buffer.length > MAX_EVIDENCE_BYTES) throw new Error('evidence_too_large');
  fs.mkdirSync(_evidenciaDir, { recursive: true });
  const safe = String(name || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'evidence';
  const file = path.join(_evidenciaDir, `${Date.now()}_${safe}`);
  fs.writeFileSync(file, buffer);
  return file;
}

function fetch(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 15000, maxRedirects = 5, maxBytes = 2 * 1024 * 1024 } = opts;
  return throttle().then(() => new Promise(async resolve => {
    let current;
    try { current = new URL(url); } catch { return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'invalid_url' }); }
    if (!['http:', 'https:'].includes(current.protocol)) return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'unsupported_protocol' });
    // Allowlist de servicios de confianza (parser/recon) O hosts del scope;
    // ambos pasan siempre por isSafePublicHost (protección SSRF).
    if (!isTrustedService(current.hostname) && !inScope(current.hostname)) {
      return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, outOfScope: true, error: 'out_of_scope' });
    }
    if (!await isSafePublicHost(current.hostname)) return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, blocked: true, error: 'unsafe_destination' });
    const requestHeaders = { 'User-Agent': `${getUA()} ${UA_SUFFIX}`, Accept: '*/*', ...headers };
    let payload = body;
    if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) { payload = JSON.stringify(body); requestHeaders['Content-Type'] = 'application/json'; }
    if (payload) requestHeaders['Content-Length'] = Buffer.byteLength(payload);
    const transport = current.protocol === 'https:' ? https : http;
    const req = transport.request(current, { method, headers: requestHeaders, timeout: timeoutMs }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) return resolve({ ok: false, status: res.statusCode, headers: res.headers, text: '', json: () => null, error: 'too_many_redirects' });
        let next; try { next = new URL(res.headers.location, current); } catch { return resolve({ ok: false, status: res.statusCode, headers: res.headers, text: '', json: () => null, error: 'invalid_redirect' }); }
        if (!isTrustedService(next.hostname) && !inScope(next.hostname)) {
          return resolve({ ok: false, status: res.statusCode, headers: res.headers, text: '', json: () => null, outOfScope: true, error: 'redirect_out_of_scope' });
        }
        return resolve(fetch(next.toString(), { ...opts, maxRedirects: maxRedirects - 1 }));
      }
      let data = ''; let size = 0; let truncated = false;
      res.setEncoding('utf8');
      res.on('data', chunk => { size += Buffer.byteLength(chunk); if (size <= maxBytes) data += chunk; else truncated = true; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: res.headers, text: data, truncated, json: () => { try { return JSON.parse(data); } catch { return null; } } }));
    });
    req.on('error', error => resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: error.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  }));
}
async function getJson(url, opts = {}) { return (await fetch(url, opts)).json(); }
async function getText(url, opts = {}) { const result = await fetch(url, opts); return result.ok ? result.text : ''; }
function qs(value) { return encodeURIComponent(value); }

module.exports = { fetch, getJson, getText, normalizeHost, qs,  setUA, getUA, setRateLimit, setStealth, setMaxBatch, setScope, setOutOfScope, inScope, matchesRule, isPrivateHost, isSafePublicHost, isTrustedService, TRUSTED_SERVICES,
 setEvidenciaDir, getEvidenciaDir, saveEvidence, DEFAULT_UA, UA_SUFFIX, MAX_EVIDENCE_BYTES };
