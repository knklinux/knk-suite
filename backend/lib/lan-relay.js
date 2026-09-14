'use strict';

// ============================================================================
// lan-relay.js — relé de streams de cámaras de la LAN del usuario
//
// PROBLEMA QUE RESUELVE
// El workbench de escritorio (Tauri) sirve la SPA desde http://127.0.0.1:8086 y
// su CSP solo permite imágenes de 'self'. Un <img src="http://192.168.1.50:8080/
// video"> se bloquea en silencio: el usuario ve "no se pudo conectar al stream"
// aunque la cámara funcione. Aquí el backend hace de proxy same-origin, así que
// el CSP no se abre a la LAN ni hay que pelear con CORS o contenido mixto.
//
// ALCANCE (deliberadamente estrecho)
//   * solo IPv4 privada RFC1918 (10/8, 172.16/12, 192.168/16);
//   * solo puertos HTTP de cámara (80, 443, 8000, 8080, 8443), que son los que
//     descubre el escáner local (camera-scanner.js → CAMERA_PORTS);
//   * nunca loopback, link-local ni endpoints de metadata;
//   * sin credenciales embebidas en la URL y sin seguir redirecciones;
//   * la respuesta debe ser image/* o multipart/x-mixed-replace, de modo que
//     el relé **no** puede usarse para leer paneles de administración (HTML)
//     de la red del usuario.
//
// Dos modos, según lo que sirva la cámara:
//   proxyLocalStream()   → stream continuo (MJPEG) o fotograma suelto, en
//                          cuanto llegan las cabeceras del origen;
//   relayLocalSnapshot() → un único fotograma completo, para el modo 📷.
//
// Nota: HTTPS se acepta con certificado autofirmado (habitual en cámaras IP)
// SOLO para IPv4 privada ya validada.
// ============================================================================

const http = require('http');
const https = require('https');

const publicWebcams = require('./public-webcams');

// Un MJPEG sano envía fotogramas de forma continua: si el origen deja de mandar
// bytes durante este tiempo, se corta en lugar de dejar la conexión viva.
const LOCAL_STREAM_IDLE_MS = 15000;
const LOCAL_SNAPSHOT_TIMEOUT_MS = 12000;
const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const USER_AGENT = 'knkLinux-LanRelay/1.0 (+workbench local; solo lectura de camaras propias)';

/** Clasifica el content-type de una cámara de la LAN: foto, MJPEG o inservible. */
function classifyLocalContentType(contentType) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!mime) return 'unknown';
  if (mime === 'multipart/x-mixed-replace') return 'mjpeg';
  if (mime.startsWith('image/')) return 'image';
  return 'unsupported';
}

/**
 * Explica, en lenguaje de usuario, por qué una URL no se puede relayar.
 * La UI lo usa para no mostrar un reproductor roto sin motivo.
 */
function relayBlockReason(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''));
  } catch {
    return 'URL inválida';
  }
  if (parsed.protocol === 'rtsp:') return 'RTSP no se puede reproducir en el navegador: ábrelo en VLC';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `protocolo no soportado (${parsed.protocol})`;
  const check = publicWebcams.validateLocalSnapshotUrl(rawUrl);
  if (!check.ok) return check.error;
  return null;
}

function failStream(clientRes, status, error) {
  if (!clientRes.headersSent) {
    clientRes.set('Cache-Control', 'no-store');
    clientRes.status(status).json({ ok: false, error });
  } else {
    clientRes.destroy();
  }
  return { ok: false, error };
}

/** Opciones de conexión para una URL ya validada de la LAN. */
function localRequestOptions(parsed, timeout) {
  const options = {
    timeout,
    headers: { 'User-Agent': USER_AGENT, accept: 'multipart/x-mixed-replace, image/*' },
  };
  // Las cámaras IP usan certificados autofirmados. Solo se relaja para IPv4
  // privada RFC1918: el destino ya está validado y es de la red del usuario.
  if (parsed.protocol === 'https:') options.rejectUnauthorized = false;
  return options;
}

/**
 * Reenvía el stream de una cámara de la LAN al cliente same-origin.
 * Resuelve cuando ya está fluyendo (o cuando falla), no cuando termina:
 * un MJPEG no termina nunca.
 */
