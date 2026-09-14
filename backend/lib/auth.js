'use strict';

// ============================================================================
// KNK SUITE v2.1 — Seguridad (Fase 1 de la auditoría)
//
//  * Token de API: env KNK_API_TOKEN o token aleatorio persistido en
//    ~/.knk-suite/api-token (permisos 0600). Se entrega al navegador como
//    cookie HttpOnly + SameSite=Strict; los clientes programáticos pueden
//    usar la cabecera X-KNK-Token.
//  * Origen local: solo se aceptan peticiones de sockets loopback y, si hay
//    cabecera Origin, solo localhost/127.0.0.1/::1 (cualquier puerto).
//  * CORS restringido: refleja únicamente orígenes locales.
//  * Saneo de comandos para endpoints HTTP y validación de targets/URLs.
// ============================================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ipMod = require('net');

const COOKIE_NAME = 'knk_token';
const TOKEN_FILE = path.join(os.homedir(), '.knk-suite', 'api-token');

let _token = null;

/** Token: env KNK_API_TOKEN o persistido en ~/.knk-suite/api-token (0600). */
function getToken() {
  if (_token) return _token;
  if (process.env.KNK_API_TOKEN) { _token = process.env.KNK_API_TOKEN; return _token; }
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (t) {
        try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* continúa: el token ya existe */ }
        _token = t;
        return _token;
      }
    }
  } catch {}
  const t = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, t + '\n', { mode: 0o600 });
  } catch {}
  _token = t;
  return _token;
}

/** Ruta del archivo de token, o null si viene del env. */
function tokenPath() {
  return process.env.KNK_API_TOKEN ? null : TOKEN_FILE;
}

function tokenMatch(candidate) {
  const t = getToken();
  if (!candidate || !t) return false;
  const a = Buffer.from(String(candidate), 'utf8');
  const b = Buffer.from(t, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
      catch { /* cookie malformada: se ignora, nunca debe tumbar la autenticación */ }
    }
  }
  return out;
}

// localhost / 127.0.0.1 / ::1 con cualquier puerto (8086 prod, 5173 dev)
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTNAMES.has(u.hostname.toLowerCase());
  } catch { return false; }
}

