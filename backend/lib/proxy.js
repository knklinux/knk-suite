'use strict';

// ============================================================================
// lib/proxy.js — Proxy HTTP/HTTPS local estilo Burp (intercept + history)
//
// Diseño:
//   - El navegador apunta a 127.0.0.1:<port>. HTTP plain va al handler
//     principal; CONNECT se responde con certificado firmado por la CA local
//     (node-forge) y el socket TLS se inyecta en un servidor HTTP interno que
//     parsea las peticiones descifradas (patrón "emit connection").
//   - Interceptor: con intercept ON, cada petición se encola como pendiente
//     (el navegador espera) y la UI la aprueba/edita/descarta. Timeout →
//     auto-forward para no dejar el navegador colgado.
//   - Historial en memoria (anillo) con cuerpo req/res (base64, tope por
//     mensaje) y timing. Replay desde historial (con edición opcional).
//   - Upgrades (WebSocket) dentro de CONNECT: túnel ciego (no se descifran).
//   - Barrera anti-SSRF: hosts que resuelven a IP privada/loopback/metadata se
//     bloquean salvo allowPrivate explícito (para laboratorio local).
//   - Al reenviar se fuerza Accept-Encoding: identity para ver cuerpos claros.
// ============================================================================

const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const scanner = require('./proxy-scanner');
const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
const os = require('os');
const forge = require('node-forge');

const MAX_ENTRIES = 500;
const MAX_BODY = 512 * 1024; // tope por cuerpo capturado
const PENDING_TIMEOUT_MS = 120 * 1000;

const state = {
  server: null,
  port: 0,
  running: false,
  intercept: false,
  dropOutOfScope: false, // modo Burp estricto: dropea OOS en vez de reenviar
  allowPrivate: String(process.env.KNK_PROXY_ALLOW_PRIVATE || '') === '1',
  scope: new Set(), // hosts explícitos; si está vacío no se filtra por scope
  history: [],       // {id, ts, method, scheme, host, port, path, url, reqHeaders, reqBody, status, resHeaders, resBody, truncated, durationMs, outOfScope}
  nextId: 1,
  pending: new Map(), // id → {entry, resolve}
  ca: null,           // {keyPem, certPem}
  hostCerts: new Map(),
};

// ── CA y certificados por host (node-forge) ─────────────────────────────────
const CA_DIR = path.join(os.homedir(), '.knk-suite', 'mitm');
function caPaths() { return { key: path.join(CA_DIR, 'mitm-ca.key'), crt: path.join(CA_DIR, 'mitm-ca.crt') }; }

function ensureCA() {
  if (state.ca) return state.ca;
  const { key, crt } = caPaths();
  try {
    if (fs.existsSync(key) && fs.existsSync(crt)) {
      state.ca = { keyPem: fs.readFileSync(key, 'utf8'), certPem: fs.readFileSync(crt, 'utf8') };
      return state.ca;
    }
  } catch {}
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600e3);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600e3);
  const attrs = [{ name: 'commonName', value: 'KNK Suite Local CA' }, { name: 'organizationName', value: 'knkLinux' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  fs.mkdirSync(CA_DIR, { recursive: true });
  fs.writeFileSync(key, keyPem, { mode: 0o600 });
  fs.writeFileSync(crt, certPem);
  state.ca = { keyPem, certPem };
  return state.ca;
}

function serverCertFor(host) {
  if (state.hostCerts.has(host)) return state.hostCerts.get(host);
  const ca = ensureCA();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(state.nextId + 1000);
  cert.validity.notBefore = new Date(Date.now() - 3600e3);
  cert.validity.notAfter = new Date(Date.now() + 30 * 24 * 3600e3);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer([{ name: 'commonName', value: 'KNK Suite Local CA' }]);
  cert.setExtensions([
    { name: 'subjectAltName', altNames: [{ type: 2, value: host }, { type: 7, ip: net.isIP(host) ? host : undefined }].filter((a) => a.value || a.ip) },
    { name: 'basicConstraints', cA: false },
  ]);
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem);
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  cert.sign(caKey, forge.md.sha256.create());
  const ctx = tls.createSecureContext({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) });
  if (state.hostCerts.size > 200) state.hostCerts.clear(); // anillo simple
  state.hostCerts.set(host, ctx);
  return ctx;
}

