'use strict';

// ============================================================================
// hls-proxy-audit.js — check de seguridad: proxies HLS mal configurados
//
// QUÉ DETECTA
// Los proxies HLS que reescriben manifiestos (el patrón de KNK, iptv-simple,
// muchos reverse-proxies de cámaras) son seguros SOLO si validan el host del
// recurso embebido. El fallo clásico es aceptar `?url=<cualquier cosa>` y
// reescribir todo sin más: cualquiera puede usar ese proxy como túnel para
// alcanzar hosts ajenos (SSRF hacia redes internas, evitación de allowlists
// del navegador y filtrado de salida). Este módulo analiza un manifiesto m3u8
// y determina si el proxy que lo sirvió reescribe hosts ajenos:
//
//   * PASIVO: sobre un manifiesto ya descargado. Detecta el patrón de
//     reescritura (recurso embebido en la query: ?url=…&u=…) y comprueba si
//     el host embebido difiere del host del propio manifiesto.
//   * SONDA ACTIVA (opt-in, nunca por defecto): pide al proxy el PRIMER
//     recurso reescrito y mira SOLO el código de estado que el PROXY responde
//     (200/206 ⇒ reenvió a un host ajeno; 400/403/502 ⇒ valida y rechaza).
//     Nunca se contacta con el objetivo directamente: toda petición va a
//     través del proxy auditado, que es quien elige a qué hablar.
//
// QUÉ NO HACE
//   * no reproduce vídeo ni descarga segmentos completos (solo cabeceras);
//   * no prueba credenciales ni explota nada;
//   * la conclusión es un HALLAZGO CANDIDATO con evidencia, no una verdicto
//     legal: la verificación final y el alcance son de la persona.
// ============================================================================

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024; // mismo tope que el proxy de KNK
const PROBE_TIMEOUT_MS = 12000;

// Recurso embebido en la query del proxy: ?url=https%3A%2F%2F… | ?u=… | ?src=…
const PROXY_QUERY_KEYS = new Set(['url', 'u', 'src', 'stream', 'target', 'hls']);
const ABSOLUTE_URL_LINE = /^https?:\/\//i;
const SCHEME_RELATIVE = /^\/\//;

/** Hostname de una URL o null. Sin sorpresas: nada de third-party en esto. */
function hostOf(u) {
  try { return new URL(String(u)).hostname.toLowerCase(); } catch { return null; }
}

/** Extrae la URL embebida de una línea tipo proxy, o null. */
function embeddedUrl(line) {
  const q = line.indexOf('?');
  if (q < 0) return null;
  let params;
  try { params = new URLSearchParams(line.slice(q + 1)); } catch { return null; }
  for (const key of PROXY_QUERY_KEYS) {
    const v = params.get(key);
    if (v && ABSOLUTE_URL_LINE.test(v)) return v;
  }
  return null;
}

/**
 * Análisis pasivo de un manifiesto m3u8.
 * @returns {object} análisis { kind, finding, proxySuspected, foreignHost,
 *   manifestHost, allowlisted, segments, embedded, checks, score, analyzedAt }
 */
