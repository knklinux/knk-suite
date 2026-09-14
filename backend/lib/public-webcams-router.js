'use strict';

// ============================================================================
// public-webcams-router.js — rutas de cámaras
//
// Se monta bajo `/api` (ya protegido por auth.requireToken en index.js) y
// agrupa las cuatro familias del módulo de cámaras:
//
//   /cameras/public/*   fuentes públicas oficiales (DGT, Madrid, TfL, …)
//   /cameras/local/*    la LAN del usuario, servida por el relé same-origin
//   /cameras/exposed/*  índices públicos de cámaras expuestas (solo metadatos)
//   /cameras/exposed/findings
//                       convierte esos objetivos en hallazgos de la misión,
//                       cada uno con su evidencia en disco
//
// Todo se sirve desde el propio backend: el renderer nunca habla con el origen,
// así que no hay que abrir el CSP del workbench de escritorio ni lidiar con
// CORS o contenido mixto.
// ============================================================================

const express = require('express');
const db = require('../db');
const publicWebcams = require('./public-webcams');
const lanRelay = require('./lan-relay');
const exposedCameras = require('./exposed-cameras');
const cameraFindings = require('./camera-findings');
const hlsAudit = require('./hls-proxy-audit');

const router = express.Router();

// Algunas cámaras de tráfico devuelven el fichero vacío de forma intermitente
// mientras se regenera el snapshot. Un reintento corto evita el falso "no
// disponible" sin martillear a la fuente.
async function snapshotWithRetry(params) {
  const first = await publicWebcams.getSnapshot(params);
  if (first.ok || first.error !== 'imagen vacía') return first;
  await new Promise((resolve) => setTimeout(resolve, 700));
  return publicWebcams.getSnapshot(params);
}

// ── catálogo de fuentes públicas ────────────────────────────────────

// Categorías, país, atribución y estado de configuración.
router.get('/cameras/public/sources', (req, res) => {
  res.json({
    ok: true,
    sources: publicWebcams.listSources(),
    kindLabels: publicWebcams.KIND_LABELS,
    allSource: { id: 'all', label: 'Todas las fuentes', kind: 'all', region: 'Mundo' },
    semantics: 'public-live-feed',
    note: 'Solo fuentes públicas oficiales. El snapshot se sirve por el proxy local.',
  });
});

// Listado de cámaras. `source=all` agrega todas las fuentes activas; una fuente
// que falle se reporta en `sources` sin tumbar la vista agregada.
router.get('/cameras/public', async (req, res) => {
  const { source, lat, lon, radius, q, kind, limit, page } = req.query;
  try {
    const result = await publicWebcams.listCameras({
      source: source || 'all',
      lat,
      lon,
      radiusKm: radius,
      q,
      kind,
      limit,
      page,
    });
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message, cameras: [] });
  }
});