// ── Barrera anti-SSRF ───────────────────────────────────────────────────────
function isPrivateIp(ip) {
  if (net.isIP(ip) === 0) return false;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('169.254.') || ip.startsWith('fe80:')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (ip === '169.254.169.254') return true;
  return false;
}

async function hostBlocked(host) {
  if (state.allowPrivate) return false;
  const literal = net.isIP(host) ? host : null;
  if (literal) return isPrivateIp(literal);
  if (['localhost', 'metadata.google.internal'].includes(String(host).toLowerCase())) return true;
  try {
    const addrs = await dns.lookup(host, { all: true });
    return addrs.some((a) => isPrivateIp(a.address));
  } catch { return false; } // host no resoluble: el error real saldrá al reenviar
}

function outOfScope(host) {
  if (state.scope.size === 0) return false;
  const h = String(host || '').toLowerCase();
  for (const s of state.scope) { if (h === s || h.endsWith(`.${s}`)) return false; }
  return true;
}

// ── Utilidades de mensaje HTTP ──────────────────────────────────────────────
function headersToRaw(headers) {
  return Object.entries(headers || {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\r\n');
}

function buildRawRequest(entry) {
  const first = `${entry.method} ${entry.path} HTTP/1.1`;
  return `${first}\r\n${headersToRaw(entry.reqHeaders)}\r\n\r\n${entry.reqBody ? Buffer.from(entry.reqBody, 'base64').toString('binary') : ''}`;
}

// Edición de raw: inserta/sustituye una cabecera de forma case-insensitive.
function applyRawEdit(raw, headerName, headerValue) {
  const rx = new RegExp(`^(${headerName}):[^\\r\\n]*\\r?\\n`, 'im');
  if (rx.test(raw)) return raw.replace(rx, `${headerName}: ${headerValue}\\r\\n`);
  const sep = raw.indexOf('\r\n\r\n');
  if (sep === -1) return raw + `\r\n${headerName}: ${headerValue}\r\n`;
  return raw.slice(0, sep) + `\r\n${headerName}: ${headerValue}` + raw.slice(sep);
}

function parseRawRequest(raw) {
  const sep = raw.indexOf('\r\n\r\n');
  const head = sep === -1 ? raw : raw.slice(0, sep);
  const body = sep === -1 ? '' : raw.slice(sep + 4);
  const lines = head.split('\r\n');
  const [method, target, version] = (lines[0] || '').split(' ');
  if (!method || !target) return null;
  const headers = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { method: method.toUpperCase(), target, version: version || 'HTTP/1.1', headers, body };
}

function forwardRequest({ scheme, host, port, method, path, headers, body }, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const mod = scheme === 'https' ? https : http;
    const outHeaders = { ...headers };
    delete outHeaders['proxy-connection']; delete outHeaders['proxy-authorization'];
    outHeaders.host = `${host}${(scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? '' : `:${port}`}`;
    outHeaders['accept-encoding'] = 'identity'; // cuerpos legibles
    const started = Date.now();
    const req = mod.request({ host, port, method, path, headers: outHeaders, timeout: timeoutMs, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      let size = 0; let truncated = false;
      res.on('data', (c) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c); else truncated = true;
      });
      res.on('end', () => resolve({
        ok: true, status: res.statusCode, headers: res.headers,
        bodyB64: Buffer.concat(chunks).toString('base64'), truncated, durationMs: Date.now() - started,
      }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message, durationMs: Date.now() - started }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (body && body.length) req.write(body);
    req.end();
  });
}

// ── Núcleo del handler HTTP ─────────────────────────────────────────────────
async function handleExchange({ method, path: reqPath, headers, bodyB64, scheme, host, port }, respond) {
  const id = state.nextId++;
  const body = bodyB64 ? Buffer.from(bodyB64, 'base64') : null;
  const entry = {
    id, ts: new Date().toISOString(), method, scheme, host, port, path: reqPath,
    url: `${scheme}://${host}${(scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? '' : `:${port}`}${reqPath}`,
    reqHeaders: headers, reqBody: bodyB64 || '', status: null, resHeaders: {}, resBody: '', truncated: false, durationMs: null,
    outOfScope: outOfScope(host),
  };

  const blocked = await hostBlocked(host);
  if (blocked) {
    entry.status = 0; entry.error = 'bloqueado: host privado/loopback (KNK_PROXY_ALLOW_PRIVATE=1 para permitirlo)';
    pushHistory(entry);
    return respond({ status: 403, headers: { 'content-type': 'text/plain' }, bodyB64: Buffer.from(entry.error).toString('base64') });
  }

  // Modo estricto: fuera de scope se dropea (403) y se registra como dropped.
  if (entry.outOfScope && state.dropOutOfScope) {
    entry.status = 0; entry.dropped = true; entry.error = 'dropeado: fuera de scope (modo estricto)';
    pushHistory(entry);
    return respond({ status: 403, headers: { 'content-type': 'text/plain' }, bodyB64: Buffer.from(entry.error).toString('base64') });
  }

  pushHistory(entry);

  if (state.intercept) {
    // Encola y espera decisión de la UI (timeout → auto-forward)
    const decision = await new Promise((resolve) => {
      const timer = setTimeout(() => { if (state.pending.has(id)) { state.pending.delete(id); resolve({ action: 'forward' }); } }, PENDING_TIMEOUT_MS);
      state.pending.set(id, { entry, resolve: (v) => { clearTimeout(timer); resolve(v); } });
    });
    if (decision.action === 'drop') {
      entry.dropped = true;
      return respond({ status: 502, headers: { 'content-type': 'text/plain' }, bodyB64: Buffer.from('intercept: petición descartada').toString('base64') });
    }
    if (decision.headers) entry.reqHeaders = decision.headers;
    if (decision.bodyB64 !== undefined) entry.reqBody = decision.bodyB64;
    entry.edited = Boolean(decision.headers || decision.bodyB64 !== undefined);
  }

  const result = await forwardRequest({ scheme, host, port, method, path: reqPath, headers: entry.reqHeaders, body: entry.reqBody ? Buffer.from(entry.reqBody, 'base64') : null });
  entry.status = result.ok ? result.status : 0;
  entry.resHeaders = result.headers || {};
  entry.resBody = result.bodyB64 || '';
  entry.truncated = Boolean(result.truncated);
  entry.durationMs = result.durationMs;
  entry.error = result.error;

  // Scanner PASIVO: analiza la respuesta recién capturada (sin I/O, sin red)
  scanner.observe(entry);

  if (!result.ok) {
    return respond({ status: 502, headers: { 'content-type': 'text/plain' }, bodyB64: Buffer.from(`proxy: ${result.error}`).toString('base64') });
  }
  const h = { ...entry.resHeaders };
  delete h['content-encoding']; delete h['content-length']; delete h['transfer-encoding'];
  if (!entry.truncated && entry.resBody) h['content-length'] = String(Buffer.from(entry.resBody, 'base64').length);
  return respond({ status: entry.status, headers: h, bodyB64: entry.truncated ? '' : entry.resBody });
}

function pushHistory(entry) {
  state.history.unshift(entry);
  if (state.history.length > MAX_ENTRIES) state.history.length = MAX_ENTRIES;
}

// ── Servidor ────────────────────────────────────────────────────────────────
function createServers() {
  const main = http.createServer((req, res) => {
    // Petición absoluta de proxy (http://) → normalizamos
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); return res.end('bad request'); }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => {
      handleExchange({
        method: req.method, path: u.pathname + u.search, headers: req.headers,
        bodyB64: chunks.length ? Buffer.concat(chunks).toString('base64') : '',
        scheme: 'http', host: u.hostname, port: Number(u.port) || 80,
      }, ({ status, headers, bodyB64 }) => {
        res.writeHead(status, headers);
        res.end(bodyB64 ? Buffer.from(bodyB64, 'base64') : undefined);
      });
    });
  });

  const mitm = http.createServer((req, res) => {
    // Petición descifrada dentro de un CONNECT
    const host = req.headers.host ? String(req.headers.host).split(':')[0] : 'desconocido';
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('end', () => {
      handleExchange({
        method: req.method, path: req.url, headers: req.headers,
        bodyB64: chunks.length ? Buffer.concat(chunks).toString('base64') : '',
        scheme: 'https', host, port: 443,
      }, ({ status, headers, bodyB64 }) => {
        res.writeHead(status, headers);
        res.end(bodyB64 ? Buffer.from(bodyB64, 'base64') : undefined);
      });
    });
  });

  main.on('connect', async (req, clientSocket, head) => {
    const m = String(req.url || '').match(/^([^:]+):(\d+)$/);
    const host = m ? m[1] : req.url;
    const port = m ? Number(m[2]) : 443;
    if (await hostBlocked(host)) {
      clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return clientSocket.destroy();
    }
    if (state.intercept) {
      // Intercepta también el CONNECT (visible en la cola)
      const id = state.nextId++;
      const entry = { id, ts: new Date().toISOString(), method: 'CONNECT', scheme: 'tunnel', host, port, path: String(req.url), url: `tunnel://${host}:${port}`, reqHeaders: req.headers, reqBody: '', status: null, resHeaders: {}, resBody: '', pending: true };
      pushHistory(entry);
      const decision = await new Promise((resolve) => {
        const timer = setTimeout(() => { if (state.pending.has(id)) { state.pending.delete(id); resolve({ action: 'forward' }); } }, PENDING_TIMEOUT_MS);
        state.pending.set(id, { entry, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      });
      if (decision.action === 'drop') { clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return clientSocket.destroy(); }
    }
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (port === 443) {
      // Desciframos: inyectamos el socket TLS en el servidor HTTP interno
      const ctx = serverCertFor(host);
      const tlsSocket = new tls.TLSSocket(clientSocket, { isServer: true, secureContext: ctx });
      mitm.emit('connection', tlsSocket);
      if (head && head.length) process.nextTick(() => tlsSocket.unshift(head));
      tlsSocket.on('error', () => clientSocket.destroy());
    } else {
      // Puerto no-443 (p.ej. 8443 sin SNI claro): túnel ciego
      const upstream = net.connect(port, host, () => {
        if (head && head.length) upstream.write(head);
        clientSocket.pipe(upstream).pipe(clientSocket);
      });
      upstream.on('error', () => clientSocket.destroy());
      clientSocket.on('error', () => upstream.destroy());
    }
  });

  // Upgrade (WebSocket) tras descifrado: túnel ciego al host real
  mitm.on('upgrade', (req, clientSocket, head) => {
    const host = req.headers.host ? String(req.headers.host).split(':')[0] : 'desconocido';
    const upstream = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(req.headers)) lines.push(`${k}: ${v}`);
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) upstream.write(head);
      clientSocket.pipe(upstream).pipe(clientSocket);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });

  return { main, mitm };
}

