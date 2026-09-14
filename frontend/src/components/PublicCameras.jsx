import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HLSPlayer from './HLSPlayer';
import HlsAuditPanel from './HlsAuditPanel';

// ============================================================================
// PublicCameras.jsx — Cámaras PÚBLICAS en directo
//
// Catálogo de fuentes públicas oficiales (tráfico, meteorología y webcams) con
// snapshot servido por el backend (`/api/cameras/public/snapshot`). El renderer
// nunca habla con el origen remoto: eso evita CORS, contenido mixto y que haya
// que abrir el CSP del workbench de escritorio a terceros.
//
// FILTROS
//   servidor → fuente, categoría, texto, centro+radio y página (48 por tanda)
//   cliente  → orden (distancia/nombre/fuente/categoría), país de la selección
//              cargada y «ocultar las que no responden».
// El filtro de país es cliente porque cada fuente cubre un país o el mundo: se
// ofrece solo lo que hay de verdad en la selección cargada, sin inventar listas.
// ============================================================================

const RADIUS_OPTIONS = [10, 25, 50, 100, 250, 1000];
const REFRESH_OPTIONS = [5, 10, 30, 0];
const MAP_W = 360;
const MAP_H = 180;
const PAGE_SIZE = 48;

const KIND_COLORS = {
  traffic: 'var(--primary)',
  weather: 'var(--green)',
  webcam: 'var(--yellow)',
};

const SORT_OPTIONS = [
  { id: 'relevance', label: 'Relevancia (orden de la fuente)' },
  { id: 'distance', label: 'Distancia a mí' },
  { id: 'name', label: 'Nombre' },
  { id: 'source', label: 'Fuente' },
  { id: 'kind', label: 'Categoría' },
];

const SELECT_STYLE = {
  padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11, fontFamily: 'monospace',
};

function Chip({ active, onClick, children, color = 'var(--primary)', title }) {
  return (
    <button className="btn btn-sm btn-outline" onClick={onClick} title={title}
      style={{ borderColor: active ? color : 'var(--border)', color: active ? color : 'var(--muted)' }}>
      {children}
    </button>
  );
}