// Snapshot JPEG de una cámara pública (proxy same-origin).
router.get('/cameras/public/snapshot', async (req, res) => {
  const { source, id } = req.query;
  try {
    const result = await snapshotWithRetry({ source, id });
    if (!result.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({ ok: false, error: result.error });
    }
    res.set({
      'Content-Type': result.contentType,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': String(result.buffer.length),
      'X-Cam-Source': String(source || ''),
      'X-Cam-Fetched-At': String(result.fetchedAt || ''),
    });
    res.end(result.buffer);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── HLS Stream Proxy ─────────────────────────────────────────────
// Proxy same-origin para HLS (.m3u8): el renderer (Tauri, CSP cerrado) nunca
// habla con el origen remoto. Reescribe manifiestos completos — playlists
// anidadas, segmentos, EXT-X-MAP y EXT-X-KEY — y hace pipe de los segmentos
// sin bufferizarlos. Sin `Access-Control-Allow-Origin: *` a propósito: con
// credenciales (cookie knk_token) el comodín rompería la petición.
//
// NOTA DE BUILD: el .exe de Tauri empaqueta `backend/` en resources; los
// cambios de este fichero exigen `tauri build` + reiniciar la app. Reiniciar
// solo el proceso node reutiliza el bundle viejo.
const http_hls = require('http');
const https_hls = require('https');
const dns_hls = require('dns').promises;

// Hosts permitidos para HLS: fuentes oficiales + señales de prueba estables.
const HLS_HOSTS = [
  /(^|\.)511ny\.org$/i,
  /(^|\.)nysdot\.skyvdn\.com$/i,
  /(^|\.)dot\.ca\.gov$/i,
  /(^|\.)digitraffic\.fi$/i,
  /(^|\.)vegagerdin\.is$/i,
  /(^|\.)tfl\.gov\.uk$/i,
  /(^|\.)dgt\.es$/i,
  /(^|\.)madrid\.es$/i,
  /^devstreaming-cdn\.apple\.com$/i,
  /^test-streams\.mux\.dev$/i,
  /^demo\.unified-streaming\.com$/i,
  // CDN público de Chaturbate: solo sirve con token efímero por sala (el
  // token va en la propia URL; sin token válido el upstream responde 403).
  /(^|\.)live\.mmcdn\.com$/i,
  /(^|\.)thumb\.live\.mmcdn\.com$/i,
];

function hlsHostAllowed(remoteUrl) {
  try {
    const h = new URL(String(remoteUrl)).hostname.toLowerCase();
    return HLS_HOSTS.some((re) => re.test(h));
  } catch { return false; }
}

// Reescribe un manifiesto m3u8 para que cada recurso pase por el proxy.
function rewriteM3U8(text, manifestUrl) {
  let out = String(text || '');
  // 1. Atributos URI="..." (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA...).
  out = out.replace(/URI="([^"]+)"/g, (m, uri) => {
    if (/^(data:|blob:)/i.test(uri)) return m;
    let abs;
    try { abs = new URL(uri, manifestUrl).toString(); } catch { return m; }
    if (!hlsHostAllowed(abs)) return m;
    return `URI="/api/cameras/public/hls-seg?url=${encodeURIComponent(abs)}"`;
  });
  // 2. Líneas de recurso (no empiezan por #): playlists anidadas y segmentos,
  //    con o sin query (?token=...), rutas relativas o absolutas.
  out = out.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    let abs;
    try { abs = new URL(t, manifestUrl).toString(); } catch { return line; }
    if (!hlsHostAllowed(abs)) return line;
    return `/api/cameras/public/hls-seg?url=${encodeURIComponent(abs)}`;
  }).join('\n');
  return out;
}

function proxyHLS(remoteUrl, req, res, opts = {}) {
  const timeoutMs = opts.timeoutMs || 30000;
  let mod;
  try {
    mod = String(remoteUrl).startsWith('https') ? https_hls : http_hls;
  } catch {
    if (!res.headersSent) res.status(400).json({ ok: false, error: 'URL HLS inválida' });
    return;
  }
  const headers = { 'User-Agent': 'knkSuite-HLS/1.0' };
  if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 100);
  let proxyReq;
  try {
    // agent:false: sin keep-alive. Algunos edges atan la sesión al socket y
    // un socket aparcado en el pool invalida la siguiente petición.
    proxyReq = mod.get(remoteUrl, { timeout: timeoutMs, headers, agent: false }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        let next = null;
        try { next = new URL(proxyRes.headers.location, remoteUrl).toString(); } catch {}
        if (next && hlsHostAllowed(next)) return proxyHLS(next, req, res, opts);
        if (!res.headersSent) res.status(502).json({ ok: false, error: 'Redirección HLS fuera de la allowlist' });
        return;
      }
      if (proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206) {
        // Se propaga el código real (401/403/404 = token/sala muertos y el
        // frontal renueva solo; 5xx/red = 502). Antes todo era 502 y la
        // auto-renovación nunca saltaba.
        const code = proxyRes.statusCode >= 400 && proxyRes.statusCode < 500 ? proxyRes.statusCode : 502;
        if (!res.headersSent) res.status(code).json({ ok: false, error: `HLS upstream ${proxyRes.statusCode}` });
        proxyRes.resume();
        return;
      }
      const ct = String(proxyRes.headers['content-type'] || 'application/octet-stream');
      const isM3U8 = /mpegurl/i.test(ct) || /\.m3u8($|\?)/i.test(String(remoteUrl));
      if (isM3U8) {
        // Manifiesto: se reescribe → buffer acotado a 2 MB.
        const chunks = [];
        let size = 0;
        proxyRes.on('data', (c) => {
          chunks.push(c); size += c.length;
          if (size > 2 * 1024 * 1024) { try { proxyReq.destroy(); } catch {} }
        });
        proxyRes.on('end', () => {
          try {
            const rewritten = rewriteM3U8(Buffer.concat(chunks).toString('utf8'), String(remoteUrl));
            const buf = Buffer.from(rewritten, 'utf8');
            res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Content-Length': String(buf.length) });
            res.end(buf);
          } catch (e) { if (!res.headersSent) res.status(502).json({ ok: false, error: e.message }); }
        });
        proxyRes.on('error', () => { if (!res.headersSent) res.status(502).json({ ok: false, error: 'Error leyendo manifiesto HLS' }); });
        return;
      }
      // Segmento (.ts/.m4s/.mp4/.aac): pipe directo, sin buffer, con Range.
      const outHeaders = { 'Cache-Control': 'no-store' };
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (proxyRes.headers[h]) outHeaders[h.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-')] = proxyRes.headers[h];
      }
      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res);
    });
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
    return;
  }
  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
    else try { res.destroy(); } catch {}
  });
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) res.status(504).json({ ok: false, error: 'HLS timeout' });
  });
}