// ── API pública del módulo ──────────────────────────────────────────────────
async function start({ port = 8083 } = {}) {
  if (state.running) return { ok: true, port: state.port, already: true };
  const { main } = createServers();
  // port 0 = puerto efímero del SO (los smokes lo usan para no chocar con
  // nada); cualquier otro valor inválido cae al 8083 por defecto.
  const want = Number.isFinite(Number(port)) && Number(port) >= 0 ? Number(port) : 8083;
  await new Promise((resolve, reject) => {
    main.once('error', reject);
    main.listen(want, '127.0.0.1', () => resolve());
  });
  state.server = main;
  state.port = main.address().port;
  state.running = true;
  scanner.reset();
  ensureCA();
  return { ok: true, port: state.port, caFingerprint: caFingerprint() };
}

function stop({ sessionId } = {}) {
  if (!state.running) return { ok: true, already: true };
  for (const [, p] of state.pending) p.resolve({ action: 'forward' }); // no colgar navegadores
  state.pending.clear();
  try { state.server.closeAllConnections?.(); } catch {}
  state.server.close();
  state.running = false;
  state.port = 0;
  // Vacía los candidatos del scanner como hallazgos de la sesión
  let flushed = null;
  try { flushed = scanner.flushSession(sessionId); } catch {}
  return { ok: true, scan: flushed || { ok: true, created: 0 } };
}

