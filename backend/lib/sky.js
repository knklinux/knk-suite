'use strict';

// ============================================================================
// sky.js — Cielo en directo sin claves: vuelos ADS-B (OpenSky), satélites
// (CelesTrak TLE + SGP4 local), Sol (SWPC/NOAA) y sistema solar (dataset).
// Todo gratuito y sin registro. Cachés en memoria para respetar rate-limits.
// ============================================================================

const https = require('https');
const http = require('http');
const sat = require('satellite.js');

function fetchJson(url, timeoutMs = 15000, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const mod = String(url).startsWith('https') ? https : http;
    const rq = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'knkSuite-Sky/1.0' } }, (rs) => {
      if (rs.statusCode >= 300 && rs.statusCode < 400 && rs.headers.location) {
        let next = null;
        try { next = new URL(rs.headers.location, url).toString(); } catch {}
        if (next) return fetchJson(next, timeoutMs, maxBytes).then(resolve, reject);
        return reject(new Error(`redirect ${rs.statusCode}`));
      }
      if (rs.statusCode !== 200) { rs.resume(); return reject(new Error(`upstream ${rs.statusCode}`)); }
      let body = '';
      rs.on('data', (c) => { body += c; if (body.length > maxBytes) rq.destroy(); });
      rs.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('JSON inválido')); } });
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
  });
}

function fetchText(url, timeoutMs = 15000, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const mod = String(url).startsWith('https') ? https : http;
    const rq = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'knkSuite-Sky/1.0' } }, (rs) => {
      if (rs.statusCode !== 200) { rs.resume(); return reject(new Error(`upstream ${rs.statusCode}`)); }
      let body = '';
      rs.on('data', (c) => { body += c; if (body.length > maxBytes) rq.destroy(); });
      rs.on('end', () => resolve(body));
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('timeout')); });
  });
}

// ── Vuelos ADS-B (OpenSky, anónimo, caché 75 s) ──────────────────────

const _flightsCache = new Map();

function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

async function getFlights({ lamin, lomin, lamax, lomax }) {
  const laMin = num(lamin, -90, 90), loMin = num(lomin, -180, 180);
  const laMax = num(lamax, -90, 90), loMax = num(lomax, -180, 180);
  if (laMin == null || loMin == null || laMax == null || loMax == null || laMin >= laMax || loMin >= loMax) {
    throw new Error('bbox inválida (lamin/lomin/lamax/lomax)');
  }
  if (laMax - laMin > 40 || loMax - loMin > 60) throw new Error('bbox demasiado grande (máx 40°×60°)');
  const key = [laMin, loMin, laMax, loMax].join(',');
  const hit = _flightsCache.get(key);
  if (hit && Date.now() - hit.at < 75000) return { ...hit.data, cached: true };

  const j = await fetchJson(
    `https://opensky-network.org/api/states/all?lamin=${laMin}&lomin=${loMin}&lamax=${laMax}&lomax=${loMax}`,
    20000, 12 * 1024 * 1024,
  );
  const states = Array.isArray(j.states) ? j.states : [];
  const flights = [];
  for (const s of states) {
    if (!s || s[5] == null || s[6] == null) continue;
    flights.push({
      icao24: s[0], callsign: (s[1] || '').trim() || null,
      country: s[2] || '', lat: s[6], lon: s[5],
      altM: s[7], velMs: s[9], heading: s[10],
      onGround: Boolean(s[8]),
    });
    if (flights.length >= 400) break;
  }
  const data = { time: j.time || Math.floor(Date.now() / 1000), total: flights.length, flights };
  _flightsCache.set(key, { at: Date.now(), data });
  return { ...data, cached: false };
}

// ── Satélites (CelesTrak TLE + SGP4 local) ───────────────────────────

const SATS = [
  { id: '25544', name: 'ISS', category: 'Estación' },
  { id: '20580', name: 'Hubble (HST)', category: 'Telescopio' },
  { id: '48274', name: 'Tiangong (CSS)', category: 'Estación' },
  { id: '33591', name: 'NOAA-19', category: 'Meteo' },
  { id: '41866', name: 'GOES-16', category: 'Meteo' },
];

const _tleCache = new Map();