function fetchUpstreamText(remoteUrl, timeoutMs = 15000, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let mod;
    try { mod = String(remoteUrl).startsWith('https') ? https_hls : http_hls; }
    catch { return reject(new Error('URL inválida')); }
    const rq = mod.get(remoteUrl, { timeout: timeoutMs, headers: { 'User-Agent': 'knkSuite-HLS/1.0' }, agent: false }, (rs) => {
      if (rs.statusCode >= 300 && rs.statusCode < 400 && rs.headers.location) {
        let next = null;
        try { next = new URL(rs.headers.location, remoteUrl).toString(); } catch {}
        if (next) return fetchUpstreamText(next, timeoutMs, maxBytes).then(resolve, reject);
        return reject(new Error(`redirect ${rs.statusCode}`));
      }
      if (rs.statusCode !== 200) return reject(new Error(`upstream ${rs.statusCode}`));
      const chunks = [];
      let size = 0;
      rs.on('data', (c) => { chunks.push(c); size += c.length; if (size > maxBytes) rq.destroy(); });
      rs.on('end', () => resolve({ status: rs.statusCode, contentType: rs.headers['content-type'] || '', body: Buffer.concat(chunks).toString('utf8') }));
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
  });
}

router.get('/cameras/public/hls', (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ ok: false, error: 'Falta ?url=http(s)://…' });
  if (!hlsHostAllowed(url)) return res.status(403).json({ ok: false, error: 'Host no permitido para HLS', hint: 'Usa el módulo «En Directo» → URL personalizada (/api/live/custom), solo hosts públicos.' });
  proxyHLS(String(url), req, res);
});

router.get('/cameras/public/hls-seg', (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).end();
  if (!hlsHostAllowed(url)) return res.status(403).end();
  proxyHLS(String(url), req, res);
});

// HLS de URL propia (pestaña «URL personalizada»): mismos guards anti-SSRF
// que el proxy de imagen (solo hosts públicos, sin RFC1918 ni metadata).
router.get('/cameras/public/hls-custom', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ ok: false, error: 'Falta ?url=' });
  if (hlsHostAllowed(url)) return proxyHLS(String(url), req, res);
  const chk = await mediaTargetAllowed(String(url));
  if (!chk.ok) return res.status(403).json({ ok: false, error: chk.error });
  proxyHLS(String(url), req, res);
});

