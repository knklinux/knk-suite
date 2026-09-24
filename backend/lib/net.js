'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');
const dns = require('dns');
const ipMod = require('net');
const { revisarOpciones } = require('./opciones');
let _etiquetarMe = null; // decorador PG-06 (carga perezosa: identidad.js importa este módulo)
// V13: detector pasivo de contenido cross-tenant (carga perezosa, nunca bloquea)
let _v13Escanear = () => {};
try { _v13Escanear = require("./v13-detector").escanear; } catch {}

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const DEFAULT_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';
const UA_SUFFIX = 'knk-suite/2.0 (authorized security research)';
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

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

// ── Avisos de configuración ─────────────────────────────────────────────────
// Un setter que descarta en silencio lo que le piden es indistinguible de un
// setter que sí lo aplicó: por eso estas llamadas avisan UNA vez por
// situación+valor (repetir la misma línea en cada petición es no avisar).
const _avisosConfig = new Set();
function _avisarConfig(clave, mensaje, avisar = console.warn) {
  if (_avisosConfig.has(clave)) return false;
  _avisosConfig.add(clave);
  if (typeof avisar === 'function') avisar(`[net] ⚠️ ${mensaje}`);
  return true;
}
function _reiniciarAvisosConfig() { _avisosConfig.clear(); }
const _tipo = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// ── UA global configurable ──────────────────────────
let _customUA = null;
function setUA(ua, { force = false } = {}) {
  if (_uaLocked && !force) {
    // El UA está fijado por integridad de identidad: el llamante pide otro y se
    // queda con el anterior. Antes esto era mudo por completo.
    _avisarConfig(`ua-bloqueado|${ua}`,
      `setUA() ignorado: la identidad está FIJADA por lockUA(). Se conserva «${String(getUA()).slice(0, 60)}». ` +
      'Un auxiliar no puede cambiar el UA de la sesión; si de verdad hace falta, setUA(ua, { force: true }).');
    return _customUA;
  }
  const value = String(ua || '').trim();
  if (!value || value.length > 240 || /[\r\n\x00-\x1f\x7f]/.test(value)) {
    _avisarConfig(`ua-invalido|${value.length}`,
      `setUA() ignorado: ${value ? 'el UA pedido no es válido (caracteres de control o más de 240 caracteres)' : 'el UA pedido está vacío'}. ` +
      `Se conserva «${String(getUA()).slice(0, 60)}».`);
    return _customUA;
  }
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
const SUELO_MS = 800; // suelo anti-DoS: por debajo, la suite va más rápido de lo que se permite
let _minDelayMs = 1500; // mínimo entre inicios de petición (anti-DoS)
let _maxBatch = 30; // máximo de peticiones por ventana de 60s
let _uaLocked = false; // la sesión puede fijar el UA; módulos auxiliares no lo reemplazan
let _extraHeaders = {}; // cabeceras globales del programa (p. ej. X-Intigriti-Username)
// Fija cabeceras globales (objeto {Nombre: valor}); valores vacíos se ignoran.
// Se adjuntan a TODAS las peticiones salientes (repeater, hunter, recon).
function setExtraHeaders(obj) {
  _extraHeaders = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj).slice(0, 10)) {
      const key = String(k).trim();
      const val = String(v == null ? '' : v).trim();
      if (!key || !val || /^(host|content-length|connection|user-agent|cookie|authorization)$/i.test(key)) continue;
      _extraHeaders[key] = val.slice(0, 256);
    }
  }
  return { ..._extraHeaders };
}
function getExtraHeaders() { return { ..._extraHeaders }; }
function setRateLimit(delayMs) {
  const value = Number(delayMs);
  if (!Number.isFinite(value)) {
    // Un `rateLimit: '2s'` es un error de tipo del llamante, no una petición de
    // 1500 ms: antes se ignoraba sin decir nada.
    _avisarConfig(`rate-no-num|${String(delayMs)}`,
      `setRateLimit() ignorado: «${String(delayMs)}» no es un número. Se conserva ${_minDelayMs} ms.`);
    return _minDelayMs;
  }
  if (value < SUELO_MS) {
    // Se respeta el suelo, pero que no sea en silencio: el llamante cree haber
    // pedido un ritmo más rápido del que la suite va a usar de verdad.
    _avisarConfig(`rate-suelo|${value}`,
      `setRateLimit(${value}) ELEVADO al suelo anti-DoS de ${SUELO_MS} ms (la suite no irá a la velocidad pedida).`);
  }
  _minDelayMs = Math.max(SUELO_MS, Math.floor(value));
  return _minDelayMs;
}
// Se conserva por compatibilidad con la API existente; ya no añade jitter.
function setStealth(on) { void on; }
function setMaxBatch(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) {
    _avisarConfig(`batch-no-num|${String(n)}`, `setMaxBatch() ignorado: «${String(n)}» no es un número. Se conserva ${_maxBatch}.`);
    return _maxBatch;
  }
  if (value < 1) _avisarConfig(`batch-suelo|${value}`, `setMaxBatch(${value}) elevado a 1 (no hay ventanas de 0 peticiones).`);
  _maxBatch = Math.max(1, Math.floor(value));
  return _maxBatch;
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
let _outOfScope = [];
/**
 * Fija el scope. NO acepta cualquier cosa: si lo que llega no es un array, el
 * scope se QUEDA COMO ESTABA y avisa.
 *
 * Antes se convertía en `[]` en silencio, y `[]` no significa "nada permitido"
 * sino "sin filtro": sin scope, `hostAllowed` deja pasar cualquier host público.
 * O sea que un error de tipo ENSANCHABA el permiso — lo contrario de lo que se
 * espera de un control de seguridad. Medido: con
 * `setScope(['api.example.com'])`, `inScope('evil.com')` es `false`; con
 * `setScope('api.example.com')` (un string por error) pasa a `true`.
 *
 * Para vaciarlo de verdad hay que pedirlo: `setScope([])`.
 * Devuelve `true` si aplicó el scope nuevo.
 */
