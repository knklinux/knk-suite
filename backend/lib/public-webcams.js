'use strict';

// ============================================================================
// public-webcams.js — Cámaras PÚBLICAS en directo (fuentes oficiales abiertas)
//
// No solo tráfico: el catálogo cubre todas las categorías de cámara que un
// organismo público publica abiertamente, sin claves de pago:
//
//   TRÁFICO
//     · dgt          — DGT etraffic (España), ~1.900 cámaras de la red estatal.
//     · madrid       — Ayuntamiento de Madrid (CCTV), ~350 cámaras.
//     · tfl          — TfL JamCams (Londres), ~890 cámaras.
//     · caltrans     — Caltrans (California, EE. UU.), ~2.200 cámaras.
//     · ny511        — 511NY (Estado de Nueva York), ~2.900 cámaras (HLS).
//   METEOROLOGÍA / CARRETERA
//     · digitraffic  — Fintraffic/Digitraffic (Finlandia), ~2.300 estaciones.
//     · vegagerdin   — Vegagerðin (Islandia), ~500 webcams de carretera y paisaje.
//   WEBCAMS
//     · windy        — Windy Webcams (mundo entero, cualquier temática),
//                      requiere clave propia y gratuita.
//
// Garantías de seguridad (el módulo es un agregador, no un escáner):
//   1. Allowlist estricta de hosts: nunca se conecta a un host fuera de ella.
//   2. El identificador de cada cámara se valida por formato antes de construir
//      la URL remota, así que no se puede inyectar un host ni una ruta.
//   3. El frontend nunca recibe la URL remota: recibe la ruta local del proxy
//      (`/api/cameras/public/snapshot?...`). El renderer jamás habla con el
//      origen remoto, y por eso no hace falta abrir el CSP a terceros.
//   4. Caché en memoria con TTL para no martillear a las fuentes públicas.
//   5. No se conecta a cámaras privadas, expuestas ni indexadas por terceros:
//      solo se sirve lo que la propia fuente publica abiertamente.
//
// El relay local (`relayLocalSnapshot`) es distinto y deliberadamente estrecho:
// sirve un snapshot de una cámara de TU red privada autorizada para que el
// workbench de escritorio pueda mostrarlo sin abrir el CSP a la LAN. Solo
// acepta IPv4 privadas RFC1918 y puertos HTTP de cámara; nunca loopback,
// link-local, metadata ni redirecciones.
// ============================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

// Elimina BOM (U+FEFF) inicial: algunos editores lo añaden y JSON.parse revienta.
function readJsonNoBom(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}
let CONFIG = {};
try { CONFIG = readJsonNoBom(path.join(__dirname, '..', '..', 'config.json')); } catch { /* config opcional */ }
// La app empaquetada ejecuta el backend desde resources (sin config.json del
// proyecto): las claves también se leen de ~/.knk-suite/config.json (manda
// sobre el proyecto) para no requerir rebuild al rotar claves.
try {
  const os = require('os');
  CONFIG = { ...CONFIG, ...readJsonNoBom(path.join(os.homedir(), '.knk-suite', 'config.json')) };
} catch { /* config de usuario opcional */ }

const UA = 'knkLinux-PublicCams/1.0 (+workbench local; solo lectura de fuentes publicas)';
const LIST_TTL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_BYTES = 30_000_000;

// Bases de imagen. Constantes, nunca derivadas de la respuesta de la fuente:
// el id (ya validado por formato) es lo único que se interpola.
const DGT_IMAGE_BASE = 'https://etraffic.dgt.es/camarasEtraffic/';
const MADRID_IMAGE_BASE = 'https://informo.madrid.es/cameras/Camara';
const DIGITRAFFIC_IMAGE_BASE = 'https://weathercam.digitraffic.fi/';
const VEGAGERDIN_IMAGE_BASE = 'https://www.vegagerdin.is/vgdata/vefmyndavelar/';
// Caltrans: el JSON trae la URL absoluta, pero el snapshot se reconstruye con
// esta base + el basename (validado) para no propagar URLs sin control.
const CALTRANS_IMAGE_BASE = 'https://cwwp2.dot.ca.gov/';
const CALTRANS_LISTING_BASE = 'https://cwwp2.dot.ca.gov/data/';

// Hosts de los que se acepta JSON/KML de listado.
const LIST_HOSTS = new Set([
  'etraffic.dgt.es',
  'api.tfl.gov.uk',
  'api.windy.com',
  'informo.madrid.es',
  'tie.digitraffic.fi',
  'gagnaveita.vegagerdin.is',
  'cwwp2.dot.ca.gov',
  '511ny.org',
]);