// Diagnóstico HLS: upstream, manifiesto y primeros segmentos (para el botón «Probar»).
router.get('/cameras/public/hls-check', async (req, res) => {
  const { url } = req.query;
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ ok: false, error: 'Falta ?url=' });
  let customOk = false;
  if (!hlsHostAllowed(url)) {
    const chk = await mediaTargetAllowed(String(url));
    if (!chk.ok) return res.json({ ok: false, error: 'Host no permitido para HLS', allowed: false, detail: chk.error });
    customOk = true;
  }
  try {
    const man = await fetchUpstreamText(String(url));
    const rewritten = rewriteM3U8(man.body, String(url));
    const segUrls = [];
    for (const line of man.body.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      try {
        const abs = new URL(t, String(url)).toString();
        if (hlsHostAllowed(abs)) segUrls.push(abs);
      } catch {}
      if (segUrls.length >= 3) break;
    }
    // Comprueba el primer segmento con un rango de 1 byte (barato).
    let firstSeg = null;
    if (segUrls.length) {
      firstSeg = await new Promise((resolve) => {
        const mod = segUrls[0].startsWith('https') ? https_hls : http_hls;
        const rq = mod.get(segUrls[0], { timeout: 12000, headers: { 'User-Agent': 'knkSuite-HLS/1.0', Range: 'bytes=0-0' } }, (rs) => {
          resolve({ ok: rs.statusCode === 200 || rs.statusCode === 206, status: rs.statusCode, contentType: rs.headers['content-type'] || '' });
          rs.resume();
        });
        rq.on('error', (e) => resolve({ ok: false, error: e.message }));
        rq.on('timeout', () => { rq.destroy(); resolve({ ok: false, error: 'timeout' }); });
      });
    }
    res.json({
      ok: true, allowed: true,
      upstream: { status: man.status, contentType: man.contentType, bytes: man.body.length },
      segmentsFound: segUrls.length, firstSegment: firstSeg,
      rewrittenPreview: rewritten.split('\n').slice(0, 12).join('\n').slice(0, 1200),
    });
  } catch (e) {
    res.json({ ok: false, allowed: true, error: e.message });
  }
});

// ── Proxy genérico de imagen/MJPEG ─────────────────────────────────
// Para EarthCam/Insecam/miniaturas: el renderer solo habla same-origin.
// Guards anti-SSRF: solo http/https, sin credenciales, puertos habituales,
// hostname público (se resuelve DNS y se rechaza RFC1918/metadata), máx 3
// redirecciones (revalidadas), tope 8 MB, timeout 15 s.
const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
const MEDIA_PORTS = new Set(['', '80', '81', '82', '83', '443', '800', '8000', '8001', '8080', '8081', '8082', '8083', '8084', '8085', '8088', '8089', '8090', '8443', '8888', '9000', '5000', '5001']);
const MEDIA_BLOCKED_NAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|169\.254\.169\.254|metadata\.google\.internal|instance-data)$/i;