function caFingerprint() {
  const ca = ensureCA();
  const cert = forge.pki.certificateFromPem(ca.certPem);
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return forge.md.sha256.create().update(der).digest().toHex().replace(/../g, (h) => `${h}:`).replace(/:$/, '');
}

function status() {
  return {
    ok: true, running: state.running, port: state.port, intercept: state.intercept,
    historySize: state.history.length, pending: state.pending.size,
    caDir: path.relative(process.cwd(), CA_DIR) || CA_DIR, caFingerprint: state.running || state.ca ? caFingerprint() : null,
    allowPrivate: state.allowPrivate, scope: [...state.scope],
    strict: state.dropOutOfScope,
  };
}

function setIntercept(on) { state.intercept = Boolean(on); return { ok: true, intercept: state.intercept }; }

function setStrict(on) { state.dropOutOfScope = Boolean(on); return { ok: true, strict: state.dropOutOfScope }; }

function setScope(list) {
  state.scope = new Set((Array.isArray(list) ? list : []).map((h) => String(h).toLowerCase().trim()).filter(Boolean));
  return { ok: true, scope: [...state.scope] };
}

function history({ limit = 100, q = '' } = {}) {
  let rows = state.history;
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((e) => e.url.toLowerCase().includes(needle) || e.method.toLowerCase() === needle || String(e.status) === needle);
  }
  return { ok: true, count: rows.length, entries: rows.slice(0, Math.min(Number(limit) || 100, MAX_ENTRIES)).map(summarize) };
}