function proxyLocalStream(rawUrl, clientRes) {
  return new Promise((resolve) => {
    const check = publicWebcams.validateLocalSnapshotUrl(rawUrl);
    if (!check.ok) return resolve(failStream(clientRes, 400, check.error));

    const parsed = new URL(check.url);
    const transport = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };

    const upstream = transport.get(parsed, localRequestOptions(parsed, LOCAL_STREAM_IDLE_MS), (up) => {
      // Sin redirecciones: seguir una redirección permitiría saltar la allowlist.
      if (up.statusCode >= 300 && up.statusCode < 400) {
        up.resume();
        return done(failStream(clientRes, 502, `la cámara redirige (HTTP ${up.statusCode}); no se siguen redirecciones`));
      }
      if (up.statusCode >= 400) {
        up.resume();
        return done(failStream(clientRes, 502, `la cámara respondió HTTP ${up.statusCode}`));
      }
      const rawType = String(up.headers['content-type'] || '');
      const kind = classifyLocalContentType(rawType);
      if (kind === 'unsupported' || kind === 'unknown') {
        up.resume();
        return done(failStream(clientRes, 502, `la cámara no devolvió imagen ni MJPEG (${rawType || 'sin tipo'})`));
      }

      clientRes.status(200);
      clientRes.set({
        'Content-Type': rawType || (kind === 'mjpeg' ? 'multipart/x-mixed-replace' : 'image/jpeg'),
        'Cache-Control': 'no-store, max-age=0',
        Connection: 'close',
        'X-Cam-Relay': kind === 'mjpeg' ? 'private-lan-live' : 'private-lan-snapshot',
        'X-Cam-Upstream-Host': `${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? 443 : 80)}`,
      });
      if (typeof clientRes.flushHeaders === 'function') clientRes.flushHeaders();
      up.pipe(clientRes);
      done({ ok: true, kind, streaming: true });

      up.on('error', () => { if (!clientRes.writableEnded) clientRes.destroy(); });
      up.on('end', () => { if (!clientRes.writableEnded) clientRes.end(); });
    });

    // Si el usuario cierra el visor o cambia de pantalla, se corta el origen:
    // no quedan conexiones colgadas contra su cámara.
    if (typeof clientRes.on === 'function') clientRes.on('close', () => upstream.destroy());
    upstream.on('error', (error) => done(failStream(clientRes, 502, error.message)));
    upstream.on('timeout', () => {
      upstream.destroy();
      done(failStream(clientRes, 504, 'la cámara no envía datos (timeout)'));
    });
  });
}

/**
 * Un único fotograma completo. Se implementa aquí (y no se delega en el
 * buscador de cámaras públicas) para poder aceptar también cámaras HTTPS de la
 * LAN con certificado autofirmado, que el proxy de fuentes públicas rechaza.
 */
function relayLocalSnapshot(rawUrl) {
  return new Promise((resolve) => {
    const check = publicWebcams.validateLocalSnapshotUrl(rawUrl);
    if (!check.ok) return resolve({ ok: false, error: check.error });

    const parsed = new URL(check.url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const options = localRequestOptions(parsed, LOCAL_SNAPSHOT_TIMEOUT_MS);
    options.headers.accept = 'image/*';

    const req = transport.get(parsed, options, (up) => {
      if (up.statusCode >= 300 && up.statusCode < 400) {
        up.resume();
        return resolve({ ok: false, error: `la cámara redirige (HTTP ${up.statusCode}); no se siguen redirecciones` });
      }
      if (up.statusCode >= 400) {
        up.resume();
        return resolve({ ok: false, error: `la cámara respondió HTTP ${up.statusCode}` });
      }
      const type = String(up.headers['content-type'] || '');
      const kind = classifyLocalContentType(type);
      if (kind !== 'image') {
        up.resume();
        return resolve({ ok: false, error: `la cámara no devolvió una imagen (${type || 'sin tipo'})` });
      }
      const chunks = [];
      let size = 0;
      up.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_SNAPSHOT_BYTES) { req.destroy(); return; }
        chunks.push(chunk);
      });
      up.on('end', () => {
        if (!chunks.length) return resolve({ ok: false, error: 'imagen vacía' });
        resolve({ ok: true, contentType: type, buffer: Buffer.concat(chunks), fetchedAt: Date.now() });
      });
    });
    req.on('error', (error) => resolve({ ok: false, error: error.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout de la cámara' }); });
  });
}

module.exports = {
  proxyLocalStream,
  relayLocalSnapshot,
  relayBlockReason,
  classifyLocalContentType,
  LOCAL_STREAM_IDLE_MS,
  LOCAL_SNAPSHOT_TIMEOUT_MS,
  MAX_SNAPSHOT_BYTES,
  USER_AGENT,
};