function setScope(scope) {
  if (!Array.isArray(scope)) {
    _avisarConfig(`scope-tipo|${_tipo(scope)}`,
      `setScope() RECHAZADO: llegó ${_tipo(scope)} («${String(scope).slice(0, 80)}»), no un array. ` +
      `Se CONSERVA el scope actual (${_scope.length} entrada(s)); para vaciarlo: setScope([]).`);
    return false;
  }
  _scope = scope;
  return true;
}
function getScope() { return _scope.slice(); }

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

function ipv6Bytes(ip) {
  let h = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (h.includes('.')) {
    const at = h.lastIndexOf(':');
    const n = ip4ToInt(h.slice(at + 1));
    if (at < 0 || n === null) return null;
    h = h.slice(0, at + 1) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  if (ipMod.isIP(h) !== 6) return null;
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right];
  if (words.length !== 8 || words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return words.flatMap((w) => { const n = parseInt(w, 16); return [(n >>> 8) & 255, n & 255]; });
}

function isInternalIPv6(ip) {
  const bytes = ipv6Bytes(ip);
  if (!bytes) return false;
  const first = bytes[0], second = bytes[1], third = bytes[2], fourth = bytes[3];
  if (bytes.every((b) => b === 0)) return true;
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true;
  if (bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 255 && bytes[11] === 255) {
    return isInternalIPv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (first === 0xff) return true;
  if (first === 0x20 && second === 0x01 && third === 0x0d && fourth === 0xb8) return true;
  if (first === 0x01 && second === 0x00 && bytes.slice(2, 8).every((b) => b === 0)) return true;
  return false;
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

/**
 * Lista out-of-scope. Mismo criterio fail-safe que `setScope`: un valor que no
 * es array NO vacía la lista. Vaciar out-of-scope también ENSANCHA —esa lista
 * domina sobre el scope—, así que tampoco puede pasar por accidente.
 */
function setOutOfScope(scope) {
  if (!Array.isArray(scope)) {
    _avisarConfig(`oos-tipo|${_tipo(scope)}`,
      `setOutOfScope() RECHAZADO: llegó ${_tipo(scope)}, no un array. Se CONSERVA la lista actual (${_outOfScope.length} entrada(s)); para vaciarla: setOutOfScope([]).`);
    return false;
  }
  _outOfScope = scope.filter(Boolean);
  return true;
}
function getOutOfScope() { return _outOfScope.slice(); }
function matchesRule(host, rule) {
  const raw = String(rule || '').trim().toLowerCase();
  const wildcard = raw.startsWith('*.');
  const base = normalizeHost(wildcard ? raw.slice(2) : raw);
  return !!base && (wildcard ? host.endsWith(`.${base}`) && host !== base : host === base);
}
function inScope(host) {
  // Sin scope definido → permitido (lo decide hostAllowed): el relay LAN y
  // las cámaras locales dependen de poder trabajar sin scope explícito.
  if (!_scope.length) return true;
  const normalized = normalizeHost(host);
  if (!normalized) return false;
  // La lista out-of-scope (headless/onboard) nunca se amplía por wildcard:
  // domina incluso sobre las entradas del scope.
  if (_outOfScope.some(rule => matchesRule(normalized, rule))) return false;
  // Wildcard (*.base): subdominios Y apex; dominio exacto: solo exacto.
  // Comparación SIN strip de www: 'www.api.other.com' NO cae dentro de una
  // entrada exacta 'api.other.com' (semántica idéntica a opplan.js).
  const h = String(host || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
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
async function isSafePublicHost(host) {
  const normalized = normalizeHost(host);
  if (!normalized || isInternalHost(normalized)) return false;
  if (net.isIP(normalized)) return true;
  try {
    const addresses = await dns.promises.lookup(normalized, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(record => !isInternalHost(record.address));
  } catch { return false; }
}

// Directorio de evidencia. TENÍA que estar declarado: el fichero es 'use strict'
// y sin `let` la asignación lanzaba ReferenceError, así que setEvidenciaDir() y
// saveEvidence() NUNCA funcionaron (nadie lo notó porque las llamadas iban dentro
// de try/catch). Por defecto, la evidencia HTTP del repo.
let _evidenciaDir = process.env.KNK_EVIDENCIA_DIR
  || path.join(__dirname, '..', '..', 'evidencia-poc', 'http');
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

// ── Cabeceras efectivas salientes ───────────────────────────────────────────
// Las capturas históricas guardaban status y cuerpo, nunca el request: el
// registro de evidencia no reflejaba lo que realmente salía al cable (el UA
// lleva el sufijo UA_SUFFIX pase lo que pase, y `Accept` se pisaba). Aquí se
// conservan los últimos conjuntos REALES, con Cookie/Authorization redactados,
// para poder auditar la huella de cliente sin adivinar y sin volcar secretos.
const MAX_CABECERAS = 50;
const _ultimasPeticiones = [];
const CLAVES_SECRETAS = /^(cookie|authorization|proxy-authorization|x-knk-token|x-api-key)$/i;
function _redactarCabeceras(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) out[k] = CLAVES_SECRETAS.test(k) ? '<redactado>' : String(v);
  return out;
}
function ultimasPeticiones() { return _ultimasPeticiones.slice(); }
function limpiarPeticiones() { _ultimasPeticiones.length = 0; }

// Señales que un control de borde mira para saber si detrás hay un navegador.
// AJUSTADO CON MEDICIÓN (captura de contraste huella-contraste.txt), no a ojo:
//  · `te` salió de la lista: Firefox 155 NO manda TE: trailers (es de Chromium).
//  · `upgrade-insecure-requests` es solo de NAVEGACIÓN: un fetch() no la manda.
//  · `referer` no lo lleva una navegación top-level (sec-fetch-site: none).
// Las que quedan se mandan siempre en ambos casos, así que su ausencia sí delata.
const SENALES_NAVEGADOR = [
  ['accept-encoding', 'un navegador siempre negocia compresión'],
  ['sec-fetch-dest', 'Fetch Metadata: solo navegadores'],
  ['sec-fetch-mode', 'Fetch Metadata: solo navegadores'],
  ['sec-fetch-site', 'Fetch Metadata: solo navegadores'],
  ['accept-language', 'negociación de idioma del navegador'],
  ['priority', 'hint de prioridad (u=…)'],
];
// Firmas del cliente PROPIO. Aquí también se corrigió a ojo por medición:
// `accept: */*` y `connection: keep-alive` NO discriminan (Firefox manda `*/*`
// en el fetch() de una página y `keep-alive` en HTTP/1.1). Lo único que
// delata a este cliente es su UA auto-declarado: es identidad, no descuido.
const SENALES_FIRMA_SINTETICA = [
  ['user-agent', UA_SUFFIX, 'el UA se auto-declara knk-suite (identidad, no camuflaje)'],
];

/**
 * Diagnóstico de huella: qué delata que la petición no viene de un navegador.
 * Puro y reutilizable para las DOS partes de una captura de contraste (el
 * cliente sintético y el navegador real).
 */
function diagnosticoHuella(headers = {}, { metodo = 'GET', orden = null } = {}) {
  const bajo = {};
  for (const [k, v] of Object.entries(headers || {})) bajo[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  const faltan = [];
  for (const [clave, motivo] of SENALES_NAVEGADOR) {
    if (!bajo[clave]) faltan.push({ cabecera: clave, motivo });
  }
  const navegacionTop = bajo['sec-fetch-dest'] === 'document' && bajo['sec-fetch-site'] === 'none';
  if (navegacionTop) {
    // Una navegación de nivel superior pide HTTPS y no lleva Referer.
    if (!bajo['upgrade-insecure-requests']) {
      faltan.push({ cabecera: 'upgrade-insecure-requests', motivo: 'una navegación de navegador pide HTTPS' });
    }
  } else if (!bajo['referer']) {
    faltan.push({ cabecera: 'referer', motivo: 'procedencia de la petición' });
  }
  const firmas = [];
  for (const [clave, valor, motivo] of SENALES_FIRMA_SINTETICA) {
    if (String(bajo[clave] || '').includes(valor)) firmas.push({ cabecera: clave, motivo });
  }
  if (String(metodo).toUpperCase() === 'POST' && !bajo['origin']) {
    faltan.push({ cabecera: 'origin', motivo: 'un POST de navegador lleva Origin' });
  }
  const ua = bajo['user-agent'] || '';
  const pareceNavegador = faltan.length === 0 && firmas.length === 0;
  return {
    metodo: String(metodo).toUpperCase(),
    headerOrder: orden || null,
    faltan,
    firmas,
    pareceNavegador,
    resumen: pareceNavegador
      ? 'indistinguible de un navegador por cabeceras'
      : `${faltan.length} señal(es) de navegador ausente(s), ${firmas.length} firma(s) de cliente sintético`,
    ua,
  };
}

// ── Aviso de huella de automatizado, en el momento ──────────────────────────
// El diagnóstico de arriba se escribe en la evidencia, y la evidencia se vuelca
// AL SALIR: durante la pasada nadie ve que la petición se está identificando
// sola. Estas tres señales son las más baratas de mirar para un control de borde
// y las que ningún informe registraba, así que se avisan por el log en el
// instante en que la petición SALE (no cuando se pretende: si el proxy falla
// antes, no hay petición que avisar).
//
// `origin` se exige SOLO en métodos con cuerpo: un GET de navegador tampoco
// manda Origin, y avisar en cada GET convertiría el aviso en papel pintado —
// un aviso que siempre suena es un aviso que nadie lee.
const SENALES_AVISO = ['accept-encoding', 'sec-fetch-*', 'origin (solo con cuerpo)'];

/** Señales de navegador ausentes que dejan constancia. Pura y testeable. */
function senalesNavegadorAusentes(headers = {}, { metodo = 'GET' } = {}) {
  const bajo = {};
  for (const [k, v] of Object.entries(headers || {})) bajo[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  const faltan = [];
  if (!bajo['accept-encoding']) faltan.push('accept-encoding');
  if (!bajo['sec-fetch-dest'] && !bajo['sec-fetch-mode'] && !bajo['sec-fetch-site']) faltan.push('sec-fetch-*');
  const conCuerpo = /^(POST|PUT|PATCH|DELETE)$/i.test(String(metodo));
  if (conCuerpo && !bajo['origin']) faltan.push('origin');
  return faltan;
}

/**
 * Evalúa el aviso para una petición concreta.
 * `objetivoReal` = host público (no interno): un eco en 127.0.0.1 —capturas de
 * contraste, tests, laboratorio— mide la huella a propósito y no debe llenar el
 * log de avisos que no van a ningún objetivo.
 */
function evaluarHuellaAutomatizada({ host, metodo = 'GET', headers = {} } = {}) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  const objetivoReal = !!h && !isInternalHost(h);
  const faltan = senalesNavegadorAusentes(headers, { metodo });
  const aviso = objetivoReal && faltan.length
    ? `huella de automatizado hacia ${h} (${String(metodo).toUpperCase()}): falta ${faltan.join(', ')} — un navegador real manda estas señales siempre, así que la petición se identifica sola como cliente sintético`
    : null;
  return { host: h, objetivoReal, faltan, aviso };
}

// Un aviso por combinación host+método+señales ausentes: repetir la misma línea
// 40 veces no informa de nada y entierra las demás. El detalle de CADA petición
// queda en el registro, y el total se resume al salir (engancharVolcadoAutomatico).
const _avisosHuellaVistos = new Set();
function _avisarHuella(clave) {
  if (_avisosHuellaVistos.has(clave)) return false;
  _avisosHuellaVistos.add(clave);
  return true;
}
function avisosHuellaVistos() { return _avisosHuellaVistos.size; }

/** Ordena las cabeceras para leerlas: primero las que importan a la huella. */
function _ordenarParaLectura(h) {
  const prioridad = ['User-Agent', 'Accept', 'Accept-Encoding', 'Accept-Language', 'Origin', 'Referer', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'Content-Type', 'Content-Length', 'Connection'];
  return Object.keys(h || {}).sort((a, b) => {
    const ia = prioridad.indexOf(a), ib = prioridad.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/**
 * Vuelca a EVIDENCIA las cabeceras efectivas de las últimas peticiones.
 * Escribe `<archivo>` (legible) y `<archivo>.json` (crudo). Devuelve sus rutas.
 */
function volcarPeticiones(archivo, { titulo = 'Cabeceras efectivas salientes', n = MAX_CABECERAS } = {}) {
  const destino = path.resolve(String(archivo));
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const registros = _ultimasPeticiones.slice(-Math.max(1, Number(n) || MAX_CABECERAS));
  const L = [];
  L.push(`# ${titulo}`);
  L.push(`# generado: ${new Date().toISOString()}`);
  L.push(`# peticiones registradas: ${_ultimasPeticiones.length} (volcadas: ${registros.length})`);
  L.push('# Cookie/Authorization van redactados: son secretos y no aportan a la huella.');
  L.push('');
  if (!registros.length) L.push('(sin peticiones registradas por lib/net.js en este proceso)');
  registros.forEach((r, i) => {
    const huella = diagnosticoHuella(r.headers, { metodo: r.method, orden: r.headerOrder });
    L.push(`## [${i + 1}] ${r.method} ${r.url} → ${r.status === null ? '(sin respuesta)' : r.status}`);
    L.push(`   ts: ${r.ts}`);
    L.push(`   huella: ${huella.resumen}`);
    for (const f of huella.faltan) L.push(`     · falta ${f.cabecera} — ${f.motivo}`);
    for (const f of huella.firmas) L.push(`     · firma ${f.cabecera} — ${f.motivo}`);
    if (r.huellaIncompleta && r.huellaIncompleta.length) {
      L.push(`     · AVISO: hacia objetivo real sin ${r.huellaIncompleta.join(', ')}`);
    }
    for (const k of _ordenarParaLectura(r.headers)) {
      const v = String(r.headers[k]);
      L.push(`   ${k}: ${v.length > 200 ? v.slice(0, 200) + '…' : v}`);
    }
    L.push('');
  });
  fs.writeFileSync(destino, L.join('\n'));
  const jsonDestino = destino.replace(/\.txt$/i, '') + '.json';
  fs.writeFileSync(jsonDestino, JSON.stringify({
    titulo, generado: new Date().toISOString(),
    total: _ultimasPeticiones.length,
    peticiones: registros.map((r) => ({ ...r, huella: diagnosticoHuella(r.headers, { metodo: r.method, orden: r.headerOrder }) })),
  }, null, 2));
  return { txt: destino, json: jsonDestino, n: registros.length };
}

// ── Volcado automático al terminar ──────────────────────────────────────────
// Todo driver A/B que use lib/net.js deja sus cabeceras efectivas en evidencia
// SIN tener que acordarse: se engancha en la primera petición y escribe una vez
// al salir. Se desactiva con KNK_SIN_VOLCADO=1 y nunca escribe en procesos de
// test (evita ruido de evidencia en las baterías).
//
// La detección por nombre tiene que cubrir TAMBIÉN al runner, no solo a los
// `*.test.js`: `npm test` ejecuta `backend/test.js`, y con el patrón anterior
// cada corrida dejaba en evidencia-poc/http un volcado con tráfico de pruebas
// que se lee igual que una captura real de driver.
function _esProcesoDeTest(argv1) {
  const p = String(argv1 || '').replace(/\\/g, '/');
  if (!p) return false;
  const base = path.basename(p);
  return /\.test\.[cm]?js$/i.test(base) || /^test\.js$/i.test(base) || /(^|\/)__tests__\//.test(p);
}
let _volcadoAutoActivo = process.env.KNK_SIN_VOLCADO !== '1' && !_esProcesoDeTest(process.argv[1]);
let _volcadoAutoEnganchado = false;
function setVolcadoAutomatico(on) { _volcadoAutoActivo = !!on; }
function engancharVolcadoAutomatico() {
  if (_volcadoAutoEnganchado || !_volcadoAutoActivo) return false;
  _volcadoAutoEnganchado = true;
  const driver = path.basename(process.argv[1] || 'proceso', '.js');
  process.on('exit', () => {
    try {
      if (!_ultimasPeticiones.length) return;
      const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const r = volcarPeticiones(path.join(_evidenciaDir, `peticiones-${driver}-${sello}.txt`), {
        titulo: `Cabeceras efectivas salientes — ${driver}`,
      });
      // El total de peticiones que se identificaron solas, para que la pasada
      // cierre con la cuenta y no haya que abrir el volcado para saberlo.
      const conHuellaIncompleta = _ultimasPeticiones.filter((p) => p.huellaIncompleta && p.huellaIncompleta.length).length;
      console.log(`[net] cabeceras efectivas volcadas → ${path.basename(r.txt)}` +
        (conHuellaIncompleta ? ` · ⚠️ ${conHuellaIncompleta}/${_ultimasPeticiones.length} sin huella de navegador` : ''));
    } catch { /* la evidencia nunca debe tumbar el driver al salir */ }
  });
  return true;
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
// Claves que `fetch` LEE de verdad. Cualquier otra que llegue se avisa: pasar
// `{ signal }` o `{ redirect: 'manual' }` no cancela ni cambia nada, y el
// llamante se queda creyendo que sí (mismo patrón que `puerto` vs `port`).
const CLAVES_FETCH = ['method', 'headers', 'body', 'timeoutMs', 'maxRedirects'];
function fetch(url, opts = {}) {
  revisarOpciones(opts, CLAVES_FETCH, 'net.fetch');
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
      // El `Accept` SÍ lo manda el llamante cuando lo pide: un endpoint SSE
      // necesita `text/event-stream`.
      //
      // EL ORDEN DE ESTAS TRES PIEZAS ES LA CORRECCIÓN DEL BUG: `Accept` va
      // antes del spread (gana el llamante) y `User-Agent` va después (la
      // identidad queda bloqueada). Con el spread primero, el `Accept` del
      // llamante se descartaba en silencio — un endpoint SSE negociando `*/*`.
      const reqHeaders = { Accept: '*/*', ...headers, ..._extraHeaders, 'User-Agent': fullUA };
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

      // Aviso EN EL MOMENTO, ya con la petición a punto de salir y las
      // cabeceras definitivas: el volcado de evidencia se escribe al salir del
      // proceso, así que durante la pasada nadie ve que se identifica sola.
      const huella = evaluarHuellaAutomatizada({ host: u.hostname, metodo: method, headers: reqHeaders });
      if (huella.aviso) {
        const clave = `${huella.host}|${String(method).toUpperCase()}|${huella.faltan.join(',')}`;
        if (_avisarHuella(clave)) console.warn(`[net] ⚠️ ${huella.aviso}`);
      }

      // Se registra la petición TAL CUAL sale al cable (cabeceras ya resueltas,
      // secretos redactados) para que la evidencia pueda auditarla de verdad.
      const registro = {
        ts: new Date().toISOString(), method, url: String(url).slice(0, 300),
        status: null, headers: _redactarCabeceras(reqHeaders),
        headerOrder: Object.keys(reqHeaders),
        // Solo se anota cuando el aviso procede: en un objetivo real y con
        // señales ausentes. Así la evidencia distingue "petición de driver
        // contra el programa" de "petición de laboratorio en loopback".
        huellaIncompleta: huella.aviso ? huella.faltan : [],
      };
      _ultimasPeticiones.push(registro);
      if (_ultimasPeticiones.length > MAX_CABECERAS) _ultimasPeticiones.shift();
      engancharVolcadoAutomatico();

      const req = modFinal.request(u, requestOptions, (res) => {
        registro.status = res.statusCode;
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
        res.on('end', () => {
          // PG-06 en runtime: /backend-api/me sale etiquetada (cuentaId/deviceId).
          // Carga perezosa y no-lanzadora: si el módulo no está, la respuesta
          // sigue intacta — el etiquetado jamás rompe el fetch.
          if (!_etiquetarMe) { try { _etiquetarMe = require('./me-decorador').etiquetarRespuestaMe; } catch {} }
          let r = {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers: res.headers,
            text: data,
            json: () => { try { return JSON.parse(data); } catch { return null; } },
          };
          try {
            const extras = String(process.env.KNK_ME_HOSTS_EXTRA || '').split(',').filter(Boolean);
            r = _etiquetarMe(r, { url: String(url), hostsExtra: extras });
          } catch {}
          try { _v13Escanear(data, method + " " + url); } catch {}
          resolve(r);
        });
      });
      req.on('error', (e) => { registro.status = 0; resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: e.message }); });
      req.on('timeout', () => { registro.status = 0; req.destroy(); resolve({ ok: false, status: 0, headers: {}, text: '', json: () => null, error: 'timeout' }); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
async function getJson(url, opts = {}) { return (await fetch(url, opts)).json(); }
async function getText(url, opts = {}) { const result = await fetch(url, opts); return result.ok ? result.text : ''; }
function qs(value) { return encodeURIComponent(value); }

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
  setUA, getUA, lockUA, unlockUA, getRateLimit, setRateLimit, setStealth, setMaxBatch, getMaxBatch, waitForSlot,
  setScope, getScope, inScope, hostAllowed, resolvesInternal,
  setExtraHeaders, getExtraHeaders,
  setProxy, getProxy, isSafePublicHost, setOutOfScope, getOutOfScope,
  isInternalHost, isInternalIPv4, isInternalIPv6,
  checkPublicIP, getCachedPublicIP,
  setEvidenciaDir, getEvidenciaDir, saveEvidence,
  ultimasPeticiones, limpiarPeticiones,
  diagnosticoHuella, volcarPeticiones, setVolcadoAutomatico, engancharVolcadoAutomatico,
  senalesNavegadorAusentes, evaluarHuellaAutomatizada, avisosHuellaVistos, SENALES_AVISO,
  _reiniciarAvisosConfig, _avisarConfig, CLAVES_FETCH, SUELO_MS,
  DEFAULT_UA, UA_SUFFIX,
};
