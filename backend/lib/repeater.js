'use strict';
// ============================================================================
// repeater.js — Repeater estilo Burp para KNK Suite
//
// Qué es: un cliente HTTP manual donde el investigador edita la petición cruda
// y la reenvía cuantas veces quiera. Es la herramienta del "cómo lo hago a
// mano": cada envío respeta el limiter global (>=800ms), el scope y el
// anti-SSRF de la suite; nada es automático ni recurrente.
//
// Comportamiento:
//   * parse de petición cruda (método, ruta, HTTP, headers, body) con fixes
//     obligatorios de Host/Content-Length;
//   * scope OBLIGATORIO: la petición debe apuntar a un host en el scope de la
//     sesión (mismo gate que el pipeline; el loopback/metadata siempre
//     bloqueado por net.fetch);
//   * maxRedirects configurable (0 = inspeccionar el 30x directamente — lo
//     que un navegador nunca te deja ver);
//   * envío por netMod.fetch → limiter global + UA/stealth de la sesión;
//   * comparador de respuestas: la diferencia vs la respuesta previa (status,
//     longitud, cabeceras relevantes) — el núcleo del trabajo manual;
//   * convertidor a hallazgo (mismo almacén que todo el pipeline).
// ============================================================================

const db = require('../db');
const netMod = require('./net');

const MAX_BODY_BYTES = 512 * 1024;   // techo del body que mostramos/guardamos
const MAX_RESPONSE_BYTES = 512 * 1024; // ídem para la respuesta
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0';

/** Parsea una petición HTTP cruda. Devuelve {ok, error?, request?} */
function parseRawRequest(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: 'Petición vacía' };
  // normalizar CRLF → LF para parsear; el body puede contener LF legítimos
  const sepIdx = raw.indexOf('\n\n');
  const headPart = sepIdx === -1 ? raw : raw.slice(0, sepIdx);
  const bodyPart = sepIdx === -1 ? '' : raw.slice(sepIdx + 2).replace(/\r\n/g, '\n');

  const headLines = headPart.split(/\r?\n/).filter((l) => l.trim().length);
  const reqLine = headLines.shift() || '';
  const m = reqLine.match(/^([A-Za-z]+)\s+(\S+)\s+HTTP\/([\d.]+)$/);
  if (!m) return { ok: false, error: 'Línea de petición inválida (esperado "MÉTODO ruta HTTP/1.1")' };
  const [, method, target, version] = m;

  const headers = {};
  for (const line of headLines) {
    const idx = line.indexOf(':');
    if (idx === -1) return { ok: false, error: `Cabecera inválida: "${line.slice(0, 60)}"` };
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k) return { ok: false, error: `Cabecera sin nombre: "${line.slice(0, 60)}"` };
    if (headers[k.toLowerCase()] !== undefined) continue; // primer valor gana
    headers[k.toLowerCase()] = v;
  }

  const host = headers.host;
  if (!host) return { ok: false, error: 'Falta la cabecera Host' };

  return {
    ok: true,
    request: {
      method: method.toUpperCase(),
      target,                    // path+query tal cual ("/api/x?a=1" o URL absoluta)
      version: version || '1.1',
      headers,                   // claves en minúscula
      body: bodyPart || null,
      hostHeader: host,
    },
  };
}