function ipIsPublicLiteral(ip) {
  const v = String(ip || '');
  if (/^10\./.test(v)) return false;
  if (/^192\.168\./.test(v)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return false;
  if (/^(127\.|0\.|169\.254\.|224\.|225\.|22[4-9]|23\d\.|169\.254)/.test(v)) return false;
  if (/^(::1|::$|::$|fc|fd|fe80|fe90|fea|feb|fec|fed|fee|fef)/i.test(v.replace(/:/g, '')) ) return false;
  if (/^::$/.test(v) || /^::1$/.test(v) || /^::$/.test(v)) return false;
  if (/^[0-9a-f:]+$/i.test(v) && (v === '::1' || /^fc/i.test(v) || /^fd/i.test(v) || /^fe[89ab]/i.test(v))) return false;
  return true;
}

async function mediaTargetAllowed(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return { ok: false, error: 'URL inválida' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Solo http/https' };
  if (u.username || u.password) return { ok: false, error: 'Sin credenciales en la URL' };
  if (!MEDIA_PORTS.has(u.port)) return { ok: false, error: `Puerto no permitido (${u.port || (u.protocol === 'https:' ? 443 : 80)})` };
  const host = u.hostname.toLowerCase();
  if (MEDIA_BLOCKED_NAMES.test(host)) return { ok: false, error: 'Host bloqueado' };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (!ipIsPublicLiteral(host)) return { ok: false, error: 'IP privada/bloqueada' };
    return { ok: true };
  }
  if (host === '[::1]' || host === '::1') return { ok: false, error: 'IP privada/bloqueada' };
  try {
    const [v4, v6] = await Promise.all([
      dns_hls.resolve4(host).catch(() => []),
      dns_hls.resolve6(host).catch(() => []),
    ]);
    const ips = [...v4, ...v6];
    if (!ips.length) return { ok: false, error: 'Sin resolución DNS' };
    if (!ips.every(ipIsPublicLiteral)) return { ok: false, error: 'El host resuelve a IP privada/bloqueada' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Sin resolución DNS' };
  }
}

function proxyMedia(remoteUrl, req, res, { stream = false } = {}) {
  const mod = String(remoteUrl).startsWith('https') ? https_hls : http_hls;
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) knkSuite-Media/1.0' };
  try {
    const h = new URL(String(remoteUrl)).hostname.toLowerCase();
    if (h.includes('earthcam.com')) headers.Referer = 'https://www.earthcam.com/';
  } catch {}
  if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 100);
  let proxyReq;
  try {
    proxyReq = mod.get(remoteUrl, { timeout: 15000, headers }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        // Las redirecciones se revalidan fuera (el llamante re-llama tras validar).
        if (!res.headersSent) res.status(502).json({ ok: false, error: 'Redirección no seguida por seguridad; reintenta' });
        proxyRes.resume();
        return;
      }
      if (proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206) {
        if (!res.headersSent) res.status(502).json({ ok: false, error: `Upstream ${proxyRes.statusCode}` });
        proxyRes.resume();
        return;
      }
      const ct = String(proxyRes.headers['content-type'] || '');
      const okType = /^(image\/|multipart\/x-mixed-replace|video\/)/i.test(ct) || (stream && /octet-stream/i.test(ct));
      if (!okType) {
        if (!res.headersSent) res.status(502).json({ ok: false, error: `Tipo no imagen/vídeo (${ct || 'desconocido'})` });
        proxyRes.resume();
        return;
      }
      if (stream) {
        const out = { 'Cache-Control': 'no-store' };
        for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          if (proxyRes.headers[h]) out[h.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-')] = proxyRes.headers[h];
        }
        res.writeHead(proxyRes.statusCode, out);
        proxyRes.pipe(res);
        return;
      }
      const chunks = [];
      let size = 0;
      proxyRes.on('data', (c) => {
        chunks.push(c); size += c.length;
        if (size > MEDIA_MAX_BYTES) { try { proxyReq.destroy(); } catch {} }
      });
      proxyRes.on('end', () => {
        const buf = Buffer.concat(chunks);
        res.set({ 'Content-Type': ct || 'image/jpeg', 'Cache-Control': 'no-store, max-age=0', 'Content-Length': String(buf.length) });
        res.end(buf);
      });
    });
  } catch (e) {
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
    return;
  }
  proxyReq.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ ok: false, error: e.message });
    else try { res.destroy(); } catch {}
  });
  proxyReq.on('timeout', () => { proxyReq.destroy(); if (!res.headersSent) res.status(504).json({ ok: false, error: 'timeout' }); });
}

async function proxyMediaGuarded(remoteUrl, req, res, opts) {
  let current = String(remoteUrl);
  for (let i = 0; i < 4; i++) {
    const chk = await mediaTargetAllowed(current);
    if (!chk.ok) {
      if (!res.headersSent) res.status(403).json({ ok: false, error: chk.error });
      return;
    }
    // Sigue redirecciones manualmente para revalidar cada salto.
    const hop = await new Promise((resolve) => {
      const mod = current.startsWith('https') ? https_hls : http_hls;
      const rq = mod.get(current, { timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0 knkSuite-Media/1.0' } }, (rs) => {
        if (rs.statusCode >= 300 && rs.statusCode < 400 && rs.headers.location) {
          let next = null;
          try { next = new URL(rs.headers.location, current).toString(); } catch {}
          rs.resume();
          return resolve({ redirect: next });
        }
        rs.destroy();
        resolve({ ready: true, status: rs.statusCode, contentType: rs.headers['content-type'] || '' });
      });
      rq.on('error', (e) => resolve({ error: e.message }));
      rq.on('timeout', () => { rq.destroy(); resolve({ error: 'timeout' }); });
    });
    if (hop.error) {
      if (!res.headersSent) res.status(502).json({ ok: false, error: hop.error });
      return;
    }
    if (hop.redirect) { current = hop.redirect; continue; }
    if (hop.ready) return proxyMedia(current, req, res, opts);
    if (!res.headersSent) res.status(502).json({ ok: false, error: 'Upstream sin respuesta' });
    return;
  }
  if (!res.headersSent) res.status(502).json({ ok: false, error: 'Demasiadas redirecciones' });
}