/**
 * Campos vistos en CUERPOS de peticiones capturadas (POST/PUT/PATCH), con su
 * frecuencia. Soporta form-urlencoded y JSON plano (claves de primer nivel).
 * Los usa el Param Hunter en modo formulario para priorizar campos reales.
 */
function historyBodyParams({ host, limit = 60 } = {}) {
  const counts = new Map();
  for (const e of state.history) {
    if (!e || e.scheme === 'tunnel' || !e.reqBody) continue;
    if (!['POST', 'PUT', 'PATCH'].includes(String(e.method || '').toUpperCase())) continue;
    if (host && e.host !== host) continue;
    let raw;
    try { raw = Buffer.from(e.reqBody, 'base64').toString('utf8'); } catch { continue; }
    if (!raw || raw.length > 65536) continue;
    const ct = String((e.reqHeaders && (e.reqHeaders['content-type'] || e.reqHeaders['Content-Type'])) || '');
    const keys = [];
    if (/urlencoded/i.test(ct) || (!ct && /^[^=\s&]+=/.test(raw) && !raw.trim().startsWith('{'))) {
      try { for (const k of new URLSearchParams(raw).keys()) keys.push(k); } catch { /* no urlencoded */ }
    } else if (/json/i.test(ct) || (!ct && raw.trim().startsWith('{'))) {
      try {
        const j = JSON.parse(raw);
        if (j && typeof j === 'object' && !Array.isArray(j)) {
          for (const [k, v] of Object.entries(j)) if (['string', 'number', 'boolean'].includes(typeof v)) keys.push(k);
        }
      } catch { /* no JSON */ }
    }
    for (const k of keys) if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, Math.min(Number(limit) || 60, 200)));
}

/**
 * Nombres de parámetros vistos en peticiones reales del historial (proxy),
 * con su frecuencia. Filtra por host si lo pasan (ignora túneles CONNECT).
 * La UI del Param Hunter los usa para priorizar la caza: lo que la app usa
 * de verdad va antes que cualquier wordlist genérica.
 */
function historyParams({ host, limit = 60 } = {}) {
  const counts = new Map();
  for (const e of state.history) {
    if (!e || e.scheme === 'tunnel' || !e.url) continue;
    if (host && e.host !== host) continue;
    try {
      const q = new URL(e.url, 'http://x').searchParams;
      for (const name of q.keys()) counts.set(name, (counts.get(name) || 0) + 1);
    } catch { /* url no parseable: ignorar */ }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(1, Math.min(Number(limit) || 60, 200)));
}

