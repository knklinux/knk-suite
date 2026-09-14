'use strict';

// ============================================================================
// lib/osint.js — OSINT pasivo y fuentes públicas para knkLinux
//
// Principios del módulo:
//   - Shodan/Censys son índices de observaciones, no pruebas de acceso.
//   - La búsqueda de cámaras públicas nunca abre streams ni devuelve URLs de
//     reproducción; una observación no se etiqueta como vulnerabilidad.
//   - Las claves solo se leen de variables de entorno/config local y nunca se
//     devuelven completas al frontend.
// ============================================================================

const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');
const http = require('http');

let CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf8')); } catch {}

const SHODAN_KEY = process.env.SHODAN_API_KEY || CONFIG.shodanApiKey || '';
const CENSYS_ID = process.env.CENSYS_API_ID || CONFIG.censysApiId || CONFIG.censysId || '';
const CENSYS_SECRET = process.env.CENSYS_API_SECRET || CONFIG.censysApiSecret || CONFIG.censysSecret || '';
const WINDY_KEY = process.env.WINDY_API_KEY || CONFIG.windyApiKey || '';
const HIBP_KEY = process.env.HIBP_API_KEY || CONFIG.hibpApiKey || '';
const NUMVERIFY_KEY = process.env.NUMVERIFY_API_KEY || CONFIG.numverifyKey || '';
const FOFA_EMAIL = process.env.FOFA_EMAIL || CONFIG.fofaEmail || '';
const FOFA_KEY = process.env.FOFA_KEY || CONFIG.fofaKey || '';
const ZOOMEYE_KEY = process.env.ZOOMEYE_API_KEY || CONFIG.zoomeyeApiKey || '';
const MAX_RESULTS = 50;

function httpRequest(method, url, body, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (error) { reject(error); return; }
    const transport = parsed.protocol === 'https:' ? https : http;
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { ...(options.headers || {}) };
    if (data) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = transport.request(parsed, {
      method,
      timeout: options.timeout || 15000,
      headers,
      rejectUnauthorized: options.rejectUnauthorized !== false,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        text += chunk;
        if (text.length > (options.maxBytes || 2_000_000)) req.destroy(new Error('respuesta demasiado grande'));
      });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 180)}`));
        resolve({ status: res.statusCode, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function httpJson(method, url, body, options = {}) {
  const response = await httpRequest(method, url, body, options);
  try { return JSON.parse(response.text); } catch { return response.text; }
}

async function httpText(url, options = {}) {
  return (await httpRequest('GET', url, null, options)).text;
}

function validIpv4(value) {
  return net.isIP(String(value || '')) === 4;
}

function secretState(value) {
  return { configured: Boolean(value) };
}

function mapShodanMatch(match = {}) {
  const location = match.location || {};
  const httpInfo = match.http || {};
  return {
    ip: match.ip_str || match.ip || '',
    port: Number.isInteger(match.port) ? match.port : null,
    hostnames: Array.isArray(match.hostnames) ? match.hostnames.slice(0, 10) : [],
    org: match.org || '',
    os: match.os || '',
    product: match.product || '',
    version: match.version || '',
    country: location.country_name || location.country_code || '',
    city: location.city || '',
    lat: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
    lon: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null,
    banner: String(match.data || '').slice(0, 300),
    vulns: Array.isArray(match.vulns) ? match.vulns.slice(0, 30) : [],
    timestamp: match.timestamp || null,
    screenshotIndexed: Boolean(match.has_screenshot || httpInfo.screenshot),
  };
}

async function shodanSearch(query, page = 1) {
  if (!SHODAN_KEY) throw new Error('Shodan API key no configurada — usa SHODAN_API_KEY local');
  const safePage = Math.max(1, Math.min(Number(page) || 1, 10));
  const url = `https://api.shodan.io/shodan/host/search?key=${encodeURIComponent(SHODAN_KEY)}&query=${encodeURIComponent(String(query || '').slice(0, 400))}&page=${safePage}`;
  const data = await httpJson('GET', url);
  return {
    total: Number(data?.total) || 0,
    matches: Array.isArray(data?.matches) ? data.matches.slice(0, MAX_RESULTS).map(mapShodanMatch) : [],
  };
}

