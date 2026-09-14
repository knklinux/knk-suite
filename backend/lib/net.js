'use strict';

// ============================================================================
// KNK SUITE v2 — HTTP helpers (custom UA, rate limit, scope awareness)
// ============================================================================

const http = require('http');
const https = require('https');
const tls = require('tls');
const dns = require('dns');
const ipMod = require('net');
// V13: detector pasivo de contenido cross-tenant (carga perezosa, nunca bloquea)
let _v13Escanear = () => {};
try { _v13Escanear = require("./v13-detector").escanear; } catch {}

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const UA_SUFFIX = 'knk-suite/2.0 (bug bounty research; see OPPLAN for scope/authorization)';

// ── Proxy opcional (p. ej. Burp Suite en 127.0.0.1:8080) ──────────────────
// KNK_PROXY=http://127.0.0.1:8080 node ... → todo el tráfico pasa por Burp.
// HTTPS vía CONNECT tunnel. El UA, el rate limiter y el scope NO cambian:
// Burp ve exactamente las peticiones que el driver enviaría sin proxy.
// TLS: verificación estricta por defecto. Para que Burp (MITM) valide:
// exporta la CA (GET http://127.0.0.1:8080/cert) y arranca Node con
// NODE_EXTRA_CA_CERTS=<burp-ca.pem>. KNK_TLS_INSECURE=1 la desactiva SOLO
// en entorno local controlado (queda registrado en el log).
let _proxy = null;
function setProxy(p) {
  if (!p) { _proxy = null; return; }
  const u = new URL(p);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Proxy debe ser http(s)://');
  _proxy = u;
}
function getProxy() { return _proxy; }
if (process.env.KNK_PROXY) setProxy(process.env.KNK_PROXY);

function _connectTunnel(proxyUrl, targetHost, targetPort) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: proxyUrl.hostname, port: Number(proxyUrl.port) || 8080,
      method: 'CONNECT', path: `${targetHost}:${targetPort}`,
      headers: { Host: `${targetHost}:${targetPort}` }, timeout: 10000,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode === 200) resolve(socket);
      else { socket.destroy(); reject(new Error(`CONNECT rechazado por proxy: ${res.statusCode}`)); }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CONNECT timeout')); });
    req.end();
  });
}

// ── UA global configurable ──────────────────────────
let _customUA = null;
function setUA(ua, { force = false } = {}) {
  if (_uaLocked && !force) return _customUA;
  const value = String(ua || '').trim();
  if (!value || value.length > 240 || /[\r\n\x00-\x1f\x7f]/.test(value)) return _customUA;
  if (value) _customUA = value;
  if (force) _uaLocked = true;
  return _customUA;
}
function getUA() { return _customUA || DEFAULT_UA; }

// ── Rate limiter global, transparente y serializado ─────────────────────────
// Todas las peticiones pasan por la misma cola: incluso Promise.all no puede
// iniciar varias a la vez ni saltarse el intervalo configurado. No se usa
// jitter ni camuflaje: el objetivo es un ritmo conservador, reproducible y
// conforme a la política del programa.
let _minDelayMs = 1500; // mínimo entre inicios de petición (anti-DoS)
let _maxBatch = 30; // máximo de peticiones por ventana de 60s
let _uaLocked = false; // la sesión puede fijar el UA; módulos auxiliares no lo reemplazan
function setRateLimit(delayMs) {
  const value = Number(delayMs);
  if (Number.isFinite(value)) _minDelayMs = Math.max(800, Math.floor(value));
}
// Se conserva por compatibilidad con la API existente; ya no añade jitter.
function setStealth(on) { void on; }
function setMaxBatch(n) {
  const value = Number(n);
  if (Number.isFinite(value)) _maxBatch = Math.max(1, Math.floor(value));
}
function getRateLimit() { return _minDelayMs; }
function lockUA() { _uaLocked = true; }
function unlockUA() { _uaLocked = false; }
function getMaxBatch() { return _maxBatch; }
function waitForSlot() { return _throttle(); }
let _nextRequestAt = 0;
let _batchCount = 0;
let _batchStart = 0;
let _throttleQueue = Promise.resolve();
function _sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function _throttle() {
  const ticket = _throttleQueue.then(async () => {
    let now = Date.now();
    if (!_batchStart || now - _batchStart >= 60000) {
      _batchStart = now;
      _batchCount = 0;
    }
    if (_batchCount >= _maxBatch) {
      await _sleep(Math.max(0, 60000 - (now - _batchStart)));
      now = Date.now();
      _batchStart = now;
      _batchCount = 0;
    }
    const waitMs = Math.max(0, _nextRequestAt - now);
    if (waitMs) await _sleep(waitMs);
    const startedAt = Date.now();
    _nextRequestAt = startedAt + _minDelayMs;
    _batchCount += 1;
  });
  // Keep the queue usable after a rejected ticket without hiding the error
  // from the caller awaiting the original ticket.
  _throttleQueue = ticket.catch(() => {});
  return ticket;
}