/** URL absoluta a partir de la petición parseada (soporta target absoluto tipo proxy) */
function absoluteUrl(request) {
  const t = request.target;
  if (/^https?:\/\//i.test(t)) return t;
  const host = request.hostHeader;
  const isHttps = /:443$/.test(host);
  return `http${isHttps ? 's' : ''}://${host}${t.startsWith('/') ? '' : '/'}${t}`;
}

/** Cabeceras efectivas: Host y Content-Length correctos; UA navegador si el usuario no puso uno */
function effectiveHeaders(request) {
  const headers = { ...request.headers };
  const url = new URL(absoluteUrl(request));
  headers['host'] = url.host; // recalcular SIEMPRE (anti-confusión)
  const bodyBytes = request.body ? Buffer.byteLength(request.body, 'utf8') : 0;
  if (bodyBytes > 0) headers['content-length'] = String(bodyBytes);
  else delete headers['content-length'];
  if (!headers['user-agent']) headers['user-agent'] = BROWSER_UA;
  return headers;
}

function extractDiffable(resp) {
  return {
    status: resp.status,
    length: (resp.text || '').length,
    server: resp.headers && (resp.headers.server || resp.headers['server']) || null,
    contentType: (resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) || null,
    location: (resp.headers && (resp.headers.location || resp.headers['Location'])) || null,
    setCookieCount: (resp.headers && (resp.headers['set-cookie'] ? (Array.isArray(resp.headers['set-cookie']) ? resp.headers['set-cookie'].length : 1) : 0)) || 0,
  };
}

function diffResponses(prev, curr) {
  if (!prev) return { firstSend: true, summary: 'primer envío — sin referencia' };
  const changes = [];
  if (prev.status !== curr.status) changes.push(`status ${prev.status} → ${curr.status}`);
  if (prev.length !== curr.length) {
    const d = curr.length - prev.length;
    changes.push(`longitud ${prev.length} → ${curr.length} (${d >= 0 ? '+' : ''}${d})`);
  }
  if (prev.contentType !== curr.contentType) changes.push(`content-type ${prev.contentType || '—'} → ${curr.contentType || '—'}`);
  if (prev.location !== curr.location) changes.push(`location ${prev.location || '—'} → ${curr.location || '—'}`);
  if (prev.setCookieCount !== curr.setCookieCount) changes.push(`set-cookie ${prev.setCookieCount} → ${curr.setCookieCount}`);
  if (!changes.length) return { identical: true, summary: 'respuesta idéntica a la anterior' };
  return { identical: false, changes, summary: changes.join(' · ') };
}

/** Igual que pipeline.outOfScopeHost: reglas con soporte *.wildcard */
function outOfScopeHost(host, entries) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return (Array.isArray(entries) ? entries : []).some((entry) => {
    const e = String(entry || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    if (!e) return false;
    if (e.startsWith('*.')) return h === e.slice(2) || h.endsWith('.' + e.slice(2));
    return h === e;
  });
}

/** Convierte un envío en hallazgo de la misión */
function toFinding(sessionId, send, note) {
  const summary = note || `[Repeater] ${send.method} ${send.url} → ${send.status}`;
  const result = db.addFinding(sessionId, 'REPEATER', summary, 'info', {
    url: send.url,
    method: send.method,
    status: send.status,
    responseLength: send.length,
    requestPreview: (send.requestRaw || '').slice(0, 2000),
    responsePreview: (send.responseBody || '').slice(0, 2000),
    diff: send.diff || null,
    capturedAt: send.ts,
  });
  // id real para la UI (sql.js devuelve {lastInsertRowid, changes})
  return { ok: true, finding: { id: (result && result.lastInsertRowid) || null, summary } };
}

/**
 * Envía una petición cruda con todos los guards de la suite.
 * opts: { maxRedirects (default 0), note }
 * Devuelve { ok, error?, send? } — send listo para la tabla del Repeater.
 */
async function sendRaw(session, raw, opts = {}) {
  const parsed = parseRawRequest(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const request = parsed.request;

  const url = absoluteUrl(request);
  let host;
  try { host = new URL(url).hostname; } catch { return { ok: false, error: 'URL inválida' }; }

  // Scope obligatorio: mismo criterio que el pipeline (scope de la sesión).
  const net = require('./net');
  const scope = Array.isArray(session.scope) ? session.scope : [];
  const oos = Array.isArray(session.out_of_scope) ? session.out_of_scope : [];
  if (!scope.length || !netMod.inScope(host)) {
    return { ok: false, error: `FUERA DE SCOPE: "${host}" no está en el scope de la sesión. Defínelo en Targets primero.` };
  }
  if (outOfScopeHost(host, oos)) {
    return { ok: false, error: `El host "${host}" está en el out-of-scope de la sesión` };
  }

  const maxRedirects = Math.max(0, Math.min(5, Number(opts.maxRedirects) || 0));
  const headers = effectiveHeaders(request);
  // Cookie-jar del operador: si la petición no trae Cookie y el jar tiene
  // entrada para el host, se adjunta (caza autenticada sin pegar secretos).
  try {
    const hasCookie = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie');
    if (!hasCookie) {
      const jarCookie = require('./cookie-jar').get(host);
      if (jarCookie) headers['cookie'] = jarCookie;
    }
  } catch {}

  const resp = await netMod.fetch(url, {
    method: request.method,
    headers,
    body: request.body || null,
    timeoutMs: 20000,
    maxRedirects, // 0 por defecto: ver el 30x en crudo, no perseguirlo
  });

  const body = (resp.text || '').slice(0, MAX_RESPONSE_BYTES);
  const send = {
    ts: new Date().toISOString(),
    method: request.method,
    url,
    target: request.target,
    requestRaw: raw.slice(0, MAX_BODY_BYTES),
    requestHeaders: headers,
    maxRedirects,
    status: resp.status,
    statusText: resp.error || '',
    length: body.length,
    headers: resp.headers || {},
    responseBody: body,
    diffable: extractDiffable(resp),
  };
  return { ok: true, send };
}

module.exports = {
  parseRawRequest,
  absoluteUrl,
  effectiveHeaders,
  diffResponses,
  extractDiffable,
  sendRaw,
  toFinding,
  BROWSER_UA,
};