async function shodanHost(ip) {
  if (!validIpv4(ip)) throw new Error('IP IPv4 inválida');
  if (!SHODAN_KEY) throw new Error('Shodan API key no configurada');
  const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(SHODAN_KEY)}`;
  const data = await httpJson('GET', url);
  const services = Array.isArray(data?.data) ? data.data.slice(0, MAX_RESULTS).map((service) => ({
    port: service.port || null,
    product: service.product || '',
    version: service.version || '',
    banner: String(service.data || '').slice(0, 500),
  })) : [];
  return {
    ip: data?.ip_str || ip,
    hostnames: Array.isArray(data?.hostnames) ? data.hostnames.slice(0, 10) : [],
    org: data?.org || '',
    os: data?.os || '',
    country: data?.location?.country_name || '',
    city: data?.location?.city || '',
    lat: data?.location?.latitude ?? null,
    lon: data?.location?.longitude ?? null,
    ports: Array.isArray(data?.ports) ? data.ports.slice(0, 100) : [],
    vulns: Array.isArray(data?.vulns) ? data.vulns.slice(0, 30) : [],
    services,
  };
}

async function geoip(ip) {
  if (!validIpv4(ip)) throw new Error('IP IPv4 inválida');
  const data = await httpJson('GET', `https://ipinfo.io/${encodeURIComponent(ip)}/json`);
  const [lat, lon] = String(data?.loc || ',').split(',').map(Number);
  return {
    ip: data?.ip || ip,
    city: data?.city || '',
    region: data?.region || '',
    country: data?.country || '',
    org: data?.org || '',
    loc: data?.loc || '',
    lat: Number.isFinite(lat) ? lat : 0,
    lon: Number.isFinite(lon) ? lon : 0,
    timezone: data?.timezone || '',
  };
}

async function unifiedSearch(query, sources = ['shodan', 'geoip']) {
  const text = String(query || '').trim();
  const requested = Array.isArray(sources) ? sources : String(sources).split(',');
  const result = { query: text, sources: {}, ts: Date.now() };
  if (!text) return result;
  if (requested.includes('shodan')) {
    try {
      result.sources.shodan = validIpv4(text)
        ? { total: 1, matches: [{ ...(await shodanHost(text)), source: 'shodan-host' }] }
        : await shodanSearch(text);
    } catch (error) { result.sources.shodan = { error: error.message }; }
  }
  if (requested.includes('geoip') && validIpv4(text)) {
    try { result.sources.geoip = await geoip(text); }
    catch (error) { result.sources.geoip = { error: error.message }; }
  }
  return result;
}

function status() {
  return {
    shodan: secretState(SHODAN_KEY),
    censys: { ...secretState(CENSYS_ID && CENSYS_SECRET), note: 'lookup opcional' },
    fofa: { ...secretState(FOFA_EMAIL && FOFA_KEY), note: 'lookup opcional' },
    zoomeye: { ...secretState(ZOOMEYE_KEY), note: 'lookup opcional' },
    windy: { ...secretState(WINDY_KEY), note: 'webcams públicas' },
    geoip: { configured: true, note: 'ipinfo.io, sin clave' },
  };
}

function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')); }