export default function PublicCameras({ api }) {
  const [sources, setSources] = useState([]);
  const [kindLabels, setKindLabels] = useState({});
  const [source, setSource] = useState('all');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [radius, setRadius] = useState(50);
  const [center, setCenter] = useState(null);
  const [coordsInput, setCoordsInput] = useState('');
  const [geoState, setGeoState] = useState('idle'); // idle | asking | ok | error
  const [refreshSec, setRefreshSec] = useState(10);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [data, setData] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [showMap, setShowMap] = useState(true);
  const [sortBy, setSortBy] = useState('relevance');
  const [country, setCountry] = useState('all');
  const [hideFailing, setHideFailing] = useState(false);
  const [failed, setFailed] = useState(() => new Set());
  const loadToken = useRef(0);
  // Auditoría HLS por tarjeta: qué cámara tiene el panel abierto y su
  // manifiesto PROXIED pre-descargado (inline) para el análisis pasivo.
  const [auditFor, setAuditFor] = useState(null);
  const auditKey = (c) => `${c.source}:${c.id}`;
  const openAudit = async (camera) => {
    if (!camera.hls) return;
    if (auditFor && auditKey(auditFor.camera) === auditKey(camera)) { setAuditFor(null); return; }
    setAuditFor({ camera, manifest: null, loading: true, proxiedUrl: '' });
    let proxiedUrl = '';
    let manifest = null;
    try {
      const u = new URL(camera.hls, window.location.origin);
      // URL PROXIED absoluta: es la identidad del manifiesto que reproduce el
      // reproductor, y su host (127.0.0.1) es lo que hace que el host embebido
      // en la reescritura se detecte como ajeno por el analizador.
      proxiedUrl = u.toString();
      // El manifiesto se pide al PROXY same-origin (misma cookie de sesión):
      // es exactamente el texto que reproduce el reproductor, que es lo que
      // se debe auditar. Si falla, el backend lo descarga por sí mismo.
      try {
        const r = await fetch(u.pathname + u.search, { credentials: 'same-origin' });
        if (r.ok) manifest = await r.text();
      } catch { /* sin inline: backend fetch */ }
    } catch { /* camera.hls malformado: el endpoint dará el error */ }
    setAuditFor({ camera, manifest, loading: false, proxiedUrl });
  };

  const load = useCallback(async (options = {}) => {
    const { append = false, ...next } = options;
    const sourceId = next.source ?? source;
    const centerValue = next.center === undefined ? center : next.center;
    const queryValue = next.query ?? query;
    const radiusValue = next.radius ?? radius;
    const kindValue = next.kind === undefined ? kind : next.kind;
    const pageValue = append ? page + 1 : 0;

    const token = ++loadToken.current;
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ source: sourceId, limit: String(PAGE_SIZE), page: String(pageValue) });
      if (queryValue) params.set('q', queryValue);
      if (sourceId === 'all' && kindValue) params.set('kind', kindValue);
      if (centerValue) {
        params.set('lat', String(centerValue.lat));
        params.set('lon', String(centerValue.lon));
        params.set('radius', String(radiusValue));
      }
      const result = await api(`/cameras/public?${params.toString()}`);
      if (token !== loadToken.current) return;
      if (!result.ok) {
        setError(result.error || 'fuente no disponible');
        setData(result);
        if (!append) setCameras([]);
        return;
      }
      setData(result);
      setPage(pageValue);
      setCameras((prev) => (append ? [...prev, ...(result.cameras || [])] : (result.cameras || [])));
      if (!append) setFailed(new Set());
    } catch (e) {
      if (token === loadToken.current) setError(e.message);
    } finally {
      if (token === loadToken.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [api, source, center, query, radius, kind, page]);

  useEffect(() => {
    api('/cameras/public/sources').then((r) => {
      if (r.ok) {
        setSources(r.sources || []);
        setKindLabels(r.kindLabels || {});
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [source, kind, center, query, radius]);

  // Refresco periódico: solo cambia el contador de caché de las imágenes.
  useEffect(() => {
    if (!refreshSec) return undefined;
    const id = setInterval(() => setTick((value) => value + 1), refreshSec * 1000);
    return () => clearInterval(id);
  }, [refreshSec]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoState('error'); return; }
    setGeoState('asking');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoState('ok');
        setCenter({ lat: Number(position.coords.latitude.toFixed(4)), lon: Number(position.coords.longitude.toFixed(4)) });
      },
      () => setGeoState('error'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  };

  const applyManualCoords = () => {
    const match = coordsInput.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) { setGeoState('error'); return; }
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { setGeoState('error'); return; }
    setGeoState('ok');
    setCenter({ lat, lon });
    setCoordsInput('');
  };

  const activeSource = sources.find((s) => s.id === source);

  // Agrupación del selector: "todas" primero y luego una entrada por categoría.
  const grouped = useMemo(() => {
    const byKind = new Map();
    for (const item of sources) {
      if (!byKind.has(item.kind)) byKind.set(item.kind, []);
      byKind.get(item.kind).push(item);
    }
    return [...byKind.entries()];
  }, [sources]);

  const kinds = useMemo(() => Object.keys(kindLabels).length ? kindLabels : {
    traffic: 'Tráfico', weather: 'Meteorología', webcam: 'Webcams',
  }, [kindLabels]);

  const sourceCounts = data?.sources
    ? Object.entries(data.sources).map(([id, info]) => ({ id, ...info }))
    : [];

  // Países presentes en lo cargado: el filtro nunca queda vacío de opciones.
  const countries = useMemo(() => {
    const seen = new Map();
    for (const camera of cameras) {
      if (camera.country && !seen.has(camera.country)) seen.set(camera.country, (seen.get(camera.country) || 0) + 1);
    }
    return [...seen.keys()].sort();
  }, [cameras]);

  // ── filtros de cliente (sobre lo ya cargado) ──────────────────────
  const visible = useMemo(() => {
    let list = cameras;
    if (country !== 'all') list = list.filter((camera) => camera.country === country);
    if (hideFailing) list = list.filter((camera) => !failed.has(`${camera.source}:${camera.id}`));

    const sorted = [...list];
    if (sortBy === 'distance') {
      sorted.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } else if (sortBy === 'name') {
      sorted.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
    } else if (sortBy === 'source') {
      sorted.sort((a, b) => String(a.sourceLabel || a.source).localeCompare(String(b.sourceLabel || b.source), 'es')
        || String(a.name).localeCompare(String(b.name), 'es'));
    } else if (sortBy === 'kind') {
      sorted.sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.name).localeCompare(String(b.name), 'es'));
    }
    return sorted;
  }, [cameras, country, hideFailing, failed, sortBy]);

  const totalLoaded = cameras.length;
  const totalAvailable = data?.total ?? totalLoaded;
  const canLoadMore = totalLoaded < totalAvailable;

  const activeFilters = [
    source !== 'all' && (activeSource?.label || source),
    kind && `categoría: ${kinds[kind] || kind}`,
    query && `texto: “${query}”`,
    center && `radio: ${radius} km`,
    country !== 'all' && `país: ${country}`,
    sortBy !== 'relevance' && `orden: ${SORT_OPTIONS.find((s) => s.id === sortBy)?.label}`,
    hideFailing && 'ocultando las que fallan',
  ].filter(Boolean);

  const clearFilters = () => {
    setSource('all');
    setKind('');
    setQuery('');
    setCountry('all');
    setSortBy('relevance');
    setHideFailing(false);
    setFailed(new Set());
  };

  // Ventana del mapa. Sin centro: mundo entero (2:1). Con centro: caja de
  // 4·radio de ancho × 2·radio de alto, para que la escala sea isótropa en un
  // lienzo 2:1 (si no, el mapa aparecería estirado en horizontal).
  const viewWindow = useMemo(() => {
    if (!center) return { minLon: -180, maxLon: 180, minLat: -90, maxLat: 90, zoomed: false };
    const dLat = radius / 111;
    const dLon = (2 * radius) / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
    return {
      minLon: Math.max(-180, center.lon - dLon),
      maxLon: Math.min(180, center.lon + dLon),
      minLat: Math.max(-90, center.lat - dLat),
      maxLat: Math.min(90, center.lat + dLat),
      zoomed: true,
    };
  }, [center, radius]);

  const boxW = Math.max(0.001, viewWindow.maxLon - viewWindow.minLon);
  const boxH = Math.max(0.001, viewWindow.maxLat - viewWindow.minLat);
  const radiusRing = viewWindow.zoomed ? 90 : null;

  const project = useCallback((lat, lon) => ({
    x: ((lon - viewWindow.minLon) / boxW) * MAP_W,
    y: ((viewWindow.maxLat - lat) / boxH) * MAP_H,
  }), [viewWindow, boxW, boxH]);

  const dots = useMemo(() => visible
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map((c) => ({
      id: `${c.source}:${c.id}`,
      kind: c.kind,
      name: c.name,
      source: c.source,
      cam: c,
      ...project(c.lat, c.lon),
    })), [visible, project]);

  // Siluetas continentales aproximadas (lon/lat) para orientar el mapa de puntos.
  const CONTINENTS = useMemo(() => ([
    [[-168,66],[-150,70],[-130,70],[-110,72],[-90,70],[-75,72],[-60,60],[-55,47],[-65,44],[-70,42],[-74,39],[-80,32],[-84,30],[-90,29],[-97,26],[-104,23],[-110,24],[-114,30],[-121,36],[-124,42],[-130,50],[-140,60],[-152,60],[-165,62]],
    [[-80,10],[-70,12],[-60,8],[-50,0],[-40,-5],[-35,-10],[-40,-20],[-48,-28],[-55,-35],[-62,-42],[-68,-50],[-70,-55],[-73,-45],[-73,-35],[-70,-22],[-77,-12],[-80,-5],[-80,5]],
    [[-10,36],[-9,43],[-2,48],[-5,50],[0,52],[5,55],[8,58],[10,60],[18,62],[25,70],[35,70],[45,68],[45,60],[35,55],[28,55],[20,52],[15,48],[10,45],[5,43],[0,40],[-5,36]],
    [[-17,15],[-10,28],[0,35],[10,37],[20,33],[30,32],[35,28],[40,20],[48,12],[51,10],[45,0],[40,-10],[35,-20],[30,-30],[25,-35],[20,-35],[15,-28],[12,-18],[10,-8],[5,0],[-5,5],[-12,10]],
    [[35,70],[50,72],[70,75],[90,78],[110,78],[130,75],[150,72],[170,68],[180,65],[170,60],[160,55],[155,50],[140,45],[130,40],[122,35],[115,30],[110,20],[105,10],[100,5],[95,10],[90,20],[85,25],[75,20],[70,15],[65,25],[55,28],[50,30],[45,35],[40,38]],
    [[113,-22],[122,-17],[132,-12],[142,-11],[150,-15],[153,-25],[150,-35],[140,-38],[130,-35],[124,-32],[115,-28]],
  ]), []);

  const kindCounts = useMemo(() => {
    const acc = {};
    for (const c of visible) acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, [visible]);

  const centerDot = center ? project(center.lat, center.lon) : null;

  const markFailed = useCallback((camera) => {
    setFailed((prev) => {
      const key = `${camera.source}:${camera.id}`;
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  return (
    <div style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>🎥</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontFamily: "'Courier New', monospace" }}>CÁMARAS PÚBLICAS</h2>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
            Tráfico · meteorología · webcams · del mundo y de tu entorno · sin claves de pago
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={source} onChange={(e) => { setSource(e.target.value); setKind(''); setSelected(null); }}
            style={{ ...SELECT_STYLE, maxWidth: 260 }}>
            <option value="all">🌍 Todas las fuentes ({sources.length})</option>
            {grouped.map(([groupKind, items]) => (
              <optgroup key={groupKind} label={kinds[groupKind] || groupKind}>
                {items.map((s) => (
                  <option key={s.id} value={s.id} disabled={s.configured === false}>
                    {s.label}{s.configured === false ? ' — sin clave' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {(() => {
            const sinClave = sources.filter((s) => s.configured === false);
            if (!sinClave.length) return null;
            return (
              <span title={sinClave.map((s) => `${s.label}: ${s.note || 'requiere clave'}`).join(' · ')}
                style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--yellow)', border: '1px solid rgba(255,199,0,0.4)', borderRadius: 5, padding: '3px 8px' }}>
                🔑 {sinClave.map((s) => s.id).join(', ')}: clave gratuita pendiente (config.json)
              </span>
            );
          })()}
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Carretera, ciudad, región o fuente (ej: A-7, Madrid, Islandia)"
            onKeyDown={(e) => { if (e.key === 'Enter') load({ query: e.target.value }); }}
            style={{ flex: 1, minWidth: 200, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
          <button className="btn btn-sm btn-outline" onClick={useMyLocation} title="Filtra por distancia a tu posición">
            {geoState === 'asking' ? '📡 Localizando…' : '📍 Mi ubicación'}
          </button>
          {center && (
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={SELECT_STYLE}>
              {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r >= 1000 ? `${r / 1000} mil km` : `${r} km`}</option>)}
            </select>
          )}
          <select value={refreshSec} onChange={(e) => setRefreshSec(Number(e.target.value))}
            title="Refresco automático de los snapshots" style={SELECT_STYLE}>
            {REFRESH_OPTIONS.map((r) => <option key={r} value={r}>{r ? `↻ ${r}s` : '↻ off'}</option>)}
          </select>
          <button className="btn btn-sm" onClick={() => load()} disabled={loading}>
            {loading ? '⏳ Cargando…' : '🎥 Ver cámaras'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={SELECT_STYLE} title="Orden de las tarjetas">
            {SORT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={country} onChange={(e) => setCountry(e.target.value)} style={SELECT_STYLE} title="País de las cámaras cargadas">
            <option value="all">🌍 Todos los países</option>
            {countries.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
          <Chip active={hideFailing} color="var(--yellow)" onClick={() => setHideFailing((v) => !v)}
            title="Quita de la vista las cámaras cuyo snapshot no responde">
            {hideFailing ? '🙈' : '👁️'} ocultar las que fallan{failed.size ? ` (${failed.size})` : ''}
          </Chip>
          {refreshSec > 0 && failed.size > 0 && (
            <button className="btn btn-sm btn-outline" onClick={() => setFailed(new Set())}>↻ reintentar fallidas</button>
          )}
        </div>

        {source === 'all' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <Chip active={!kind} onClick={() => setKind('')}>Todas las categorías</Chip>
            {Object.entries(kinds).map(([id, label]) => (
              <Chip key={id} active={kind === id} color={KIND_COLORS[id]} onClick={() => setKind(kind === id ? '' : id)}>
                {label}
              </Chip>
            ))}
            <button className="btn btn-sm btn-outline" onClick={() => setShowMap((v) => !v)} style={{ marginLeft: 'auto' }}>
              {showMap ? '🗺️ ocultar mapa' : '🗺️ ver mapa'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <input value={coordsInput} onChange={(e) => setCoordsInput(e.target.value)}
            placeholder="o coordenadas: 36.7213, -4.4213"
            onKeyDown={(e) => { if (e.key === 'Enter') applyManualCoords(); }}
            style={{ width: 230, padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 10, fontFamily: 'monospace' }} />
          <button className="btn btn-sm btn-outline" onClick={applyManualCoords} disabled={!coordsInput}>◎ Usar</button>
          {center && (
            <span style={{ fontSize: 10, color: 'var(--primary)', fontFamily: 'monospace' }}>
              ◎ {center.lat}, {center.lon} · radio {radius} km
              <button onClick={() => setCenter(null)} style={{ marginLeft: 6, fontSize: 9, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕ quitar</button>
            </span>
          )}
          {data && data.ok && (
            <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'monospace' }}>
              ● mostrando {visible.length} de {totalAvailable} cámaras{query ? ` para “${query}”` : ''}
              {totalLoaded < totalAvailable ? ` · ${totalLoaded} cargadas` : ''}
            </span>
          )}
          {activeFilters.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
              filtros: {activeFilters.join(' · ')}
            </span>
          )}
          {activeFilters.length > 0 && (
            <button className="btn btn-sm btn-outline" onClick={clearFilters}>✕ limpiar filtros</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {source === 'all'
              ? 'Todas las fuentes públicas activas. Elige una categoría para filtrar o una fuente concreta.'
              : (activeSource ? activeSource.note : 'Selecciona una fuente pública.')}
          </span>
          {geoState === 'error' && (
            <span style={{ fontSize: 10, color: 'var(--yellow)' }}>
              ⚠️ Ubicación no disponible aquí — escribe las coordenadas a mano
            </span>
          )}
          {sortBy === 'distance' && !center && (
            <span style={{ fontSize: 10, color: 'var(--yellow)' }}>
              ⚠️ sin centro no hay distancias: usa 📍 Mi ubicación o escribe coordenadas
            </span>
          )}
        </div>

        {sourceCounts.length > 1 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            {sourceCounts.map((entry) => (
              <span key={entry.id} style={{ fontSize: 9, fontFamily: 'monospace', color: entry.count ? 'var(--muted)' : 'var(--yellow)' }}>
                {entry.id}: {entry.count || entry.status.slice(0, 40)}
              </span>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,199,0,0.4)', background: 'rgba(255,199,0,0.08)' }}>
          <div style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 700, marginBottom: 4 }}>⚠️ {error}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {source === 'windy'
              ? 'Windy necesita una clave gratuita: config.json → windyApiKey.'
              : 'Comprueba la conexión o cambia de fuente.'}
          </div>
        </div>
      )}

      {showMap && visible.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', letterSpacing: 1 }}>
              MAPA DE CÁMARAS{viewWindow.zoomed ? ` · RADIO ${radius} KM` : ' · MUNDO'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
              {dots.length} de {visible.length} con coordenadas
            </span>
          </div>
          <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: '100%', aspectRatio: '2 / 1', display: 'block', background: '#05070c', border: '1px solid var(--border)', borderRadius: 6 }}>
            <g stroke="rgba(8,216,255,0.10)" strokeWidth="0.4">
              {Array.from({ length: 11 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 18} x2={MAP_W} y2={i * 18} />)}
              {Array.from({ length: 19 }, (_, i) => <line key={`v${i}`} x1={i * 20} y1="0" x2={i * 20} y2={MAP_H} />)}
            </g>
            <g fill="rgba(8,216,255,0.06)" stroke="rgba(8,216,255,0.25)" strokeWidth="0.5">
              {CONTINENTS.map((poly, i) => (
                <polygon key={i} points={poly.map(([lo, la]) => { const p = project(la, lo); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ')} />
              ))}
            </g>
            {!viewWindow.zoomed && (
              <line x1="0" y1={MAP_H / 2} x2={MAP_W} y2={MAP_H / 2} stroke="rgba(8,216,255,0.3)" strokeWidth="0.6" strokeDasharray="3 3" />
            )}
            {radiusRing && centerDot && (
              <circle cx={centerDot.x} cy={centerDot.y} r={radiusRing} fill="none" stroke="rgba(255,77,210,0.30)" strokeWidth="0.8" strokeDasharray="4 3" />
            )}
            {dots.map((dot) => (
              <circle key={dot.id} cx={dot.x} cy={dot.y} r={selected && `${selected.source}:${selected.id}` === dot.id ? 4 : 2.4}
                fill={KIND_COLORS[dot.kind] || '#08d8ff'} opacity="0.9"
                stroke={selected && `${selected.source}:${selected.id}` === dot.id ? '#fff' : 'none'} strokeWidth="1"
                style={{ cursor: 'pointer' }} onClick={() => setSelected(dot.cam)}>
                <title>{`${dot.name} — ${dot.source}`}</title>
              </circle>
            ))}
            {centerDot && (
              <g>
                <circle cx={centerDot.x} cy={centerDot.y} r="5" fill="none" stroke="#ff4dd2" strokeWidth="1.2" />
                <circle cx={centerDot.x} cy={centerDot.y} r="1.8" fill="#ff4dd2" />
              </g>
            )}
          </svg>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            {Object.entries(kinds).map(([id, label]) => (
              <span key={id} style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)' }}>
                <span style={{ color: KIND_COLORS[id] }}>●</span> {label}{kindCounts[id] ? ` (${kindCounts[id]})` : ''}
              </span>
            ))}
            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)', marginLeft: 'auto' }}>clic en un punto para abrir la cámara</span>
          </div>
        </div>
      )}

      {selected && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--primary)' }}>
              {selected.source} · {selected.name}
            </span>
            <button className="btn btn-sm btn-outline" onClick={() => setSelected(null)}>✕ cerrar</button>
          </div>
          <SnapshotImage camera={selected} tick={tick} height="62vh" showHls startLive={false} logCtx={{ view: 'camaras-detalle', label: selected.name }} />
          <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6, fontFamily: 'monospace' }}>
            {selected.attribution}{selected.distanceKm != null ? ` · ${selected.distanceKm} km de ti` : ''}{selected.hls ? ' · 🔴 HLS en directo' : ''}
            {selected.timelapse && (
              <span> · <a href={selected.timelapse} target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>🎞 timelapse del día</a></span>
            )}
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {visible.map((camera) => (
            <div key={`${camera.source}:${camera.id}`}
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(8,216,255,0.08)', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${camera.sourceLabel} — ${camera.name}`}>
                  {camera.name}
                </span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {camera.video && <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--green)' }} title="Esta cámara emite vídeo HLS: puedes abrirlo en VLC con el enlace del visor">▶ HLS</span>}
                  {camera.distanceKm != null && (
                    <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{camera.distanceKm} km</span>
                  )}
                </span>
              </div>
              <SnapshotImage camera={camera} tick={tick} height={160} onClick={() => setSelected(camera)} onFail={markFailed} showHls={true} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px' }}>
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: KIND_COLORS[camera.kind] || 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  [{camera.source}]{camera.road ? ` · ${camera.road}` : ''}{camera.city ? ` · ${camera.city}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {camera.hls && (
                    <button className="btn btn-sm btn-outline" style={{ padding: '1px 6px', fontSize: 9 }}
                      onClick={(e) => { e.stopPropagation(); openAudit(camera); }}
                      title="Auditar el proxy HLS de esta cámara: detecta reescritura de hosts ajenos (proxy abierto → SSRF)">
                      🛡 auditar
                    </button>
                  )}
                  <button className="btn btn-sm btn-outline" style={{ padding: '1px 6px', fontSize: 9 }} onClick={() => setSelected(camera)}>ampliar</button>
                </span>
              </div>
              {auditFor && auditKey(auditFor.camera) === auditKey(camera) && auditFor.loading && (
                <div style={{ padding: '6px 8px', fontSize: 9, fontFamily: 'monospace', color: 'var(--primary)', borderTop: '1px dashed var(--border)' }}>
                  🛡 preparando auditoría del proxy HLS…
                </div>
              )}
              {auditFor && auditKey(auditFor.camera) === auditKey(camera) && !auditFor.loading && (
                <div style={{ padding: '0 8px 8px' }}>
                  <HlsAuditPanel api={api} manifestUrl={auditFor.proxiedUrl} manifestInline={auditFor.manifest} cameraName={camera.name} onClose={() => setAuditFor(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canLoadMore && !loading && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
          <button className="btn btn-sm" onClick={() => load({ append: true })} disabled={loadingMore}>
            {loadingMore ? '⏳ Cargando…' : `⬇️ cargar ${Math.min(PAGE_SIZE, totalAvailable - totalLoaded)} más (${totalLoaded}/${totalAvailable})`}
          </button>
        </div>
      )}

      {!loading && data && data.ok && visible.length === 0 && (
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🛰️</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {totalLoaded === 0
              ? 'Sin cámaras para este filtro. Prueba a ampliar el radio, cambiar de categoría o limpiar la búsqueda.'
              : 'Los filtros de cliente (país / ocultar fallidas) dejaron la lista vacía. Pulsa «limpiar filtros».'}
          </div>
        </div>
      )}

      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 12, padding: 8, background: 'rgba(8,216,255,0.05)', borderRadius: 6, fontFamily: 'monospace' }}>
        ⚖️ Solo fuentes públicas oficiales. El snapshot se reenvía por el backend local
        (<code>/api/cameras/public/snapshot</code>), así que el renderer nunca abre el origen remoto
        ni necesita que el CSP permita terceros. Para vídeo en directo ve a <b>INTELIGENCIA → 🔴 En Directo</b>.
        La auditoría activa de cámaras sigue restringida a tu red autorizada.
      </div>
    </div>
  );
}

// Snapshot con motivo de error real: si el origen falla, se explica por qué en
// lugar de dejar una imagen rota silenciosa. `onFail` avisa al padre para poder
// ofrecer el filtro «ocultar las que fallan».
function SnapshotImage({ camera, tick, height, onClick, onFail, showHls = false, startLive = false, logCtx }) {
  const [state, setState] = useState('loading');
  const [reason, setReason] = useState('');
  const [live, setLive] = useState(startLive);
  const src = `${camera.snapshot}&t=${tick}`;
  const hasHls = showHls && camera.hls;

  useEffect(() => { setState('loading'); setReason(''); }, [src]);
  useEffect(() => { setLive(startLive); }, [camera.snapshot, camera.hls]);

  if (hasHls && live) {
    return (
      <div style={{ position: 'relative', background: '#000', minHeight: typeof height === 'number' ? height : 160 }}>
        <HLSPlayer src={camera.hls} rawUrl={camera.video} poster={src} width="100%" height={height || 160} autoPlay={true} muted={true} showCheck logCtx={logCtx || { view: 'camaras', label: camera.name }} />
        <button onClick={(e) => { e.stopPropagation(); setLive(false); }} title="Volver a la foto"
          style={{ position: 'absolute', top: 4, right: 4, padding: '2px 8px', fontSize: 9, background: 'rgba(0,0,0,0.65)', color: '#fff', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>
          📷 Foto
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', background: '#000', minHeight: typeof height === 'number' ? height : 160, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}>
      {state !== 'error' && (
        <img src={src} alt={`Cámara ${camera.name}`}
          style={{ width: '100%', height, objectFit: 'cover', display: state === 'loading' ? 'none' : 'block' }}
          onLoad={() => setState('ok')}
          onError={async () => {
            setState('error');
            if (typeof onFail === 'function') onFail(camera);
            try {
              const response = await fetch(src, { credentials: 'same-origin' });
              const body = await response.json();
              setReason(body?.error || `HTTP ${response.status}`);
            } catch { setReason('sin respuesta del proxy local'); }
          }} />
      )}
      {state === 'loading' && (
        <div style={{ padding: 18, textAlign: 'center', fontSize: 9, color: 'var(--primary)', fontFamily: 'monospace' }}>
          <div style={{ fontSize: 18, animation: 'pulse 1.5s infinite' }}>📷</div>
          conectando al snapshot…
        </div>
      )}
      {state === 'error' && (
        <div style={{ padding: 14, textAlign: 'center', fontSize: 9, color: 'var(--yellow)', fontFamily: 'monospace' }}>
          ⚠️ snapshot no disponible
          <div style={{ marginTop: 4, color: 'var(--muted)', wordBreak: 'break-word' }}>{reason}</div>
        </div>
      )}
      {hasHls && !live && state !== 'error' && (
        <button onClick={(e) => { e.stopPropagation(); setLive(true); }} title="Ver en directo (HLS)"
          style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', padding: '3px 12px', fontSize: 10, fontWeight: 700,
            background: 'rgba(63,185,80,0.9)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
          ▶ DIRECTO
        </button>
      )}
    </div>
  );
}