// Hosts desde los que se aceptan BYTES de imagen. Cualquier otro se rechaza.
const SNAPSHOT_HOSTS = new Set([
  'etraffic.dgt.es',
  's3-eu-west-1.amazonaws.com',
  'images-webcams.windy.com',
  'imgproxy.windy.com',
  'informo.madrid.es',
  'weathercam.digitraffic.fi',
  'www.vegagerdin.is',
  'cwwp2.dot.ca.gov',
  '511ny.org',
  's51.nysdot.skyvdn.com',
  's52.nysdot.skyvdn.com',
  's53.nysdot.skyvdn.com',
]);

// Puertos HTTP de cámara que el relay local acepta. Nada más.
const LOCAL_CAMERA_HTTP_PORTS = new Set([80, 443, 8000, 8080, 8443]);

const KIND_LABELS = {
  traffic: 'Tráfico',
  weather: 'Meteorología',
  webcam: 'Webcams',
};

const SOURCES = {
  dgt: {
    id: 'dgt', label: 'DGT — Tráfico España', region: 'España', country: 'ES', kind: 'traffic',
    scope: 'national', live: true,
    attribution: 'Dirección General de Tráfico (DGT), datos abiertos etraffic.',
    note: 'Red estatal de cámaras de tráfico. Snapshot JPEG que se refresca periódicamente.',
  },
  madrid: {
    id: 'madrid', label: 'Madrid — CCTV municipal', region: 'Madrid', country: 'ES', kind: 'traffic',
    scope: 'city', live: true,
    attribution: 'Ayuntamiento de Madrid — Informo (KML CCTV).',
    note: 'Cámaras fijas municipales de tráfico de la ciudad de Madrid.',
  },
  tfl: {
    id: 'tfl', label: 'TfL JamCams — Londres', region: 'Londres', country: 'GB', kind: 'traffic',
    scope: 'city', live: true,
    attribution: 'Transport for London (TfL) Open Data, JamCams.',
    note: 'Cámaras de tráfico publicadas por TfL. Snapshot JPEG actualizado cada pocos minutos.',
  },
  caltrans: {
    id: 'caltrans', label: 'Caltrans — California (EE. UU.)', region: 'California', country: 'US', kind: 'traffic',
    scope: 'state', live: true,
    attribution: 'Caltrans (California DOT), datos abiertos de CCTV.',
    note: 'Cámaras de tráfico de las autopistas de California. Snapshot JPEG cada ~5 s.',
  },
  ny511: {
    id: 'ny511', label: '511NY — Estado de Nueva York', region: 'Nueva York', country: 'US', kind: 'traffic',
    scope: 'state', live: true,
    attribution: '511NY (New York State DOT), datos abiertos de CCTV.',
    note: 'Cámaras de tráfico del estado de Nueva York. Snapshot vía el visor público de 511NY.',
  },
  digitraffic: {
    id: 'digitraffic', label: 'Digitraffic — Finlandia', region: 'Finlandia', country: 'FI', kind: 'weather',
    scope: 'national', live: true,
    attribution: 'Fintraffic / Digitraffic — datos abiertos (weathercam v1).',
    note: 'Cámaras meteorológicas de carretera: estado del firme, nieve y visibilidad.',
  },
  vegagerdin: {
    id: 'vegagerdin', label: 'Vegagerðin — Islandia', region: 'Islandia', country: 'IS', kind: 'weather',
    scope: 'national', live: true,
    attribution: 'Vegagerðin (Administración de Carreteras de Islandia), datos abiertos.',
    note: 'Webcams de carretera y paisaje: glaciares, volcanes, puertos y alta montaña.',
  },
  windy: {
    id: 'windy', label: 'Windy Webcams — Mundo', region: 'Mundo', country: '', kind: 'webcam',
    scope: 'world', live: true,
    attribution: 'Windy.com Webcams API.',
    note: 'Webcams públicas de todo el mundo y cualquier temática. Requiere clave gratuita de Windy en config.json.',
  },
};

// ── utilidades ──────────────────────────────────────────────────────

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clampRadius(value, fallback = 50) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(Math.round(n), 2000));
}