async function getTLE(noradId) {
  const id = String(noradId || '').replace(/\D/g, '').slice(0, 8);
  if (!id) throw new Error('NORAD ID inválido');
  const hit = _tleCache.get(id);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.tle;
  const txt = await fetchText(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`, 15000);
  const lines = txt.split('\n').map((l) => l.trim()).filter(Boolean);
  const l1 = lines.find((l) => l.startsWith('1 '));
  const l2 = lines.find((l) => l.startsWith('2 '));
  if (!l1 || !l2) throw new Error('TLE no encontrado');
  const tle = { name: (lines[0] && !lines[0].startsWith('1 ') ? lines[0] : `NORAD ${id}`), l1, l2 };
  _tleCache.set(id, { at: Date.now(), tle });
  return tle;
}

function propagateNow(l1, l2) {
  const satrec = sat.twoline2satrec(l1, l2);
  const now = new Date();
  const pv = sat.propagate(satrec, now);
  if (!pv || !pv.position) return null;
  const gmst = sat.gstime(now);
  const gd = sat.eciToGeodetic(pv.position, gmst);
  return {
    lat: Math.round(sat.degreesLat(gd.latitude) * 1000) / 1000,
    lon: Math.round(sat.degreesLong(gd.longitude) * 1000) / 1000,
    altKm: Math.round(gd.height * 10) / 10,
  };
}

async function getSatPositions() {
  const out = [];
  for (const s of SATS) {
    try {
      const tle = await getTLE(s.id);
      const pos = propagateNow(tle.l1, tle.l2);
      out.push({ ...s, ...pos, ok: Boolean(pos) });
    } catch (e) {
      out.push({ ...s, ok: false, error: e.message });
    }
  }
  return { at: Math.floor(Date.now() / 1000), sats: out };
}

// ── Sol en directo (SWPC/NOAA, sin clave) ────────────────────────────

let _sunCache = { at: 0, data: null };

function flareClass(flux) {
  if (!Number.isFinite(flux) || flux <= 0) return '—';
  const exp = Math.floor(Math.log10(flux)) + 8; // W/m² → clase
  const letters = ['A', 'B', 'C', 'M', 'X'];
  const idx = Math.max(0, Math.min(4, exp));
  return `${letters[idx]}${(flux / 10 ** (idx - 8)).toFixed(1)}`;
}

async function getSun() {
  if (_sunCache.data && Date.now() - _sunCache.at < 5 * 60 * 1000) return { ..._sunCache.data, cached: true };
  const [xrays, scales] = await Promise.all([
    fetchJson('https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json', 20000, 4 * 1024 * 1024),
    fetchJson('https://services.swpc.noaa.gov/products/noaa-scales.json', 15000).catch(() => null),
  ]);
  const pts = (Array.isArray(xrays) ? xrays : []).filter((p) => Number.isFinite(p.flux));
  const latest = pts.length ? pts[pts.length - 1] : null;
  const data = {
    fluxNow: latest ? latest.flux : null,
    classNow: latest ? flareClass(latest.flux) : '—',
    observedAt: latest ? latest.time_tag : null,
    scales: scales || null,
    source: 'SWPC/NOAA',
  };
  _sunCache = { at: Date.now(), data };
  return { ...data, cached: false };
}

// ── Sistema solar (dataset curado; los hechos no cambian) ────────────

function getPlanets() {
  return [
    { name: 'Mercurio', distAU: 0.39, diameterKm: 4879, dayH: 4222.6, yearD: 88, moons: 0, color: '#b5a48c' },
    { name: 'Venus', distAU: 0.72, diameterKm: 12104, dayH: 2802, yearD: 225, moons: 0, color: '#e8c47a' },
    { name: 'Tierra', distAU: 1, diameterKm: 12742, dayH: 24, yearD: 365.25, moons: 1, color: '#4d9de0' },
    { name: 'Marte', distAU: 1.52, diameterKm: 6779, dayH: 24.7, yearD: 687, moons: 2, color: '#e07a4d' },
    { name: 'Júpiter', distAU: 5.2, diameterKm: 139820, dayH: 9.9, yearD: 4333, moons: 95, color: '#d8a97e' },
    { name: 'Saturno', distAU: 9.58, diameterKm: 116460, dayH: 10.7, yearD: 10759, moons: 146, color: '#e3cf9e' },
    { name: 'Urano', distAU: 19.2, diameterKm: 50724, dayH: 17.2, yearD: 30687, moons: 28, color: '#9fe3e0' },
    { name: 'Neptuno', distAU: 30.1, diameterKm: 49244, dayH: 16.1, yearD: 60190, moons: 16, color: '#5b7fe0' },
  ];
}

module.exports = { getFlights, getTLE, getSatPositions, getSun, getPlanets, SATS };