// ── Scope filter + protección anti-SSRF ──────────────
// Desde la audita de seguridad: sin scope definido NO se permite tráfico a
// hosts internos (loopback, LAN, link-local, metadata cloud) — ni por nombre
// ni resolviendo el hostname a una IP interna (defensa contra DNS rebinding).
// Con scope explícito, el match textual decide (y puede incluir 127.0.0.1
// para el laboratorio local si se quiere).
let _scope = [];
function setScope(scope) { _scope = Array.isArray(scope) ? scope : []; }

function ip4ToInt(ip) {
  const o = String(ip || '').split('.').map(Number);
  if (o.length !== 4 || o.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3];
}

function isInternalIPv4(ip) {
  const n = ip4ToInt(ip);
  if (n === null) return false;
  const b1 = n >>> 24, b2 = (n >>> 16) & 255, b3 = (n >>> 8) & 255;
  if (b1 === 0 || b1 === 10 || b1 === 127) return true;          // 0/8, 10/8, 127/8
  if (b1 === 169 && b2 === 254) return true;                     // 169.254/16 link-local + metadata
  if (b1 === 172 && b2 >= 16 && b2 <= 31) return true;           // 172.16/12
  if (b1 === 192 && b2 === 168) return true;                     // 192.168/16
  if (b1 === 100 && b2 >= 64 && b2 <= 127) return true;          // 100.64/10 CGNAT
  if (b1 === 192 && b2 === 0 && b3 === 0) return true;           // 192.0.0/24
  if (b1 === 192 && b2 === 0 && b3 === 2) return true;           // 192.0.2/24 doc
  if (b1 === 198 && (b2 === 18 || b2 === 19)) return true;       // 198.18/15 benchmark
  if (b1 === 198 && b2 === 51 && b3 === 100) return true;        // 198.51.100/24 doc
  if (b1 === 203 && b2 === 0 && b3 === 113) return true;         // 203.0.113/24 doc
  if (b1 >= 224) return true;                                    // multicast + reservado
  return false;
}

function isInternalIPv6(ip) {
  const h = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('::ffff:')) {
    const v4 = h.slice(7);
    if (v4.includes('.')) return isInternalIPv4(v4);
  }
  // fe80::/10 (link-local) y fc00::/7 (ULA)
  return /^fe[89ab]/.test(h) || /^fc/.test(h) || /^fd/.test(h);
}

function isInternalHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (isInternalIPv4(h)) return true;
  if (h.includes(':')) return isInternalIPv6(h);
  return /(^|\.)localhost$/.test(h) || /(^|\.)local$/.test(h) || /(^|\.)internal$/.test(h)
    || h === 'localhost.localdomain' || /(^|\.)home\.arpa$/.test(h);
}