function summarize(e) {
  return { ...e, reqBodyPreview: e.reqBody ? Buffer.from(e.reqBody, 'base64').toString('utf8').slice(0, 2000) : '', resBodyPreview: e.resBody ? Buffer.from(e.resBody, 'base64').toString('utf8').slice(0, 2000) : '', reqBody: e.reqBody ? `${e.reqBody.length}b64` : '' };
}

function historyEntry(id) {
  const e = state.history.find((x) => x.id === Number(id));
  if (!e) return null;
  return { ok: true, entry: { ...summarize(e), raw: e.scheme === 'tunnel' ? `CONNECT ${e.path} HTTP/1.1` : buildRawRequest(e) } };
}

function pendingList() {
  return { ok: true, count: state.pending.size, pending: [...state.pending.values()].map(({ entry }) => ({ ...summarize(entry), raw: entry.scheme === 'tunnel' ? `CONNECT ${entry.path} HTTP/1.1` : buildRawRequest(entry) })) };
}

function resolvePending(id, { action = 'forward', raw = null, headers = null, bodyB64 } = {}) {
  const p = state.pending.get(Number(id));
  if (!p) return { ok: false, error: 'no existe esa petición pendiente (¿timeout? ¿ya resuelta?)' };
  state.pending.delete(Number(id));
  if (action === 'drop') p.resolve({ action: 'drop' });
  else if (raw) {
    const parsed = parseRawRequest(raw);
    if (!parsed) return { ok: false, error: 'raw inválido' };
    // Con raw editado reenviamos desde aquí: aplicamos la decisión al vuelo
    p.resolve({ action: 'forward', headers: parsed.headers, bodyB64: parsed.body ? Buffer.from(parsed.body, 'binary').toString('base64') : '' });
  } else p.resolve({ action: 'forward', headers, bodyB64 });
  return { ok: true };
}

async function replay(id, { raw = null } = {}) {
  const e = state.history.find((x) => x.id === Number(id));
  if (!e || e.scheme === 'tunnel') return { ok: false, error: 'entrada no reenviable' };
  const parsed = raw ? parseRawRequest(raw) : parseRawRequest(buildRawRequest(e));
  if (!parsed) return { ok: false, error: 'raw inválido' };
  const path = parsed.target.startsWith('http') ? new URL(parsed.target).pathname + new URL(parsed.target).search : parsed.target;
  const result = await forwardRequest({ scheme: e.scheme, host: e.host, port: e.port, method: parsed.method, path, headers: parsed.headers, body: parsed.body ? Buffer.from(parsed.body, 'binary') : null });
  const id2 = state.nextId++;
  const entry = {
    id: id2, ts: new Date().toISOString(), method: parsed.method, scheme: e.scheme, host: e.host, port: e.port, path,
    url: `${e.scheme}://${e.host}${e.port === 443 || e.port === 80 ? '' : `:${e.port}`}${path}`, reqHeaders: parsed.headers,
    reqBody: parsed.body ? Buffer.from(parsed.body, 'binary').toString('base64') : '',
    status: result.ok ? result.status : 0, resHeaders: result.headers || {}, resBody: result.bodyB64 || '',
    truncated: Boolean(result.truncated), durationMs: result.durationMs, replayOf: e.id, outOfScope: outOfScope(e.host),
  };
  pushHistory(entry);
  return { ok: true, entry: summarize(entry) };
}

module.exports = {
  start, stop, status, setIntercept, setStrict, setScope, history, historyEntry, pendingList, resolvePending, replay, historyParams, historyBodyParams,
  ensureCA, buildRawRequest, parseRawRequest, isPrivateIp, applyRawEdit, _state: state,
  scannerStatus: () => scanner.status(), scannerToggle: (on) => scanner.setEnabled(on), scannerFlush: (sessionId) => scanner.flushSession(sessionId), scannerReset: () => scanner.reset(),
};