function finiteLatLon(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

function normalizeQuery(text) {
  return String(text || '').trim().toLowerCase().slice(0, 80);
}

// Petición de texto (JSON/KML). Soporta gzip, que Digitraffic exige.
function requestText(url, { method = 'GET', body = null, timeout = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (error) { return reject(error); }
    if (!LIST_HOSTS.has(parsed.hostname)) return reject(new Error(`host no permitido: ${parsed.hostname}`));
    const transport = parsed.protocol === 'https:' ? https : http;
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const reqHeaders = { 'User-Agent': UA, 'Accept-Encoding': 'gzip', ...headers };
    if (data) {
      reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }
    const req = transport.request(parsed, { method, timeout, headers: reqHeaders }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_TEXT_BYTES) req.destroy(new Error('respuesta demasiado grande'));
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        let raw = Buffer.concat(chunks);
        const encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (encoding.includes('gzip')) raw = zlib.gunzipSync(raw);
          else if (encoding.includes('deflate')) raw = zlib.inflateSync(raw);
        } catch (error) { return reject(new Error(`no se pudo descomprimir la respuesta: ${error.message}`)); }
        resolve(raw.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

// La respuesta de DGT viene como base64 con XOR de un carácter (primer carácter
// de una clave textual). Es una ofuscación de transporte, no cifrado.
function decodeDgt(payload, key = 'function{var ent3}') {
  const mask = key.charCodeAt(0);
  const raw = Buffer.from(String(payload || ''), 'base64');
  const out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] ^ mask;
  return JSON.parse(out.toString('utf8'));
}

// Identificadores aceptados por cada fuente. Nada fuera de estos formatos.
const ID_PATTERNS = {
  dgt: /^\d{3,10}$/,
  tfl: /^\d{5}\.\d{5}$/,
  windy: /^\d{4,12}$/,
  madrid: /^\d{5}$/,
  digitraffic: /^[A-Z0-9]{6,12}$/,
  vegagerdin: /^[a-z0-9][a-z0-9_-]{1,59}$/i,
  // Caltrans: basename del JPG, minúsculas, dígitos y guiones (tv102i580westofsr24).
  caltrans: /^[a-z0-9][a-z0-9-]{2,63}$/,
  // 511NY: el identificador del listado («NYSDOT-01o3upkjrwu»), y su visor
  // público /map/Cctv/<n> usa un índice numérico separado (ver NY511_INDEX).
  ny511: /^[A-Za-z0-9-]{4,40}$/,
  // Índice numérico del visor de 511NY.
  'ny511-view': /^\d{1,7}$/,
};

function isValidCameraId(source, id) {
  const pattern = ID_PATTERNS[source];
  if (!pattern) return false;
  return pattern.test(String(id == null ? '' : id));
}

// IPv4 RFC1918 estricta: 10/8, 172.16/12, 192.168/16. Se excluyen a propósito
// loopback (127/8), link-local/metadata (169.254/16), CGNAT y documentación.
function isPrivateLanIpv4(host) {
  const parts = String(host || '').split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

// ── validación del relay local ──────────────────────────────────────

function validateLocalSnapshotUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '')); } catch { return { ok: false, error: 'URL inválida' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'solo http(s)' };
  if (parsed.username || parsed.password) return { ok: false, error: 'no se permiten credenciales en la URL' };
  if (!isPrivateLanIpv4(parsed.hostname)) return { ok: false, error: 'solo IPv4 privada RFC1918 (10/8, 172.16/12, 192.168/16)' };
  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if (!LOCAL_CAMERA_HTTP_PORTS.has(port)) return { ok: false, error: `puerto no permitido: ${port}` };
  if (!parsed.pathname.startsWith('/')) return { ok: false, error: 'ruta inválida' };
  if (/[\u0000-\u001f\u007f]/.test(parsed.pathname + parsed.search)) return { ok: false, error: 'caracteres de control en la ruta' };
  return { ok: true, url: parsed.toString() };
}

function fetchImageBuffer(remoteUrl, { allowLocal = false } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(remoteUrl); } catch { return resolve({ ok: false, error: 'URL remota inválida' }); }

    const allowed = allowLocal
      ? (parsed.protocol === 'http:' && isPrivateLanIpv4(parsed.hostname))
      : (parsed.protocol === 'https:' && SNAPSHOT_HOSTS.has(parsed.hostname));
    if (!allowed) return resolve({ ok: false, error: 'origen no permitido' });

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(parsed, { timeout: 12000, headers: { 'User-Agent': UA, accept: 'image/*' } }, (res) => {
      // Sin redirecciones: si el origen redirige, se rechaza en lugar de seguirlo.
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return resolve({ ok: false, error: `el origen redirige (HTTP ${res.statusCode}); no se siguen redirecciones` });
      }
      if (res.statusCode >= 400) {
        res.resume();
        return resolve({ ok: false, error: `origen HTTP ${res.statusCode}` });
      }
      const type = String(res.headers['content-type'] || '');
      if (!type.startsWith('image/')) {
        res.resume();
        return resolve({ ok: false, error: `el origen no devolvió una imagen (${type || 'sin tipo'})` });
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_SNAPSHOT_BYTES) { req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (!chunks.length) return resolve({ ok: false, error: 'imagen vacía' });
        resolve({ ok: true, contentType: type, buffer: Buffer.concat(chunks), fetchedAt: Date.now() });
      });
    });
    req.on('error', (error) => resolve({ ok: false, error: error.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout del origen' }); });
  });
}