function analyzeManifest({ url, body } = {}) {
  const manifestHost = hostOf(url);
  const text = String(body == null ? '' : body);
  const truncated = text.length > MAX_MANIFEST_BYTES;
  const lines = text.slice(0, MAX_MANIFEST_BYTES).split(/\r?\n/);

  const checks = [];
  const embedded = [];
  let segments = 0;
  let proxyLines = 0;
  let absoluteLines = 0;
  let dataKey = false;
  let externalKey = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY')) {
      if (/URI="data:/i.test(line)) dataKey = true;
      else {
        const m = /URI="([^"]+)"/i.exec(line);
        if (m) externalKey = m[1];
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    segments++;
    if (PROXY_QUERY_KEYS.size && embeddedUrl(line)) { proxyLines++; embedded.push({ line: line.slice(0, 200), target: embeddedUrl(line) }); }
    else if (ABSOLUTE_URL_LINE.test(line)) absoluteLines++;
    else if (SCHEME_RELATIVE.test(line)) { /* relativo al origen: sin riesgo */ }
  }

  // Host embebido dominante (el que el proxy reenviaría de verdad)
  const hostCounts = new Map();
  for (const e of embedded) {
    const h = hostOf(e.target);
    if (!h) continue;
    hostCounts.set(h, (hostCounts.get(h) || 0) + 1);
  }
  let foreignHost = null;
  let foreignCount = 0;
  for (const [h, n] of hostCounts) {
    if (manifestHost && h === manifestHost) continue;
    if (n > foreignCount) { foreignHost = h; foreignCount = n; }
  }

  const proxySuspected = proxyLines > 0;
  const sameHostOnly = proxySuspected && foreignHost === null;
  const isForeignRewrite = proxySuspected && !!foreignHost;

  let allowlisted = null;
  if (foreignHost) {
    try {
      const router = require('./public-webcams-router'); // reutiliza LA allowlist real
      if (typeof router.hlsHostAllowed === 'function') {
        allowlisted = router.hlsHostAllowed(`https://${foreignHost}/`);
      }
    } catch { allowlisted = null; }
  }

  if (isForeignRewrite) {
    checks.push({ id: 'proxy-pattern', severity: 'info', detail: `el manifiesto usa reescritura tipo proxy (${proxyLines} de ${segments} recursos llevan el recurso embebido en la query)` });
    checks.push({ id: 'foreign-host-rewrite', severity: 'high', detail: `el proxy reescribe recursos de un host AJENO (${foreignHost}, ${foreignCount} recurso(s)) distinto del origen del manifiesto (${manifestHost}) — si no valida el destino, es un proxy abierto` });
    if (allowlisted === true) checks.push({ id: 'host-allowlisted', severity: 'info', detail: `${foreignHost} está en una allowlist pública conocida (p. ej. la de KNK): reduce el riesgo, no lo elimina` });
    else if (allowlisted === false) checks.push({ id: 'host-not-allowlisted', severity: 'high', detail: `${foreignHost} NO pertenece a ninguna allowlist pública conocida: el destino embebido es arbitrario` });
  } else if (sameHostOnly) {
    checks.push({ id: 'proxy-pattern', severity: 'info', detail: `reescritura tipo proxy presente, pero los recursos embebidos apuntan al propio host del manifiesto (${manifestHost})` });
  } else if (absoluteLines > 0) {
    checks.push({ id: 'absolute-segments', severity: 'info', detail: `${absoluteLines} recursos con URL absoluta sin patrón de proxy embebido` });
  }
  if (externalKey && !dataKey) checks.push({ id: 'external-key', severity: 'low', detail: `EXT-X-KEY externa (${String(externalKey).slice(0, 120)}): el cliente tendría que negociar claves fuera del origen` });
  if (dataKey) checks.push({ id: 'inline-key', severity: 'info', detail: 'EXT-X-KEY embebida (data:): sin petición extra' });

  let kind;
  let finding;
  let score = 0;
  if (isForeignRewrite) {
    kind = 'foreign-host-rewrite';
    score = 55;
    if (allowlisted === false) score += 20;
    if (absoluteLines === 0 && segments === proxyLines) score += 5; // TODO el tráfico va por el proxy
  } else if (proxySuspected) {
    kind = 'same-host-rewrite';
  } else {
    kind = 'no-proxy-pattern';
  }

  return {
    kind,
    finding: isForeignRewrite,
    proxySuspected,
    foreignHost,
    foreignCount,
    manifestHost,
    allowlisted,
    segments,
    embedded: embedded.slice(0, 8),
    checks,
    score: Math.min(100, score),
    truncated,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Sonda activa (opt-in): confirma si el proxy REENVÍA de verdad al host ajeno.
 * Devuelve el veredicto del PROXY, sin contactar jamás con el destino directo.
 * @param {object} opts { analysis, fetchImpl }
 * @returns {Promise<object>} { ok, attempted, reachable, status, latencyMs, note }
 */
async function probeProxy({ analysis, fetchImpl, headers } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (!analysis || !analysis.finding || !analysis.embedded.length) {
    return { ok: false, attempted: false, reason: 'no hay reescritura de host ajeno que sondar' };
  }
  if (typeof f !== 'function') return { ok: false, attempted: false, reason: 'sin fetch disponible' };

  // La URL de la petición es el PROXY (la línea reescrita del manifiesto);
  // el host ajeno viaja embebido, como haría un cliente legítimo del proxy.
  const target = analysis.embedded[0].line;
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const res = await f(target, { signal: controller.signal, headers: { 'User-Agent': 'knkSuite-HLS-Audit/1.0', Range: 'bytes=0-0', ...(headers || {}) }, redirect: 'manual' });
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    const status = res.status;
    // 200/206/2xx/3xx-manual: el proxy reenvió al host ajeno (o al menos lo intentó)
    const reachable = status >= 200 && status < 400;
    return {
      ok: true,
      attempted: true,
      reachable,
      status,
      latencyMs,
      note: reachable
        ? `el proxy respondió ${status} ante un recurso de un host ajeno: reenvío confirmado`
        : `el proxy respondió ${status}: valida el destino y rechaza el recurso ajeno`,
    };
  } catch (e) {
    return { ok: true, attempted: true, reachable: false, status: 0, latencyMs: Date.now() - started, note: `inconcluso (${String(e && e.message ? e.message : e).slice(0, 80)})` };
  }
}

module.exports = {
  analyzeManifest,
  probeProxy,
  hostOf,
  embeddedUrl,
  PROXY_QUERY_KEYS,
  PROBE_TIMEOUT_MS,
};