router.get('/cameras/media/img', async (req, res) => {
  const { url, stream } = req.query;
  if (!url || !/^https?:\/\//i.test(String(url))) return res.status(400).json({ ok: false, error: 'Falta ?url=http(s)://…' });
  await proxyMediaGuarded(String(url), req, res, { stream: stream === '1' || stream === 'true' });
});

// Resolver Insecam: dada una página /en/view/NNN/, extrae imagen/stream
// directos en el servidor para que la UI los pinte por el proxy (nunca la
// URL remota en el renderer). Si el scrape sale vacío, la UI muestra el
// directorio curado + «abrir ficha» en vez de una tarjeta rota.
async function resolveInsecamView(url) {
  if (!url || !/^https?:\/\/(www\.)?insecam\.org\/en\/view\//i.test(String(url))) {
    return { ok: false, url, error: 'URL insecam /en/view/… requerida' };
  }
  try {
    const html = (await fetchUpstreamText(String(url), 15000, 2 * 1024 * 1024)).body;
    const title = ((html.match(/<title>([^<]{0,200})<\/title>/i) || [])[1] || '').trim();
    const og = ((html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1] || null);
    const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
      .map((m) => m[1])
      .filter((s) => /\.(jpe?g|png|mjpg|mjpeg)(\?|$)/i.test(s) || /snapshot|image|picture|cam/i.test(s))
      .slice(0, 5);
    const m3u8 = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?/gi)].map((m) => m[0]).slice(0, 3);
    const mjpeg = [...html.matchAll(/https?:\/\/[^"'\s<>]+(?:mjpg|mjpeg|video\.cgi)[^"'\s<>]*/gi)].map((m) => m[0]).slice(0, 5);
    return { ok: true, url, title, image: og, images: imgs, hls: m3u8, mjpeg };
  } catch (e) {
    return { ok: false, url, error: e.message };
  }
}

router.get('/cameras/sources/insecam/resolve', async (req, res) => {
  res.json(await resolveInsecamView(req.query.url));
});

// Lote: hasta 12 fichas con concurrencia 3 (cola simple). Cada ficha usa el
// mismo resolver con caché de 10 min en memoria.
const _insecamBatchCache = new Map();
router.post('/cameras/sources/insecam/resolve-batch', async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 12) : [];
  if (!urls.length) return res.status(400).json({ ok: false, error: 'urls[] requerido (máx 12)' });
  const out = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next++;
      const url = String(urls[i] || '');
      const hit = _insecamBatchCache.get(url);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) { out[i] = { ...hit.data, cached: true }; continue; }
      const data = await resolveInsecamView(url);
      _insecamBatchCache.set(url, { at: Date.now(), data });
      if (_insecamBatchCache.size > 200) _insecamBatchCache.delete(_insecamBatchCache.keys().next().value);
      out[i] = data;
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  res.json({ ok: true, total: out.length, resolved: out.filter((r) => r.ok).length, results: out });
});

// ── cámaras de la LAN del usuario ───────────────────────────────────
// Validación estricta en lan-relay: RFC1918, puertos HTTP de cámara, sin
// credenciales en la URL, sin redirecciones y solo respuestas de imagen/MJPEG.

// Stream continuo: MJPEG en directo o un fotograma suelto, reenviado en cuanto
// el origen responde, de modo que un MJPEG nunca agota un timeout de buffer.
router.get('/cameras/local/stream', async (req, res) => {
  const { url } = req.query;
  try {
    await lanRelay.proxyLocalStream(url, res);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: e.message });
    else res.destroy();
  }
});