function isLocalSocket(req) {
  const a = (req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/**
 * Autorización completa (HTTP y WebSocket): socket loopback + (sin Origin o
 * Origin local) + token válido (cookie knk_token o cabecera X-KNK-Token).
 */
function authorize(req) {
  if (!isLocalSocket(req)) return false;
  if (req.headers.origin && !isLocalOrigin(req.headers.origin)) return false;
  const cookie = parseCookies(req.headers.cookie)[COOKIE_NAME];
  return tokenMatch(cookie) || tokenMatch(req.headers['x-knk-token']);
}

function setTokenCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${getToken()}; HttpOnly; SameSite=Strict; Path=/`);
}

/** CORS: solo refleja orígenes locales. Fija la cookie del token en cada respuesta. */
function cors(req, res, next) {
  const origin = req.headers.origin;
  if (isLocalOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-KNK-Token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  setTokenCookie(res);
  if (req.method === 'OPTIONS') {
    res.statusCode = isLocalOrigin(origin) ? 204 : 403;
    return res.end();
  }
  next();
}

/** Middleware Express: exige token válido en /api/* */
function requireToken(req, res, next) {
  if (authorize(req)) return next();
  return res.status(401).json({ ok: false, error: 'No autorizado — petición no local o token API inválido' });
}

// ── Saneo de comandos y targets ────────────────────────────────────────────
// Metacaracteres de shell: impiden encadenado ($(), ``, ;, |, &, redirecciones,
// subshells, globbing y bytes de control) dentro de `bash -c "..."`.
const META = /[\x00-\x1f\x7f`$;&|<>(){}[\]]/;
const DESTRUCTIVE_FIRST = /^(rm|rmdir|dd|mkfs|shutdown|reboot|poweroff|halt|init|telinit|fdisk|parted)\b/;
// La terminal no puede convertirse en un bypass del limitador de la suite.
// Las herramientas activas solo se permiten contra el laboratorio local; para
// objetivos autorizados deben usarse las fases que aplican scope y pacing.
const ACTIVE_NETWORK_TOOLS = /\b(nmap|masscan|ffuf|wfuzz|gobuster|dirb|feroxbuster|nuclei|sqlmap|hydra|medusa|nikto|curl|wget|nc|netcat|socat|traceroute|ping|openssl|telnet|dig|host|nslookup|whois|amass|subfinder|dnsrecon|theHarvester|whatweb|httpx|arjun|katana|hakrawler)\b/i;
const SCRIPTING_OR_SHELL_TOOLS = /\b(python(?:3)?|node|ruby|perl|php|bash|sh|zsh|fish|busybox)\b/i;
const LOCAL_LAB_TARGET = /(?:^|\s|:\/\/)(?:localhost|127\.0\.0\.1|\[?::1\]?|TARGET)(?::\d+)?(?:[/'\"\s]|$)/i;
const URL_TARGET = /https?:\/\/[^\s'\"`<>]+/gi;
const HOST_TARGET = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function hasExternalTarget(command) {
  for (const raw of String(command).match(URL_TARGET) || []) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      if (!['localhost', '127.0.0.1', '::1'].includes(host) && ipMod.isIP(host) === 0 && host !== 'target') return true;
    } catch { return true; }
  }
  for (const token of String(command).split(/\s+/)) {
    const clean = token.replace(/^[('\"]+|[),;'\"]+$/g, '').toLowerCase();
    if (HOST_TARGET.test(clean) && clean !== 'localhost' && clean !== 'target') return true;
  }
  return false;
}

/** Valida un comando para /api/docker/exec. Devuelve null (válido) o el motivo. */
function validateCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!c) return 'Comando vacío';
  if (c.length > 1000) return 'Comando demasiado largo';
  if (META.test(c)) return 'Caracteres de shell no permitidos (; | & $ ` < > ( ) { } [ ] y controles)';
  if (DESTRUCTIVE_FIRST.test(c)) return 'Comando destructivo bloqueado';
  if (/\bsqlmap\b/i.test(c)) {
    return 'SQLi automatizada bloqueada en la terminal: usa la compuerta SQLi y el flujo aprobado, rate-limited y basado en evidencia';
  }
  if ((ACTIVE_NETWORK_TOOLS.test(c) || SCRIPTING_OR_SHELL_TOOLS.test(c))
      && (!LOCAL_LAB_TARGET.test(c) || hasExternalTarget(c))) {
    return 'Herramienta de red/intérprete bloqueada fuera del laboratorio: usa el pipeline con scope, rate limit y confirmación manual';
  }
  return null;
}

// Hostname estricto. El wildcard solo se admite en un target de scope explícito,
// nunca dentro de una URL navegable.
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
function validHost(host, allowWildcard = false) {
  let h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h || h.length > 253 || h.includes('*') && !(allowWildcard && h.startsWith('*.'))) return false;
  if (h === 'localhost' || ipMod.isIP(h) > 0) return true;
  if (allowWildcard && h.startsWith('*.')) h = h.slice(2);
  const labels = h.split('.');
  return labels.length >= 2 && labels.every((label) => HOST_LABEL_RE.test(label));
}

/** Valida un target (hostname o URL http/https). Devuelve el valor saneado o null. */
function safeTarget(t) {
  if (typeof t !== 'string' || !t.trim() || t.length > 253) return null;
  if (META.test(t)) return null;
  if (t.includes('://')) {
    try {
      const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password || !u.hostname || !validHost(u.hostname)) return null;
    if (u.port && !['80', '443'].includes(u.port)) return null;
    return t;
    } catch { return null; }
  }
  return validHost(t, true) ? t : null;
}

/** Valida una entrada de scope (host exacto o wildcard, nunca URL/ruta). */
function safeScopeEntry(value) {
  const entry = String(value || '').trim();
  if (!entry || entry.includes('/') || entry.includes('://')) return null;
  return safeTarget(entry);
}

/** Valida una URL de fase (scan/fuzz/race). Devuelve la URL saneada o null. */
function safeUrl(u) {
  if (typeof u !== 'string' || !u.trim() || u.length > 2048) return null;
  if (META.test(u)) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== 'http:' && x.protocol !== 'https:') return null;
    if (x.username || x.password || !x.hostname || !validHost(x.hostname)) return null;
    if (x.port && !['80', '443'].includes(x.port)) return null;
    return u;
  } catch { return null; }
}

module.exports = {
  getToken, tokenPath, tokenMatch, authorize,
  isLocalOrigin, isLocalSocket, parseCookies,
  cors, requireToken,
  validateCommand, safeTarget, safeScopeEntry, safeUrl,
  COOKIE_NAME,
};