// ── caché de listados ───────────────────────────────────────────────

const listCache = new Map();
const dynamicUrls = new Map(); // id de cámara → URL ya validada (solo Windy)

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > LIST_TTL_MS) { map.delete(key); return null; }
  return hit.value;
}

function cacheSet(map, key, value) {
  map.set(key, { at: Date.now(), value });
  return value;
}

// ── fuente DGT (España) ─────────────────────────────────────────────

async function fetchDgtRaw() {
  const cached = cacheGet(listCache, 'dgt');
  if (cached) return cached;
  const payload = await requestText('https://etraffic.dgt.es/etrafficWEB/api/cache/getCamaras', {
    method: 'POST',
    body: {},
    timeout: 20000,
  });
  const parsed = decodeDgt(payload);
  const cameras = (parsed.camaras || [])
    .filter((item) => item && isValidCameraId('dgt', item.idCamara) && Number.isFinite(Number(item.coordX)) && Number.isFinite(Number(item.coordY)))
    .map((item) => ({
      id: String(item.idCamara),
      name: `${item.carretera || 'carretera'} · PK ${item.pk == null ? '?' : item.pk}`,
      road: item.carretera || '',
      lat: Number(item.coordY),
      lon: Number(item.coordX),
    }));
  return cacheSet(listCache, 'dgt', { cameras });
}

// ── fuente Madrid (CCTV municipal) ──────────────────────────────────

// El KML municipal no es JSON: se extraen los campos de cada <Placemark>.
function parseMadridKml(kml) {
  const cameras = [];
  for (const block of String(kml || '').split('<Placemark>').slice(1)) {
    const numero = (block.match(/name="Numero">\s*<Value>([^<]+)</) || [])[1];
    const nombre = (block.match(/name="Nombre">\s*<Value>([^<]+)</) || [])[1];
    const coords = block.match(/<coordinates>\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!numero || !coords) continue;
    const id = String(numero).trim();
    if (!isValidCameraId('madrid', id)) continue;
    const lat = Number(coords[2]);
    const lon = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    cameras.push({
      id,
      name: (nombre || `Cámara ${id}`).trim(),
      road: '',
      lat,
      lon,
    });
  }
  return cameras;
}

async function fetchMadridRaw() {
  const cached = cacheGet(listCache, 'madrid');
  if (cached) return cached;
  const kml = await requestText('https://informo.madrid.es/informo/tmadrid/CCTV.kml', { timeout: 25000 });
  return cacheSet(listCache, 'madrid', { cameras: parseMadridKml(kml) });
}

// ── fuente Digitraffic (Finlandia) ──────────────────────────────────

function mapDigitrafficStations(payload) {
  const features = Array.isArray(payload) ? payload : (payload && payload.features) || [];
  const cameras = [];
  for (const feature of features) {
    const props = feature.properties || {};
    const coords = feature.geometry && feature.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const presets = Array.isArray(props.presets) ? props.presets : [];
    presets.forEach((preset, index) => {
      const id = String(preset && preset.id);
      if (!isValidCameraId('digitraffic', id)) return;
      if (preset.inCollection === false) return;
      cameras.push({
        id,
        name: `${props.name || id}${presets.length > 1 ? ` (${index + 1})` : ''}`,
        road: '',
        lat,
        lon,
      });
    });
  }
  return cameras;
}

async function fetchDigitrafficRaw() {
  const cached = cacheGet(listCache, 'digitraffic');
  if (cached) return cached;
  const payload = await requestText('https://tie.digitraffic.fi/api/weathercam/v1/stations', {
    timeout: 25000,
    headers: { 'Digitraffic-User': 'knkLinux/1.0' },
  });
  return cacheSet(listCache, 'digitraffic', { cameras: mapDigitrafficStations(JSON.parse(payload)) });
}

// ── fuente Vegagerðin (Islandia) ────────────────────────────────────

function mapVegagerdin(payload) {
  const items = Array.isArray(payload) ? payload : [];
  const cameras = [];
  for (const item of items) {
    const url = String((item && item.Slod) || '');
    if (!url.startsWith(VEGAGERDIN_IMAGE_BASE) || !url.endsWith('.jpg')) continue;
    const id = url.slice(VEGAGERDIN_IMAGE_BASE.length, -4);
    if (!isValidCameraId('vegagerdin', id)) continue;
    const lat = Number(item.Breidd);
    const lon = Number(item.Lengd);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    cameras.push({
      id,
      name: [item.Myndavel, item.Skyring].filter(Boolean).join(' — ') || id,
      road: item.Vegheiti || '',
      lat,
      lon,
    });
  }
  return cameras;
}