// Caché DNS 60s para el chequeo de rebinding (evita un lookup por request)
const _dnsCache = new Map();
async function resolvesInternal(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || isInternalHost(h)) return true;
  const cached = _dnsCache.get(h);
  if (cached && Date.now() - cached.t < 60000) return cached.internal;
  try {
    const r = await dns.promises.lookup(h, { all: true });
    const internal = (r || []).some((a) => isInternalIPv4(a.address) || isInternalIPv6(a.address));
    _dnsCache.set(h, { t: Date.now(), internal });
    return internal;
  } catch {
    _dnsCache.set(h, { t: Date.now(), internal: false });
    return false;
  }
}

/**
 * Un host está permitido si:
 *  · hay scope → debe casar con inScope (el match textual decide).
 *  · NO hay scope → host público (no interno) y que no resuelva a IP interna.
 */
async function hostAllowed(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!_scope.length) {
    return !isInternalHost(h) && !(await resolvesInternal(h));
  }
  if (!inScope(h)) return false;
  // Un hostname dentro del scope no debe convertirse en un puente hacia LAN,
  // loopback o metadata mediante DNS rebinding. Las IP internas literales solo
  // se permiten cuando el usuario las incluyó explícitamente para un laboratorio.
  if (isInternalHost(h)) return true;
  return !(await resolvesInternal(h));
}