async function emailLookup(email) {
  const value = String(email || '').trim();
  const result = { email: value, valid: validEmail(value), mx: [], provider: null, breaches: null };
  if (!result.valid) return { ...result, error: 'Formato de email inválido' };
  const domain = value.split('@')[1].toLowerCase();
  result.provider = domain;
  try {
    const mx = await httpJson('GET', `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    result.mx = (mx?.Answer || []).filter((answer) => answer.type === 15).map((answer) => answer.data).slice(0, 3);
    result.mxValid = result.mx.length > 0;
  } catch { result.mxValid = null; }
  if (HIBP_KEY) {
    try {
      const data = await httpJson('GET', `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(value)}?truncateResponse=true`, null, { headers: { 'hibp-api-key': HIBP_KEY, 'user-agent': 'knkLinux-OSINT' } });
      result.breaches = Array.isArray(data) ? data.map((item) => ({ name: item.Name, title: item.Title, date: item.BreachDate, count: item.PwnCount })).slice(0, 50) : [];
    } catch (error) { result.breaches = /404/.test(error.message) ? [] : { error: error.message }; }
  }
  return result;
}

async function usernameSearch(username) {
  const value = String(username || '').trim().replace(/^@/, '').slice(0, 80);
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) return { username: value, platforms: [], total: 0, found: 0, error: 'username inválido' };
  const platforms = [
    { name: 'GitHub', url: `https://api.github.com/users/${encodeURIComponent(value)}`, json: true, found: (data) => Boolean(data?.login) },
    { name: 'Reddit', url: `https://www.reddit.com/user/${encodeURIComponent(value)}/about.json`, json: true, found: (data) => Boolean(data?.data?.name) },
    { name: 'Instagram', url: `https://www.instagram.com/${encodeURIComponent(value)}/`, json: false },
    { name: 'YouTube', url: `https://www.youtube.com/@${encodeURIComponent(value)}`, json: false },
  ];
  const checks = await Promise.all(platforms.map(async (platform) => {
    try {
      const data = platform.json
        ? await httpJson('GET', platform.url, null, { headers: { 'user-agent': 'knkLinux-OSINT' } })
        : await httpText(platform.url, { headers: { 'user-agent': 'knkLinux-OSINT' }, maxBytes: 300_000 });
      const found = platform.found ? platform.found(data) : Boolean(data && !/page not found|not available/i.test(String(data).slice(0, 100_000)));
      return { platform: platform.name, url: platform.url, found };
    } catch (error) { return { platform: platform.name, url: platform.url, found: false, error: error.message.slice(0, 80) }; }
  }));
  return { username: value, platforms: checks, total: checks.length, found: checks.filter((item) => item.found).length };
}

async function phoneLookup(phone) {
  const value = String(phone || '').trim();
  const cleaned = value.replace(/[^\d+]/g, '');
  const result = { phone: value, valid: /^\+?\d{7,15}$/.test(cleaned), country: null, carrier: null, type: null };
  if (!result.valid) return { ...result, error: 'Número de teléfono inválido (7–15 dígitos)' };
  const prefix = cleaned.startsWith('+') ? cleaned.slice(1, 3) : cleaned.slice(0, 2);
  result.country = ({ 34: 'ES', 1: 'US', 44: 'GB', 33: 'FR', 49: 'DE', 39: 'IT', 52: 'MX', 54: 'AR', 55: 'BR', 56: 'CL', 57: 'CO', 51: 'PE' })[prefix] || 'Unknown';
  if (NUMVERIFY_KEY) {
    try {
      const data = await httpJson('GET', `http://apilayer.net/api/validate?access_key=${encodeURIComponent(NUMVERIFY_KEY)}&number=${encodeURIComponent(cleaned)}`);
      result.carrier = data?.carrier || null;
      result.type = data?.line_type || null;
      result.country = data?.country_code || result.country;
      result.location = data?.location || null;
    } catch {}
  }
  return result;
}

async function peopleSearch(query) {
  const value = String(query || '').trim();
  if (validEmail(value)) return { query: value, type: 'email', email: await emailLookup(value), ts: Date.now() };
  if (/^\+?[\d\s\-()]{7,}$/.test(value)) return { query: value, type: 'phone', phone: await phoneLookup(value), ts: Date.now() };
  return { query: value, type: 'username', username: await usernameSearch(value), ts: Date.now() };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cameraObservation(item, source, center) {
  const hasCoords = Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon));
  const distance = hasCoords && center ? Math.round(distanceKm(center.lat, center.lon, Number(item.lat), Number(item.lon)) * 100) / 100 : null;
  return {
    id: item.id || `${source}-${item.ip || item.name || 'observation'}`,
    name: item.name || item.ip || 'observación sin nombre',
    source,
    classification: 'public-indexed-observation',
    authorization: 'not-established',
    exposure: 'indexed-or-public',
    vulnerable: false,
    ip: item.ip || null,
    port: item.port || null,
    country: item.country || '',
    city: item.city || '',
    product: item.product || 'camera candidate',
    lat: hasCoords ? Number(item.lat) : null,
    lon: hasCoords ? Number(item.lon) : null,
    distanceKm: distance,
    lastSeen: item.timestamp || item.lastSeen || null,
    publicPage: item.publicPage || item.url || null,
    thumbnail: item.thumbnail || '',
    evidence: {
      source,
      query: item.query || null,
      screenshotIndexed: item.screenshotIndexed === true,
      observedAt: item.timestamp || item.lastSeen || null,
    },
  };
}