async function fetchVegagerdinRaw() {
  const cached = cacheGet(listCache, 'vegagerdin');
  if (cached) return cached;
  const payload = await requestText('https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1', { timeout: 25000 });
  return cacheSet(listCache, 'vegagerdin', { cameras: mapVegagerdin(JSON.parse(payload)) });
}

// ── fuente TfL (Reino Unido) ────────────────────────────────────────

function buildTflImageUrl(id) {
  return `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${id}.jpg`;
}

async function fetchTflRaw() {
  const cached = cacheGet(listCache, 'tfl');
  if (cached) return cached;
  const payload = await requestText('https://api.tfl.gov.uk/Place/Type/JamCam', { timeout: 25000 });
  const parsed = JSON.parse(payload);
  const cameras = (Array.isArray(parsed) ? parsed : [])
    .map((place) => {
      const id = String(place.id || '').replace(/^JamCams_/, '');
      if (!isValidCameraId('tfl', id)) return null;
      return {
        id,
        name: place.commonName || id,
        road: (place.commonName || '').split(' ')[0] || '',
        lat: Number(place.lat),
        lon: Number(place.lon),
      };
    })
    .filter((item) => item && Number.isFinite(item.lat) && Number.isFinite(item.lon));
  return cacheSet(listCache, 'tfl', { cameras });
}

// Directorio de snapshot de Caltrans: el JSON agrupa las imágenes por carpeta
// («/data/d4/cctv/image/<basename>/…»), así que al listar se guarda el distrito
// de cada cámara para poder reconstruir la URL sin depender de la cadena remota.
const CALTRANS_SNAPSHOT_DIR = new Map();
// ── fuente Caltrans (California, EE. UU.) ───────────────────────────

// Distritos publicados en cwwp2; algunos devuelven 500 de forma estable, así
// que la lista es la que funciona y se consultan todos en paralelo.
const CALTRANS_DISTRICTS = ['d3', 'd4', 'd5', 'd7', 'd10', 'd11', 'd12'];

/**
 * Del URL absoluta del JSON solo se conserva el basename, ya validado por el
 * patrón de id: la URL final se reconstruye con la base constante, nunca con
 * la cadena que vino de fuera.
 * @returns {string|null} basename sin .jpg, p. ej. «tv102i580westofsr24».
 */
function caltransBasenameFromUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.hostname !== 'cwwp2.dot.ca.gov' || parsed.protocol !== 'https:') return null;
    if (!parsed.pathname.startsWith('/data/') || !parsed.pathname.endsWith('.jpg')) return null;
    const base = parsed.pathname.split('/').pop().replace(/\.jpg$/, '');
    return isValidCameraId('caltrans', base) ? base : null;
  } catch { return null; }
}