// Fotograma único (fallback para cámaras que solo exponen snapshot).
router.get('/cameras/local/relay', async (req, res) => {
  const { url } = req.query;
  try {
    const result = await lanRelay.relayLocalSnapshot(url);
    if (!result.ok) {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({ ok: false, error: result.error });
    }
    res.set({
      'Content-Type': result.contentType,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Length': String(result.buffer.length),
      'X-Cam-Relay': 'private-lan-snapshot',
    });
    res.end(result.buffer);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Diagnóstico: ¿por qué esta URL no se puede relayar? La UI lo usa para no
// mostrar un reproductor roto sin explicación.
router.get('/cameras/local/check', (req, res) => {
  const { url } = req.query;
  const reason = lanRelay.relayBlockReason(url);
  res.json({ ok: !reason, url: String(url || ''), reason, relayable: !reason });
});

// ── cámaras expuestas en índices públicos ───────────────────────────
// Solo metadatos de buscadores públicos: este módulo no contacta objetivos.

// Catálogo para construir los filtros de la UI (países, servicios, presets…).
router.get('/cameras/exposed/options', (req, res) => {
  res.json({ ok: true, ...exposedCameras.options() });
});

// Búsqueda: plan de consultas por plataforma + análisis de los objetivos.
// Es POST porque la lista de IPs/CIDR puede ser larga y con caracteres sucios.
router.post('/cameras/exposed/search', async (req, res) => {
  try {
    const result = await exposedCameras.searchExposed(req.body || {});
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message, targets: [], queryPlan: { platforms: [], dorks: [], cli: [] } });
  }
});

// ── de objetivos analizados a hallazgos de la misión ────────────────

/**
 * Adaptador mínimo entre el módulo de conversión y SQLite. Los hallazgos se
 * guardan con la forma de la tabla (`type/summary/severity/details`) y la
 * evidencia (un .txt por objetivo) queda en `~/.knk-suite/evidencia` y en la
 * tabla `evidence`, de modo que el informe puede citarla.
 */
function findingsStore(sessionId) {
  return {
    listFindings: (sid) => db.getFindings(sid),
    addFinding: (row) => db.addFinding(sessionId, row.type, row.summary, row.severity, row.details),
    addEvidence: ({ name, type, filePath }) => db.stmts.insertEvidence.run(sessionId, null, name, type, filePath),
  };
}

// Convierte los objetivos que el usuario ya analizó en hallazgos + evidencia.
// No vuelve a consultar internet: recibe lo que el análisis mostró y lo
// re-sanea/re-puntúa en el servidor antes de guardarlo.
router.post('/cameras/exposed/findings', (req, res) => {
  try {
    const body = req.body || {};
    const targets = Array.isArray(body.targets) ? body.targets : [];
    if (!targets.length) {
      return res.json({ ok: false, error: 'sin objetivos: analiza primero en Cámaras Expuestas y selecciona los que quieras registrar' });
    }
    const session = db.getOrCreateSession();
    const result = cameraFindings.convertAndStore({
      targets: targets.slice(0, cameraFindings.DEFAULTS.limit),
      sessionId: session.id,
      store: findingsStore(session.id),
      opts: {
        minScore: body.minScore,
        includeInfo: body.includeInfo,
        onlyVulns: body.onlyVulns,
        limit: body.limit,
        severityFloor: body.severityFloor,
        sessionTarget: session.target || null,
      },
    });
    if (!result.ok) return res.status(400).json(result);
    res.json({ ...result, sessionId: session.id, totalFindings: db.getFindings(session.id).length });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Vista previa del mismo plan, sin escribir nada: qué se convertiría, con qué
// severidad y qué se descarta. La UI la usa para avisar antes de tocar la BD.
// ── Check de seguridad: proxy HLS mal configurado ───────────────────
// Analiza un manifiesto m3u8 y detecta si el proxy que lo sirve reescibe
// recursos de hosts ajenos al origen (patrón de proxy abierto: túnel
// SSRF / evitación de allowlists). Con create:true lo convierte en
// hallazgo de la misión con evidencia (mismo almacén que los hallazgos
// de exposición). La sonda activa es opt-in (probe:true) y habla SOLO
// con el proxy auditado, nunca con el destino directo.
// ¿La petición entrante trae la cookie de sesión de KNK? Sin regex con
// escapes: split + startsWith es igual de claro y no se puede romper.
function knkCookiePresent(cookieHeader) {
  if (!cookieHeader) return false;
  const SEP = String.fromCharCode(59); // ;
  for (const part of String(cookieHeader).split(SEP)) {
    if (part.trim().startsWith('knk_token=')) return true;
  }
  return false;
}

router.post('/cameras/exposed/hls-audit', async (req, res) => {
  try {
    const body = req.body || {};
    const manifestUrl = typeof body.url === 'string' ? body.url.trim() : '';
    if (!/^https?:\/\//i.test(manifestUrl)) {
      return res.status(400).json({ ok: false, error: 'Falta url del manifiesto (https://…)' });
    }
    let manifestBody = typeof body.manifest === 'string' ? body.manifest : null;
    if (!manifestBody) {
      try {
        const man = await fetchUpstreamText(manifestUrl);
        manifestBody = man.body;
      } catch (e) {
        return res.json({ ok: false, error: `No se pudo obtener el manifiesto: ${e.message}` });
      }
    }
    const analysis = hlsAudit.analyzeManifest({ url: manifestUrl, body: manifestBody });
    let probe = null;
    if (body.probe === true) {
      // La sonda habla con el PROXY (la línea reescrita del manifiesto). Si
      // esa línea es relativa (patrón de la propia KNK), se absolutiza contra
      // el origen local del backend — nunca contra un host externo.
      const localOrigin = `${req.protocol || 'http'}://${req.get('host') || '127.0.0.1:' + (process.env.KNK_PORT || 8086)}`;
      const rawTarget = analysis.embedded[0] && analysis.embedded[0].line;
      const isAbsoluteTarget = rawTarget.startsWith('http://') || rawTarget.startsWith('https://');
      if (rawTarget && !isAbsoluteTarget) {
        try { analysis.embedded[0].line = new URL(rawTarget, localOrigin).toString(); } catch { /* se sonda tal cual */ }
      }
      // Al auditar el proxy de KNK, la sonda necesita la credencial del
      // llamante (cookie knk_token); sin ella el propio gate daría 401 y el
      // veredicto sería un falso negativo.
      let probeHeaders;
      const ck = req.headers.cookie;
      if (ck && knkCookiePresent(ck)) probeHeaders = { Cookie: ck };
      probe = await hlsAudit.probeProxy({ analysis, headers: probeHeaders });
    }
    const out = { ok: true, analysis, probe };
    if (body.create === true) {
      const session = db.getOrCreateSession();
      const conv = cameraFindings.convertHlsAudit({
        analysis,
        manifestUrl,
        probe,
        store: findingsStore(session.id),
        sessionId: session.id,
        writeEvidence: ({ name, text }) => {
          const file = cameraFindings.writeEvidenceFile(cameraFindings.defaultEvidenceDir(), { name, text });
          try { db.stmts.insertEvidence.run(session.id, null, name, 'text', file); } catch {}
          return file;
        },
      });
      out.conversion = conv;
    }
    out.recommendation = cameraFindings.hlsRecommendationFor(analysis);
    res.json(out);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

router.post('/cameras/exposed/findings/preview', (req, res) => {
  try {
    const body = req.body || {};
    const targets = Array.isArray(body.targets) ? body.targets : [];
    const session = db.getOrCreateSession();
    const plan = cameraFindings.planConversion(targets, db.getFindings(session.id), {
      minScore: body.minScore,
      includeInfo: body.includeInfo,
      onlyVulns: body.onlyVulns,
      limit: body.limit,
      severityFloor: body.severityFloor,
    });
    res.json({
      ok: true,
      sessionId: session.id,
      wouldCreate: plan.accepted.map((t) => ({ ip: t.ip, severity: t.severity, score: t.score, cves: t.vulns })),
      duplicates: plan.duplicates,
      filtered: plan.filtered,
      invalid: plan.invalid,
      skipped: plan.skipped,
      bySeverity: plan.accepted.reduce((acc, t) => { acc[t.severity] = (acc[t.severity] || 0) + 1; return acc; }, {}),
      semantics: 'findings-preview',
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

module.exports = { publicCamerasRouter: router, rewriteM3U8, hlsHostAllowed };