function dedupeObservations(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.ip ? `${item.ip}:${item.port || ''}` : `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parsePublicCameraItems(html, country) {
  const items = [];
  const pattern = /href="(\/en\/view\/(\d+)\/?)[^>]*"[^>]*title="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(html)) && items.length < 24) {
    const title = String(match[3] || '').replace(/\s+/g, ' ').trim();
    items.push({ id: `insecam-${match[2]}`, name: title || `Cámara pública ${match[2]}`, country, url: `https://www.insecam.org${match[1]}` });
  }
  return items;
}

async function insecamCameras(country = 'ES') {
  const cc = String(country || 'ES').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'ES';
  for (const origin of ['https://www.insecam.org', 'http://www.insecam.org']) {
    try {
      // rejectUnauthorized:false SOLO para el fallback http (en https no toca nada).
      const html = await httpText(`${origin}/en/bycountry/${cc}/`, { timeout: 12000, rejectUnauthorized: origin.startsWith('http:'), headers: { 'user-agent': 'knkLinux-OSINT/1.0', accept: 'text/html' }, maxBytes: 1_000_000 });
      const cameras = parsePublicCameraItems(html, cc);
      if (cameras.length) return { ok: true, cameras };
    } catch {}
  }
  return { ok: false, cameras: [], error: 'fuente pública no disponible o sin elementos parseables' };
}

async function windyWebcams(country = '', lat = null, lon = null, limit = 20) {
  if (!WINDY_KEY) return { webcams: [], note: 'Windy API key no configurada' };
  const params = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, Number(limit) || 20))), include: 'location,images' });
  if (country) params.set('country', String(country).toUpperCase().slice(0, 2));
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) { params.set('lat', String(lat)); params.set('lon', String(lon)); params.set('radius', '100'); }
  const data = await httpJson('GET', `https://api.windy.com/webcams/api/v3/webcams?${params}`, null, { headers: { 'x-windy-api-key': WINDY_KEY } });
  return {
    webcams: (data?.webcams || []).slice(0, 50).map((webcam) => ({
      id: webcam.webcamId || webcam.id,
      name: webcam.title || webcam.webcamId || webcam.id,
      status: webcam.status || null,
      location: webcam.location ? { city: webcam.location.city || '', region: webcam.location.region || '', country: webcam.location.country || '', latitude: webcam.location.latitude, longitude: webcam.location.longitude } : null,
      images: webcam.images ? { current: webcam.images.current?.preview || '', thumbnail: webcam.images.thumbnail?.preview || '' } : null,
      url: webcam.webcamsUrl || '',
    })),
    total: Number(data?.total) || 0,
  };
}

async function cameraAggregator(country = '', lat = null, lon = null, radius = 50) {
  const center = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) ? { lat: Number(lat), lon: Number(lon) } : null;
  const safeRadius = Math.max(1, Math.min(Number(radius) || 50, 100));
  const cameras = [];
  const sources = {};
  const add = (item, source) => cameras.push(cameraObservation(item, source, center));

  // Una única consulta geográfica y filtrada por puertos de cámara. La API es
  // pasiva: no se conecta a los resultados y no se devuelve ningún stream.
  if (SHODAN_KEY && center) {
    const query = `has_screenshot:true (port:554 OR port:80 OR port:443 OR port:8000 OR port:8080) geo:${center.lat},${center.lon}`;
    try {
      const data = await shodanSearch(query);
      const nearby = data.matches.filter((match) => Number.isFinite(match.lat) && Number.isFinite(match.lon) && distanceKm(center.lat, center.lon, match.lat, match.lon) <= safeRadius);
      nearby.slice(0, MAX_RESULTS).forEach((match) => add({ ...match, query, screenshotIndexed: true }, 'shodan'));
      sources.shodan = { count: nearby.length, status: 'ok', query };
    } catch (error) { sources.shodan = { count: 0, status: error.message, query }; }
  } else if (SHODAN_KEY) sources.shodan = { count: 0, status: 'coordinates-required-for-camera-search', query: null };
  else sources.shodan = { count: 0, status: 'not-configured', query: null };

  // Las fuentes públicas se muestran como catálogo separado, sin reproductor.
  if (country || !center) {
    try {
      const publicSource = await insecamCameras(country || 'ES');
      publicSource.cameras.forEach((item) => add(item, 'insecam'));
      sources.insecam = { count: publicSource.cameras.length, status: publicSource.ok ? 'ok' : publicSource.error };
    } catch (error) { sources.insecam = { count: 0, status: error.message }; }
  }
  try {
    const windy = await windyWebcams(country, center?.lat ?? null, center?.lon ?? null, 20);
    windy.webcams.forEach((item) => add({ id: `windy-${item.id}`, name: item.name, country: item.location?.country, city: item.location?.city, lat: item.location?.latitude, lon: item.location?.longitude, url: item.url, thumbnail: item.images?.thumbnail || item.images?.current }, 'windy'));
    sources.windy = { count: windy.webcams.length, status: windy.webcams.length ? 'ok' : (windy.note || 'sin datos') };
  } catch (error) { sources.windy = { count: 0, status: error.message }; }

  const unique = dedupeObservations(cameras).map((item) => ({ ...item, ...(item.distanceKm != null && item.distanceKm > safeRadius ? { outsideRadius: true } : {}) }));
  return {
    cameras: center ? unique.filter((item) => item.distanceKm == null || item.distanceKm <= safeRadius) : unique,
    total: center ? unique.filter((item) => item.distanceKm == null || item.distanceKm <= safeRadius).length : unique.length,
    sources,
    query: { country: String(country || '').toUpperCase(), center, radiusKm: safeRadius },
    semantics: 'public-indexed-observation',
    warning: '“Cerca” solo describe la distancia del índice. No implica propiedad, acceso ni vulnerabilidad; no se han abierto streams ni conectado los hosts encontrados.',
    ts: Date.now(),
  };
}