function mapCaltrans(payload) {
  const rows = (payload && Array.isArray(payload.data)) ? payload.data : [];
  const cameras = [];
  for (const row of rows) {
    const item = row && row.cctv;
    if (!item || item.inService !== 'true') continue;
    const loc = item.location || {};
    const base = caltransBasenameFromUrl(item.imageData && item.imageData.static && item.imageData.static.currentImageURL);
    if (!base) continue;
    const lat = Number(loc.latitude);
    const lon = Number(loc.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!CALTRANS_SNAPSHOT_DIR.has(base)) {
      // La URL ya está validada: el distrito sale de su propia ruta (/data/dN/…).
      const district = String(item.imageData.static.currentImageURL).match(/\/data\/(d\d+)\//);
      CALTRANS_SNAPSHOT_DIR.set(base, district ? district[1] : null);
    }
    cameras.push({
      id: base,
      name: [loc.locationName, loc.nearbyPlace].filter(Boolean).join(' — ') || base,
      road: loc.route || '',
      district: loc.district || '',
      lat,
      lon,
    });
  }
  return cameras;
}

async function fetchCaltransRaw() {
  const cached = cacheGet(listCache, 'caltrans');
  if (cached) return cached;
  const results = await Promise.all(CALTRANS_DISTRICTS.map(async (district) => {
    try {
      const payload = await requestText(`${CALTRANS_LISTING_BASE}${district}/cctv/cctvStatus${district.toUpperCase()}.json`, { timeout: 20000 });
      return mapCaltrans(JSON.parse(payload));
    } catch {
      return []; // un distrito caído no tumba la fuente
    }
  }));
  const seen = new Set();
  const cameras = [];
  for (const list of results) {
    for (const camera of list) {
      if (seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
  }
  return cacheSet(listCache, 'caltrans', { cameras });
}

/** URL de imagen de Caltrans a partir del basename ya validado. */

function buildCaltransImageUrl(id) {
  const dir = CALTRANS_SNAPSHOT_DIR.get(id);
  return `${CALTRANS_IMAGE_BASE}data/${dir ? dir + '/' : ''}cctv/image/${id}/${id}.jpg`;
}

// ── fuente 511NY (Estado de Nueva York, EE. UU.) ────────────────────

/**
 * El listado trae la ficha de la cámara, pero el snapshot vive en el visor
 * público /map/Cctv/<índice>: el propio listado lo trae en «Url» y es la forma
 * documentada de leer el fotograma sin clave. Aquí solo se guarda el índice,
 * que se valida por formato antes de reconstruir la URL.
 */
function mapNy511(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  const cameras = [];
  for (const row of rows) {
    if (!row || row.Disabled === true || row.Blocked === true) continue;
    const viewer = String(row.Url || '');
    const match = viewer.match(/^https:\/\/511ny\.org\/map\/Cctv\/(\d{1,7})$/);
    if (!match) continue;
    const lat = Number(row.Latitude);
    const lon = Number(row.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // HLS stream URL from VideoUrl field
    const hlsUrl = row.VideoUrl || row.HlsUrl || row.StreamUrl || null;
    cameras.push({
      id: match[1],
      key: String(row.ID || ''),
      name: row.Name || match[1],
      road: row.RoadwayName || '',
      lat,
      lon,
      video: hlsUrl,
      hls: hlsUrl && /\.m3u8/i.test(hlsUrl) ? hlsUrl : null,
    });
  }
  return cameras;
}

async function fetchNy511Raw() {
  const cached = cacheGet(listCache, 'ny511');
  if (cached) return cached;
  const payload = await requestText('https://511ny.org/api/getcameras?key=&format=json', { timeout: 30000 });
  return cacheSet(listCache, 'ny511', { cameras: mapNy511(JSON.parse(payload)) });
}

// ── fuente Windy (mundo) ────────────────────────────────────────────

async function fetchWindyRaw(apiKey, nearby) {
  if (!apiKey) return { cameras: [] };
  // Con centro: búsqueda geográfica real (nearby=lat,lon,radioKm). Sin
  // centro: populares (caché 10 min). La caché es por caja geográfica.
  let cacheKey = 'windy';
  const params = new URLSearchParams({ limit: '50', include: 'location,images,urls,player' });
  if (nearby && Number.isFinite(nearby.lat) && Number.isFinite(nearby.lon)) {
    const r = Math.max(5, Math.min(250, Number(nearby.radiusKm) || 50));
    params.set('nearby', `${nearby.lat},${nearby.lon},${r}`);
    cacheKey = `windy:${nearby.lat.toFixed(2)},${nearby.lon.toFixed(2)},${r}`;
  }
  const cached = cacheGet(listCache, cacheKey);
  if (cached) return cached;
  const payload = await requestText(`https://api.windy.com/webcams/api/v3/webcams?${params}`, {
    timeout: 20000,
    headers: { 'x-windy-api-key': apiKey },
  });
  const parsed = JSON.parse(payload);
  const cameras = [];
  for (const webcam of parsed.webcams || []) {
    const id = String(webcam.webcamId || webcam.id || '');
    const preview = webcam.images && webcam.images.current && webcam.images.current.preview;
    const loc = webcam.location || {};
    if (!isValidCameraId('windy', id) || !/^https:\/\//.test(String(preview || ''))) continue;
    try {
      if (!SNAPSHOT_HOSTS.has(new URL(preview).hostname)) continue;
      dynamicUrls.set(`windy:${id}`, preview);
    } catch { continue; }
    cameras.push({
      id,
      name: webcam.title || id,
      road: '',
      lat: Number(loc.latitude),
      lon: Number(loc.longitude),
      country: loc.country || '',
      city: loc.city || '',
      timelapse: (webcam.player && (webcam.player.day || webcam.player.lifetime)) || null,
    });
  }
  return cacheSet(listCache, cacheKey, { cameras });
}

// ── snapshots por id (bases constantes, id ya validado) ─────────────

const ID_TO_URL = {
  madrid: (id) => `${MADRID_IMAGE_BASE}${id}.jpg`,
  digitraffic: (id) => `${DIGITRAFFIC_IMAGE_BASE}${id}.jpg`,
  vegagerdin: (id) => `${VEGAGERDIN_IMAGE_BASE}${id}.jpg`,
  dgt: (id) => `${DGT_IMAGE_BASE}${id}.jpg`,
  tfl: (id) => buildTflImageUrl(id),
  caltrans: (id) => buildCaltransImageUrl(id),
  'ny511-view': (id) => `https://511ny.org/map/Cctv/${id}`,
};

// ── API pública del módulo ──────────────────────────────────────────

// Hook para tests: permite fijar/limpiar el config efectivo sin tocar disco
// (los tests deben pasar tanto con como sin claves locales reales).
function setConfigForTest(patch) {
  CONFIG = patch || {};
}

function windyApiKey() {
  return process.env.WINDY_API_KEY || CONFIG.windyApiKey || '';
}

function listSources() {
  return Object.values(SOURCES).map((source) => ({
    ...source,
    configured: source.id === 'windy' ? Boolean(windyApiKey()) : true,
  }));
}

function sourceIds() {
  return Object.keys(SOURCES);
}

async function loadSource(sourceId, hint) {
  switch (sourceId) {
    case 'dgt': return fetchDgtRaw();
    case 'madrid': return fetchMadridRaw();
    case 'tfl': return fetchTflRaw();
    case 'digitraffic': return fetchDigitrafficRaw();
    case 'vegagerdin': return fetchVegagerdinRaw();
    case 'caltrans': return fetchCaltransRaw();
    case 'ny511': return fetchNy511Raw();
    case 'windy': return fetchWindyRaw(windyApiKey(), hint && hint.nearby);
    default: throw new Error(`fuente desconocida: ${sourceId}`);
  }
}

function toPublicCamera(sourceId, camera, center) {
  const distance = center && Number.isFinite(camera.lat) && Number.isFinite(camera.lon)
    ? Math.round(distanceKm(center.lat, center.lon, camera.lat, camera.lon) * 10) / 10
    : null;
  const meta = SOURCES[sourceId] || {};
  // 511NY usa el índice del visor como id de snapshot; se guarda el alias para
  // que la tarjeta siga mostrando el identificador real del listado.
  const snapshotSource = sourceId === 'ny511' ? 'ny511-view' : sourceId;
  // HLS proxy route for live streams
  const hls = camera.hls ? `/api/cameras/public/hls?url=${encodeURIComponent(camera.hls)}` : null;
  return {
    id: camera.id,
    source: sourceId,
    sourceLabel: meta.label || sourceId,
    kind: meta.kind || 'webcam',
    name: camera.name,
    road: camera.road || '',
    country: camera.country || meta.country || '',
    city: camera.city || meta.region || '',
    lat: camera.lat,
    lon: camera.lon,
    video: camera.video || null,
    hls,
    timelapse: camera.timelapse || null,
    // Ruta local del proxy: el renderer nunca habla con el origen remoto.
    snapshot: `/api/cameras/public/snapshot?source=${encodeURIComponent(snapshotSource)}&id=${encodeURIComponent(camera.id)}`,
    distanceKm: distance,
    attribution: meta.attribution || '',
  };
}

function applyFilters(cameras, { query, center, radiusKm }) {
  let out = cameras;
  if (query) {
    out = out.filter((camera) => `${camera.name} ${camera.road} ${camera.city} ${camera.country} ${camera.sourceLabel}`
      .toLowerCase().includes(query));
  }
  if (center) {
    out = out
      .map((camera) => ({ camera, distance: distanceKm(center.lat, center.lon, camera.lat, camera.lon) }))
      .filter((item) => item.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance)
      .map((item) => item.camera);
  }
  return out;
}

// Entrelaza los resultados por fuente para que la vista "todas" no muestre
// 48 cámaras de la misma red antes de pasar a la siguiente.
function interleaveBySource(cameras) {
  const buckets = new Map();
  for (const camera of cameras) {
    if (!buckets.has(camera.source)) buckets.set(camera.source, []);
    buckets.get(camera.source).push(camera);
  }
  const lists = [...buckets.values()];
  const out = [];
  let index = 0;
  let added = true;
  while (added) {
    added = false;
    for (const list of lists) {
      if (index < list.length) { out.push(list[index]); added = true; }
    }
    index += 1;
  }
  return out;
}

async function listCameras(options = {}) {
  const requested = String(options.source || 'all');
  const all = requested === 'all' || requested === 'todas';
  if (!all && !SOURCES[requested]) return { ok: false, error: `fuente desconocida: ${requested}`, cameras: [] };

  const earlyCenter = finiteLatLon(options.lat, options.lon);
  const earlyRadius = clampRadius(options.radiusKm, 50);
  // Pista geográfica para fuentes con búsqueda nativa (Windy nearby).
  const geoHint = earlyCenter ? { nearby: { ...earlyCenter, radiusKm: earlyRadius } } : null;

  // Una fuente que falle no debe tumbar la vista agregada.
  const requestedIds = all ? sourceIds() : [requested];
  const responses = await Promise.all(requestedIds.map(async (id) => {
    try {
      return { id, raw: await loadSource(id, geoHint) };
    } catch (error) {
      return { id, error: error.message };
    }
  }));

  const sources = {};
  let pooled = [];
  for (const response of responses) {
    if (response.error) {
      sources[response.id] = { status: response.error, count: 0 };
      continue;
    }
    sources[response.id] = { status: 'ok', count: response.raw.cameras.length };
    pooled = pooled.concat(response.raw.cameras.map((camera) => ({ camera, sourceId: response.id })));
  }

  const center = finiteLatLon(options.lat, options.lon);
  const radiusKm = clampRadius(options.radiusKm, 50);
  const query = normalizeQuery(options.q);
  const kind = String(options.kind || '').toLowerCase();

  let decorated = pooled.map((entry) => toPublicCamera(entry.sourceId, entry.camera, center));
  if (kind && KIND_LABELS[kind]) decorated = decorated.filter((camera) => camera.kind === kind);
  decorated = applyFilters(decorated, { query, center, radiusKm });
  if (all && !center && !query) decorated = interleaveBySource(decorated);

  const total = decorated.length;
  const limit = Math.max(1, Math.min(Number(options.limit) || 48, 200));
  const page = Math.max(0, Number(options.page) || 0);
  const slice = decorated.slice(page * limit, page * limit + limit);

  if (!total && responses.every((response) => response.error)) {
    return { ok: false, error: responses.map((response) => `${response.id}: ${response.error}`).join(' · '), cameras: [], sources };
  }

  return {
    ok: true,
    source: all ? 'all' : requested,
    sourceMeta: all
      ? { id: 'all', label: 'Todas las fuentes', region: 'Mundo', kind: 'all', scope: 'world', configured: true }
      : { ...SOURCES[requested], configured: requested === 'windy' ? Boolean(windyApiKey()) : true },
    cameras: slice,
    total,
    hasMore: (page + 1) * limit < total,
    sources,
    query: { q: query, kind: kind || null, center, radiusKm, page, limit },
    semantics: 'public-live-feed',
    note: 'Fuentes públicas oficiales. El snapshot se sirve a través del proxy local del workbench.',
    ts: Date.now(),
  };
}

async function getSnapshot({ source, id } = {}) {
  const sourceId = String(source || '');
  if (!isValidCameraId(sourceId, id)) return { ok: false, error: 'identificador de cámara inválido' };

  let remoteUrl;
  if (sourceId === 'windy') {
    if (!SOURCES[sourceId]) return { ok: false, error: `fuente desconocida: ${sourceId}` };
    // Windy: solo se reproduce una URL de preview que ya pasó la allowlist al listar.
    if (!cacheGet(listCache, 'windy')) {
      try { await loadSource('windy'); } catch (error) { return { ok: false, error: error.message }; }
    }
    remoteUrl = dynamicUrls.get(`windy:${id}`) || null;
    if (!remoteUrl) return { ok: false, error: 'preview no disponible; recarga el listado' };
  } else {
    const builder = ID_TO_URL[sourceId];
    // «ny511-view» es un alias interno de snapshot: no aparece en el catálogo
    // pero sí tiene constructor de URL y patrón de id propios.
    if (!builder || (!SOURCES[sourceId] && sourceId !== 'ny511-view')) return { ok: false, error: `fuente desconocida: ${sourceId}` };
    remoteUrl = builder(id);
  }

  return fetchImageBuffer(remoteUrl);
}

// Snapshot de una cámara de la red privada autorizada del usuario, servido por
// el backend para que el workbench de escritorio no tenga que abrir el CSP a la
// LAN. Validación estricta: RFC1918 + puertos HTTP de cámara + sin credenciales.
async function relayLocalSnapshot(rawUrl) {
  const check = validateLocalSnapshotUrl(rawUrl);
  if (!check.ok) return { ok: false, error: check.error };
  return fetchImageBuffer(check.url, { allowLocal: true });
}

module.exports = {
  SOURCES,
  KIND_LABELS,
  LIST_HOSTS,
  SNAPSHOT_HOSTS,
  LOCAL_CAMERA_HTTP_PORTS,
  DGT_IMAGE_BASE,
  MADRID_IMAGE_BASE,
  DIGITRAFFIC_IMAGE_BASE,
  VEGAGERDIN_IMAGE_BASE,
  CALTRANS_DISTRICTS,
  listSources,
  setConfigForTest,
  listCameras,
  getSnapshot,
  relayLocalSnapshot,
  decodeDgt,
  parseMadridKml,
  mapDigitrafficStations,
  mapVegagerdin,
  mapCaltrans,
  mapNy511,
  caltransBasenameFromUrl,
  buildCaltransImageUrl,
  isValidCameraId,
  isPrivateLanIpv4,
  validateLocalSnapshotUrl,
  buildTflImageUrl,
  interleaveBySource,
  distanceKm,
  clampRadius,
  finiteLatLon,
  windyApiKey,
  _clearCache: () => { listCache.clear(); dynamicUrls.clear(); CALTRANS_SNAPSHOT_DIR.clear(); },
};