function inScope(host) {
  if (!_scope.length) return true; // sin scope definido, lo decide hostAllowed
  const h = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  for (const entry of _scope) {
    const e = String(entry).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (!e) continue;
    if (e.startsWith('*.')) {
      const base = e.slice(2);
      if (h === base || h.endsWith('.' + base)) return true;
    } else if (h === e) {
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

// ── IP pública (verificación VPN) ───────────────────
// Solo bajo demanda (no en /api/status) y con caché de 60s: evita avisar a
// ifconfig.me en cada poll del frontend y degradar si el servicio cae.
let _publicIP = null;
let _publicIPAt = 0;

function getCachedPublicIP() {
  return { publicIP: _publicIP, checkedAt: _publicIPAt };
}

async function checkPublicIP(force = false) {
  if (!force && _publicIP && Date.now() - _publicIPAt < 60000) {
    return { publicIP: _publicIP, fresh: true, checkedAt: _publicIPAt, cache: true };
  }
  return new Promise((resolve) => {
    const req = https.get('https://ifconfig.me', { timeout: 5000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        const ip = d.trim();
        // Solo se aceptan IP reales (IPv4/IPv6), nunca HTML/errores del servicio
        const esIP = ipMod.isIP(ip) === 4 || ipMod.isIP(ip) === 6;
        if (ip && esIP && !isInternalIPv4(ip) && !isInternalIPv6(ip)) {
          _publicIP = ip;
          _publicIPAt = Date.now();
        }
        resolve({ publicIP: _publicIP, fresh: !!_publicIPAt, checkedAt: _publicIPAt });
      });
    });
    req.on('error', () => resolve({ publicIP: _publicIP, fresh: !!_publicIPAt, checkedAt: _publicIPAt, error: 'no disponible' }));
    req.on('timeout', () => { req.destroy(); resolve({ publicIP: _publicIP, fresh: !!_publicIPAt, checkedAt: _publicIPAt, error: 'timeout' }); });
  });
}

// ── HTTP fetch ──────────────────────────────────────
function fetch(url, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeoutMs = 15000, maxRedirects = 5 } = opts;
  let parsedUrl;
  try { parsedUrl = new URL(url); }
  catch { return Promise.resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'URL malformada' }); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
    return Promise.resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'Solo se permiten URLs HTTP(S) sin credenciales' });
  }
  return _throttle().then(async () => {
    // Scope + anti-SSRF: host interno sin scope → bloqueado (nunca loopback/metadata)
    try {
      const host = parsedUrl.hostname;
      if (!(await hostAllowed(host))) {
        return { ok: false, status: 0, headers: {}, text: '', json: () => null, outOfScope: true, blocked: true };
      }
    } catch { /* malformed URL */ }

    return new Promise(async (resolve) => {
      const mod = parsedUrl.protocol === 'https:' ? https : http;
      const u = parsedUrl;
      const fullUA = `${getUA()} ${UA_SUFFIX}`;
      // El UA de la sesión es inmutable para callers auxiliares: una fase no
      // puede ocultar o sustituir la identidad configurada en el OPPLAN.
      const reqHeaders = { ...headers, Accept: '*/*', 'User-Agent': fullUA };
      let payload = body;
      if (body && typeof body !== 'string') {
        payload = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
      }
      if (payload) reqHeaders['Content-Length'] = Buffer.byteLength(payload);

      // ── Ruta a través del proxy (si está configurado) ─────────────────
      let requestOptions = { method, headers: reqHeaders, timeout: timeoutMs };
      let modFinal = mod;
      try {
        if (_proxy && parsedUrl.protocol === 'https:') {
          const socket = await _connectTunnel(_proxy, u.hostname, Number(u.port) || 443);
          const inseguro = process.env.KNK_TLS_INSECURE === '1';
          if (inseguro) console.warn('[net] AVISO: KNK_TLS_INSECURE=1 — verificación TLS desactivada (solo entorno local controlado)');
          requestOptions.createConnection = () => tls.connect({ socket, servername: u.hostname, rejectUnauthorized: !inseguro });
        } else if (_proxy && parsedUrl.protocol === 'http:') {
          requestOptions = { ...requestOptions, host: _proxy.hostname, port: Number(_proxy.port) || 8080, path: u.href, headers: { ...reqHeaders, Host: u.host } };
          modFinal = http;
        }
      } catch (e) {
        return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'proxy: ' + e.message });
      }

      const req = modFinal.request(u, requestOptions, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
          res.resume();
          let redirected;
          try { redirected = new URL(res.headers.location, url); } catch { return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'Redirección inválida' }); }
          if (!['http:', 'https:'].includes(redirected.protocol) || redirected.username || redirected.password) {
            return resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'Redirección no HTTP(S) o con credenciales bloqueada' });
          }
          const sameOrigin = redirected.origin === parsedUrl.origin;
          const nextHeaders = {};
          for (const [key, value] of Object.entries(headers || {})) {
            // Solo se reenvían cabeceras explícitamente inocuas. Las cabeceras
            // propietarias podrían contener secretos que acabarían en el host
            // de una redirección controlada por terceros.
            if (/^(accept|accept-language|user-agent)$/i.test(key)) nextHeaders[key] = value;
            else if (sameOrigin && !/^(authorization|cookie|proxy-authorization|x-api-key|x-knk-token)$/i.test(key)) nextHeaders[key] = value;
          }
          // Nunca reenviar un cuerpo POST a otro origen tras un redirect 301/302/303.
          const redirectChangesMethod = [301, 302, 303].includes(res.statusCode);
          const nextMethod = redirectChangesMethod ? 'GET' : method;
          const nextBody = redirectChangesMethod ? null : body;
          return resolve(fetch(redirected.toString(), { ...opts, method: nextMethod, body: nextBody, headers: nextHeaders, maxRedirects: maxRedirects - 1 }));
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
        // V13: escaneo pasivo del cuerpo — nunca altera la respuesta
        try { _v13Escanear(data, method + " " + url); } catch {}
      });
      req.on('error', (e) => resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'timeout' }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
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
  setUA, getUA, lockUA, unlockUA, getRateLimit, setRateLimit, setStealth, setMaxBatch, getMaxBatch, waitForSlot, setScope, inScope, hostAllowed,
  setProxy, getProxy,
  isInternalHost, isInternalIPv4, isInternalIPv6,
  checkPublicIP, getCachedPublicIP,
  setEvidenciaDir, getEvidenciaDir, saveEvidence,
  DEFAULT_UA, UA_SUFFIX,
};