async function censysSearch(query, page = 1) {
  if (!CENSYS_ID || !CENSYS_SECRET) throw new Error('Censys API no configurada');
  const auth = Buffer.from(`${CENSYS_ID}:${CENSYS_SECRET}`).toString('base64');
  const data = await httpJson('GET', `https://search.censys.io/api/v2/hosts/search?q=${encodeURIComponent(String(query || '').slice(0, 300))}&page=${Math.max(1, Number(page) || 1)}`, null, { headers: { authorization: `Basic ${auth}` } });
  return { total: Number(data?.result?.total) || 0, hits: data?.result?.hits || [] };
}

async function censysHost(ip) {
  if (!validIpv4(ip)) throw new Error('IP IPv4 inválida');
  if (!CENSYS_ID || !CENSYS_SECRET) throw new Error('Censys API no configurada');
  const auth = Buffer.from(`${CENSYS_ID}:${CENSYS_SECRET}`).toString('base64');
  return httpJson('GET', `https://search.censys.io/api/v2/hosts/${encodeURIComponent(ip)}`, null, { headers: { authorization: `Basic ${auth}` } });
}

async function fofaSearch(query, page = 1) {
  if (!FOFA_EMAIL || !FOFA_KEY) throw new Error('FOFA API no configurada');
  const encoded = Buffer.from(String(query || '')).toString('base64');
  const data = await httpJson('GET', `https://fofa.info/api/v1/search/all?email=${encodeURIComponent(FOFA_EMAIL)}&key=${encodeURIComponent(FOFA_KEY)}&qbase64=${encodeURIComponent(encoded)}&page=${Math.max(1, Number(page) || 1)}&size=50&fields=host,port,protocol,country`, null, { timeout: 20000 });
  return { error: data?.error || null, size: Number(data?.size) || 0, results: data?.results || [] };
}

async function zoomeyeSearch(query, page = 1) {
  if (!ZOOMEYE_KEY) throw new Error('ZoomEye API no configurada');
  const data = await httpJson('GET', `https://api.zoomeye.org/resources-info?query=${encodeURIComponent(String(query || '').slice(0, 300))}&page=${Math.max(1, Number(page) || 1)}`, null, { headers: { authorization: `JWT ${ZOOMEYE_KEY}` } });
  return { total: Number(data?.total) || 0, matches: data?.matches || [] };
}

module.exports = {
  shodanSearch,
  shodanHost,
  geoip,
  unifiedSearch,
  status,
  emailLookup,
  usernameSearch,
  phoneLookup,
  peopleSearch,
  cameraAggregator,
  windyWebcams,
  censysSearch,
  censysHost,
  fofaSearch,
  zoomeyeSearch,
  insecamCameras,
};
