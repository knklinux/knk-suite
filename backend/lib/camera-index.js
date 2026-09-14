'use strict';

// Índice de observaciones públicas: Shodan/Insecam/Windy pueden indicar que
// algo fue indexado o publicado, pero este módulo nunca abre el activo, genera
// una URL de stream ni convierte la observación en una vulnerabilidad.

const osint = require('./osint');

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalize(item, source, center) {
  const lat = Number(item.lat);
  const lon = Number(item.lon);
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);
  const distance = hasCoordinates && center ? Math.round(distanceKm(center.lat, center.lon, lat, lon) * 100) / 100 : null;
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
    lastSeen: item.timestamp || item.lastSeen || null,
    distanceKm: distance,
    publicPage: item.publicPage || item.url || null,
    thumbnail: item.thumbnail || '',
    evidence: { source, query: item.query || null, screenshotIndexed: item.screenshotIndexed === true, observedAt: item.timestamp || item.lastSeen || null },
  };
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.ip ? `${item.ip}:${item.port || ''}` : `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchIndexedCameras({ country = '', lat = null, lon = null, radius = 50 } = {}) {
  const safeRadius = Math.max(1, Math.min(Number(radius) || 50, 100));
  const center = Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) ? { lat: Number(lat), lon: Number(lon) } : null;
  const aggregate = await osint.cameraAggregator(country, center?.lat ?? null, center?.lon ?? null, safeRadius);
  let cameras = (aggregate.cameras || []).map((item) => normalize(item, item.source || 'unknown', center));
  if (center) cameras = cameras.filter((item) => item.distanceKm == null || item.distanceKm <= safeRadius);
  cameras = dedupe(cameras);
  return { ...aggregate, cameras, total: cameras.length, query: { country: String(country || '').toUpperCase(), center, radiusKm: safeRadius }, semantics: 'public-indexed-observation', warning: '“Cerca” solo describe distancia geográfica del índice. No implica propiedad, acceso ni vulnerabilidad; usa la auditoría local únicamente con autorización explícita.' };
}

module.exports = { searchIndexedCameras, distanceKm, normalize, dedupe };
