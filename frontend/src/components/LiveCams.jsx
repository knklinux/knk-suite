import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HLSPlayer from './HLSPlayer';

// ============================================================================
// LiveCams.jsx — «EN DIRECTO» (módulo separado de vídeo en vivo)
//
// A diferencia de «Fuentes Cámaras» (dorks/metadatos), aquí TODA tarjeta pinta
// vídeo o imagen real servida por el proxy same-origin del backend:
//   · En directo → señales demo verificadas + muestra 511NY/Caltrans (HLS).
//   · Explorar   → cámaras DOT por fuente con HLS donde exista.
//   · Comunidad  → directorios SFW (Skyline, WorldCam, explore.org…).
//   · 18+        → plataformas adultas con gate local: miniaturas + ficha
//                  externa (sus HLS llevan tokens efímeros; incrustarlos se
//                  rompe en horas y viola sus ToS).
//   · URL        → pega cualquier .m3u8/.mjpeg/.jpg público y se reproduce.
// ============================================================================

const TABS = [
  { id: 'live', icon: '🔴', name: 'En directo' },
  { id: 'explore', icon: '🧭', name: 'Explorar DOT' },
  { id: 'nasa', icon: '🛰️', name: 'NASA' },
  { id: 'cielo', icon: '🛩️', name: 'Cielo' },
  { id: 'monumentos', icon: '🏛️', name: 'Monumentos' },
  { id: 'hacking', icon: '💻', name: 'Hacking' },
  { id: 'community', icon: '🌐', name: 'Comunidad' },
  { id: 'adult', icon: '🔞', name: '18+' },
  { id: 'custom', icon: '🔗', name: 'URL' },
];

const RADIUS_OPTIONS = [25, 50, 100, 250, 500, 1000];

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const ADULT_TAGS = ['spanish', 'latina', 'european', 'french', 'german', 'italian', 'asian', 'american', 'amateur', 'new'];

const MONUMENTS = [
  { id: 'coliseo', name: 'Coliseo, Roma', lat: 41.8902, lon: 12.4922, yt: 'colosseum+rome+live' },
  { id: 'eiffel', name: 'Torre Eiffel, París', lat: 48.8584, lon: 2.2945, yt: 'eiffel+tower+live' },
  { id: 'sagrada', name: 'Sagrada Familia, Barcelona', lat: 41.4036, lon: 2.1744, yt: 'sagrada+familia+live' },
  { id: 'alhambra', name: 'Alhambra, Granada', lat: 37.176, lon: -3.5975, yt: 'alhambra+granada+live' },
  { id: 'bigben', name: 'Big Ben, Londres', lat: 51.5007, lon: -0.1246, yt: 'big+ben+london+live' },
  { id: 'libertad', name: 'Estatua de la Libertad, NY', lat: 40.6892, lon: -74.0445, yt: 'statue+of+liberty+live' },
  { id: 'times', name: 'Times Square, NY', lat: 40.758, lon: -73.9855, yt: 'times+square+live' },
  { id: 'citywalk', name: 'Universal CityWalk, Orlando', lat: 28.4739, lon: -81.4642, yt: 'universal+orlando+live' },
  { id: 'iconpark', name: 'ICON Park, Orlando', lat: 28.4433, lon: -81.4709, yt: 'icon+park+orlando+live' },
  { id: 'magickingdom', name: 'Magic Kingdom, Orlando', lat: 28.4177, lon: -81.5812, yt: 'magic+kingdom+live+webcam' },
];

const HACK_TWITCH = [
  { id: 'tw-nahamsec', label: 'NahamSec', channel: 'nahamsec' },
  { id: 'tw-john', label: 'John Hammond', channel: 'john_hammond' },
];

const HACK_YT_SEARCHES = [
  { label: 'Bug bounty en directo', q: 'bug+bounty+live' },
  { label: 'Hacking en directo', q: 'hacking+live' },
  { label: 'John Hammond live', q: 'john+hammond+live' },
  { label: 'NahamSec live', q: 'nahamsec+live' },
  { label: 'LiveOverflow live', q: 'liveoverflow+live' },
  { label: 'Universal Orlando live', q: 'universal+orlando+live' },
  { label: 'Harry Potter World live', q: 'wizarding+world+harry+potter+live' },
];

function adultSearchUrl(platformId, tag) {
  const q = encodeURIComponent(tag);
  switch (platformId) {
    case 'chaturbate': return `https://chaturbate.com/tag/${q}/`;
    case 'stripchat': return `https://stripchat.com/search?q=${q}`;
    case 'bongacams': return `https://www.bongacams.com/search?query=${q}`;
    case 'cam4': return `https://www.cam4.com/search?q=${q}`;
    case 'mfc': return 'https://www.myfreecams.com/mfc:model/search';
    default: return null;
  }
}

const DOT_SOURCES = [
  { id: 'ny511', label: '511NY — Nueva York (HLS)' },
  { id: 'caltrans', label: 'Caltrans — California' },
  { id: 'dgt', label: 'DGT — España' },
  { id: 'tfl', label: 'TfL — Londres' },
  { id: 'digitraffic', label: 'Digitraffic — Finlandia' },
  { id: 'vegagerdin', label: 'Vegagerðin — Islandia' },
  { id: 'madrid', label: 'Madrid CCTV' },
];

const SELECT_STYLE = {
  padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11, fontFamily: 'monospace',
};

function proxiedHls(raw) {
  return `/api/cameras/public/hls?url=${encodeURIComponent(raw)}`;
}
function proxiedHlsCustom(raw) {
  return `/api/cameras/public/hls-custom?url=${encodeURIComponent(raw)}`;
}
function proxiedImg(raw, stream = false) {
  return `/api/cameras/media/img?url=${encodeURIComponent(raw)}${stream ? '&stream=1' : ''}`;
}

export default function LiveCams({ api }) {
  const [tab, setTab] = useState('live');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feeds, setFeeds] = useState([]);
  const [dotSource, setDotSource] = useState('ny511');
  const [dotCams, setDotCams] = useState([]);
  const [dotTotal, setDotTotal] = useState(0);
  const [dotQuery, setDotQuery] = useState('');
  const [directories, setDirectories] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  // La verificación 18+ se pide SIEMPRE al entrar en la pestaña (no se recuerda).
  const [adultOk, setAdultOk] = useState(false);
  const [selected, setSelected] = useState(null);
  const [customUrl, setCustomUrl] = useState('');
  const [customPlay, setCustomPlay] = useState(null);
  const [nasa, setNasa] = useState({ epic: null, iss: null, err: '' });
  const [center, setCenter] = useState(null);
  const [radius, setRadius] = useState(100);
  const [coordsInput, setCoordsInput] = useState('');
  const [geoState, setGeoState] = useState('idle');
  const [adultTag, setAdultTag] = useState('spanish');
  const [sky, setSky] = useState({ flights: [], fTotal: 0, fTime: null, sats: [], sun: null, planets: [] });
  const [monument, setMonument] = useState(MONUMENTS[0]);
  const [monCams, setMonCams] = useState([]);
  const [monTotal, setMonTotal] = useState(0);
  const [twitchChan, setTwitchChan] = useState('');
  const [twitchPlay, setTwitchPlay] = useState(null);

  const loadLive = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [f, ny, ca] = await Promise.all([
        api('/live/feeds'),
        api('/cameras/public?source=ny511&limit=6'),
        api('/cameras/public?source=caltrans&limit=6'),
      ]);
      const list = [];
      (f.feeds || []).forEach((x) => list.push({ ...x, play: { kind: 'hls', src: x.proxy } }));
      (ny.cameras || []).forEach((c) => list.push({
        id: `ny511:${c.id}`, name: c.name, country: c.country || 'US', city: 'Nueva York',
        category: 'traffic', source: 'ny511',
        play: c.hls ? { kind: 'hls', src: c.hls } : { kind: 'img', src: `${c.snapshot}&t=0` },
        snapshot: c.snapshot, road: c.road,
      }));
      (ca.cameras || []).forEach((c) => list.push({
        id: `caltrans:${c.id}`, name: c.name, country: c.country || 'US', city: 'California',
        category: 'traffic', source: 'caltrans',
        play: { kind: 'img', src: `${c.snapshot}&t=0` },
        snapshot: c.snapshot, road: c.road,
      }));
      setFeeds(list);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [api]);

  const loadExplore = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ source: dotSource, limit: '12' });
      if (dotQuery) params.set('q', dotQuery);
      const r = await api(`/cameras/public?${params.toString()}`);
      if (!r.ok) { setError(r.error || 'fuente no disponible'); setDotCams([]); }
      else { setDotCams(r.cameras || []); setDotTotal(r.total || 0); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [api, dotSource, dotQuery]);

  const loadCommunity = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [d, p, s] = await Promise.all([api('/live/directories'), api('/live/platforms'), api('/live/suggestions')]);
      setDirectories(d.directories || []);
      setPlatforms(p.platforms || []);
      setSuggestions(s.suggestions || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [api]);

  const loadNasa = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [epic, iss] = await Promise.all([api('/live/nasa-epic'), api('/live/iss-now')]);
      setNasa({ epic: epic.ok ? epic : null, iss: iss.ok ? iss : null, err: epic.ok ? '' : (epic.error || '') });
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [api]);

  const loadSky = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const c = center || { lat: 40.4, lon: -3.7 };
      const dLat = 4.5; const dLon = 7;
      const q = new URLSearchParams({
        lamin: String(c.lat - dLat), lomin: String(c.lon - dLon),
        lamax: String(c.lat + dLat), lomax: String(c.lon + dLon),
      });
      const [f, sats, sun, pl] = await Promise.all([
        api(`/sky/flights?${q.toString()}`),
        api('/sky/sats'),
        api('/sky/sun'),
        api('/sky/planets'),
      ]);
      setSky({
        flights: (f.flights || []).map((x) => ({
          ...x,
          distanceKm: Math.round(haversineKm(c.lat, c.lon, x.lat, x.lon) * 10) / 10,
        })).sort((a, b) => a.distanceKm - b.distanceKm),
        fTotal: f.total || 0, fTime: f.time || null,
        sats: sats.sats || [], sun: sun.ok ? sun : null,
        planets: pl.planets || [],
      });
      if (!f.ok) setError(f.error || '');
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [api, center]);

  const loadMonument = useCallback(async (m = monument) => {
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams({ source: 'windy', lat: String(m.lat), lon: String(m.lon), radius: '30', limit: '12' });
      const r = await api(`/cameras/public?${q.toString()}`);
      if (!r.ok) { setError(r.error || 'Sin cámaras aquí'); setMonCams([]); }
      else { setMonCams(r.cameras || []); setMonTotal(r.total || 0); }
    } catch (e) { setError(e.message); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    if (tab === 'live') loadLive();
    else if (tab === 'explore') loadExplore();
    else if (tab === 'nasa') loadNasa();
    else if (tab === 'cielo') loadSky();
    else if (tab === 'monumentos') loadMonument();
    else if (tab === 'community' || tab === 'adult') loadCommunity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Refresco de la posición ISS cada 30 s mientras la pestaña NASA está activa.
  useEffect(() => {
    if (tab !== 'nasa') return undefined;
    const id = setInterval(async () => {
      try {
        const iss = await api('/live/iss-now');
        if (iss.ok) setNasa((p) => ({ ...p, iss }));
      } catch {}
    }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoState('error'); return; }
    setGeoState('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState('ok');
        setCenter({ lat: Number(pos.coords.latitude.toFixed(4)), lon: Number(pos.coords.longitude.toFixed(4)) });
      },
      () => setGeoState('error'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  };

  const applyManualCoords = () => {
    const m = coordsInput.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) { setGeoState('error'); return; }
    const lat = Number(m[1]); const lon = Number(m[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { setGeoState('error'); return; }
    setGeoState('ok');
    setCenter({ lat, lon });
    setCoordsInput('');
  };

  // Explorar con cercanía: filtra por radio y ordena por distancia.
  const nearbyCams = useMemo(() => {
    if (!center) return dotCams;
    return dotCams
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
      .map((c) => ({ ...c, distanceKm: Math.round(haversineKm(center.lat, center.lon, c.lat, c.lon) * 10) / 10 }))
      .filter((c) => c.distanceKm <= radius)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [dotCams, center, radius]);

function pinHash(pin) {
  // Disuasorio local, no seguridad real: djb2 hex del PIN.
  let h = 5381;
  for (let i = 0; i < pin.length; i++) h = ((h << 5) + h + pin.charCodeAt(i)) >>> 0;
  return `djb2-${h.toString(16)}`;
}

function PinGate({ onOk }) {
  const [step, setStep] = useState('age');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState('');
  const stored = (() => { try { return localStorage.getItem('knk_pin') || ''; } catch { return ''; } })();
  const clean = (v) => v.replace(/\D/g, '').slice(0, 4);

  const submit = () => {
    setErr('');
    if (!stored) {
      if (pin.length !== 4) { setErr('El PIN son 4 dígitos.'); return; }
      if (pin !== pin2) { setErr('No coinciden. Repite el PIN.'); return; }
      try { localStorage.setItem('knk_pin', pinHash(pin)); } catch {}
      onOk();
    } else {
      if (pinHash(pin) === stored) onOk();
      else setErr('PIN incorrecto.');
    }
  };

  if (step === 'age') {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 32 }}>🔞</div>
        <h3 style={{ color: 'var(--yellow)', fontSize: 14 }}>Zona 18+ — confirmación requerida</h3>
        <p style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 520, margin: '8px auto' }}>
          Salas públicas en directo: miniaturas live + vídeo a petición (Chaturbate, API pública),
          resto de plataformas como fichas externas. Este módulo nunca toca redes privadas.
        </p>
        <button className="btn btn-sm" onClick={() => { setStep('pin'); setErr(''); setPin(''); setPin2(''); }}>
          Tengo 18+ y quiero ver el listado
        </button>
      </div>
    );
  }
  return (
    <div style={{ padding: 20, textAlign: 'center', maxWidth: 340, margin: '0 auto' }}>
      <div style={{ fontSize: 28 }}>🔑</div>
      <h3 style={{ color: 'var(--primary)', fontSize: 13 }}>{stored ? 'Introduce tu PIN' : 'Crea tu PIN (4 dígitos)'}</h3>
      <input value={pin} onChange={(e) => setPin(clean(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="••••" inputMode="numeric" type="password" autoFocus
        style={{ textAlign: 'center', fontSize: 20, letterSpacing: 8, padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', width: '100%', marginTop: 8 }} />
      {!stored && (
        <input value={pin2} onChange={(e) => setPin2(clean(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="repite ••••" inputMode="numeric" type="password"
          style={{ textAlign: 'center', fontSize: 20, letterSpacing: 8, padding: '8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', width: '100%', marginTop: 8 }} />
      )}
      {err && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
        <button className="btn btn-sm btn-outline" onClick={() => setStep('age')}>← Atrás</button>
        <button className="btn btn-sm" onClick={submit}>Entrar</button>
      </div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 8 }}>Se pide siempre al entrar. Solo vive en este equipo.</div>
    </div>
  );
}

  const playCustom = () => {
    const u = customUrl.trim();
    if (!u) return;
    if (/\.m3u8($|\?)/i.test(u)) {
      setCustomPlay({ kind: 'hls', src: proxiedHlsCustom(u), raw: u });
    } else if (/\.(mjpg|mjpeg|mjpeg)($|\?)|\/mjpg|\/mjpeg|\/video\.cgi/i.test(u)) {
      setCustomPlay({ kind: 'mjpeg', src: proxiedImg(u, true), raw: u });
    } else {
      setCustomPlay({ kind: 'img', src: proxiedImg(u, false), raw: u });
    }
  };

  return (
    <div style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>📡</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontFamily: "'Courier New', monospace" }}>EN DIRECTO</h2>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>Vídeo real en cada tarjeta — HLS/MJPEG por el proxy local, sin abrir el CSP</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setError(''); setSelected(null); setAdultOk(false); }}
            style={{
              padding: '5px 10px', fontSize: 10, fontFamily: 'monospace',
              background: tab === t.id ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
              border: `1px solid ${tab === t.id ? 'var(--primary)' : 'var(--border)'}`,
              color: tab === t.id ? 'var(--primary)' : 'var(--muted)',
              borderRadius: 6, cursor: 'pointer',
            }}>
            {t.icon} {t.name}
          </button>
        ))}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,199,0,0.4)', background: 'rgba(255,199,0,0.08)' }}>
          <div style={{ fontSize: 12, color: 'var(--yellow)' }}>⚠️ {error}</div>
        </div>
      )}

      {tab === 'explore' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={dotSource} onChange={(e) => setDotSource(e.target.value)} style={SELECT_STYLE}>
              {DOT_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input value={dotQuery} onChange={(e) => setDotQuery(e.target.value)}
              placeholder="Filtrar (ej: I-95, Madrid…)" onKeyDown={(e) => { if (e.key === 'Enter') loadExplore(); }}
              style={{ flex: 1, minWidth: 180, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
            <button className="btn btn-sm" onClick={loadExplore} disabled={loading}>{loading ? '⏳' : '🔍 Buscar'}</button>
            {dotTotal > 0 && <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'monospace' }}>{dotTotal} cámaras</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={useMyLocation} title="Ordena y filtra por cercanía a tu posición">
              {geoState === 'asking' ? '📡 Localizando…' : '📍 Cerca de mí'}
            </button>
            {center && (
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} style={SELECT_STYLE}>
                {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} km</option>)}
              </select>
            )}
            <input value={coordsInput} onChange={(e) => setCoordsInput(e.target.value)}
              placeholder="o coordenadas: 36.7213, -4.4213"
              onKeyDown={(e) => { if (e.key === 'Enter') applyManualCoords(); }}
              style={{ width: 200, padding: '4px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 10, fontFamily: 'monospace' }} />
            <button className="btn btn-sm btn-outline" onClick={applyManualCoords} disabled={!coordsInput}>◎ Usar</button>
            {center && (
              <span style={{ fontSize: 10, color: 'var(--primary)', fontFamily: 'monospace' }}>
                ◎ {center.lat}, {center.lon} · {nearbyCams.length} en {radius} km
                <button onClick={() => setCenter(null)} style={{ marginLeft: 6, fontSize: 9, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>✕ quitar</button>
              </span>
            )}
            {geoState === 'error' && <span style={{ fontSize: 10, color: 'var(--yellow)' }}>⚠️ Ubicación no disponible — escribe las coordenadas</span>}
          </div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 24 }}>⏳</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Cargando vídeo…</div>
        </div>
      )}

      {!loading && tab === 'live' && (
        <>
          {selected && <LiveDetail item={selected} onClose={() => setSelected(null)} />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {feeds.map((f) => <LiveCard key={f.id} item={f} onOpen={() => setSelected(f)} />)}
          </div>
        </>
      )}

      {!loading && tab === 'explore' && (
        <>
          {selected && <LiveDetail item={dotToLive(selected)} onClose={() => setSelected(null)} />}
          {center && nearbyCams.length === 0 && (
            <div className="card" style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
              Sin cámaras en {radius} km — amplía el radio o quita el filtro de cercanía.
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {nearbyCams.map((c) => <LiveCard key={`${c.source}:${c.id}`} item={dotToLive(c)} onOpen={() => setSelected(c)} />)}
          </div>
        </>
      )}

      {!loading && tab === 'nasa' && <NasaTab nasa={nasa} />}

      {!loading && tab === 'cielo' && <SkyTab sky={sky} center={center} onLocate={useMyLocation} geoState={geoState} />}

      {tab === 'monumentos' && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MONUMENTS.map((m) => (
                <button key={m.id} onClick={() => { setMonument(m); loadMonument(m); }}
                  style={{ padding: '4px 10px', fontSize: 10, fontFamily: 'monospace', borderRadius: 6, cursor: 'pointer',
                    background: monument.id === m.id ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
                    border: `1px solid ${monument.id === m.id ? 'var(--primary)' : 'var(--border)'}`,
                    color: monument.id === m.id ? 'var(--primary)' : 'var(--muted)' }}>
                  {m.name}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 8 }}>
              Webcams Windy cercanas (30 km) con foto + timelapse. Sin cámaras oficiales dentro de atracciones:
              para ride POVs usa los directos de YouTube ↓. {monTotal > 0 && <span style={{ color: 'var(--green)' }}>{monTotal} cámaras</span>}
            </div>
          </div>
          {loading && <div className="card" style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>⏳ Buscando webcams…</div>}
          {!loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {monCams.map((c) => (
                <div key={`${c.source}:${c.id}`} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <img src={`${c.snapshot}&t=0`} alt={c.name} style={{ width: '100%', height: 180, objectFit: 'cover', background: '#000', display: 'block' }} loading="lazy" />
                  <div style={{ padding: '6px 8px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                      {c.city}{c.distanceKm != null ? ` · ◎ ${c.distanceKm} km` : ''}
                      {c.timelapse && <span> · <a href={c.timelapse} target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>🎞 timelapse</a></span>}
                    </div>
                  </div>
                </div>
              ))}
              {!monCams.length && <div className="card" style={{ padding: 16, fontSize: 11, color: 'var(--muted)' }}>Sin webcams Windy aquí. Prueba con otro monumento.</div>}
            </div>
          )}
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>▶ Directos de la zona (YouTube, externo)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="btn btn-sm" href={`https://www.youtube.com/results?search_query=${monument.yt}`} target="_blank" rel="noopener">🔎 {monument.name} en directo</a>
              {HACK_YT_SEARCHES.slice(5).map((s) => (
                <a key={s.label} className="btn btn-sm btn-outline" href={`https://www.youtube.com/results?search_query=${s.q}`} target="_blank" rel="noopener">{s.label}</a>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'hacking' && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 6 }}>💻 Hacking / bug bounty en directo (Twitch)</h3>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
              Escribe un canal. Si está emitiendo lo verás aquí; si no, el player muestra su canal igualmente.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <input value={twitchChan} onChange={(e) => setTwitchChan(e.target.value)}
                placeholder="canal twitch (ej: nahamsec)"
                onKeyDown={(e) => { if (e.key === 'Enter' && twitchChan.trim()) setTwitchPlay(twitchChan.trim().toLowerCase()); }}
                style={{ flex: 1, minWidth: 200, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
              <button className="btn btn-sm" onClick={() => twitchChan.trim() && setTwitchPlay(twitchChan.trim().toLowerCase())} disabled={!twitchChan.trim()}>▶ Ver</button>
              {HACK_TWITCH.map((t) => (
                <button key={t.id} className="btn btn-sm btn-outline" onClick={() => { setTwitchChan(t.channel); setTwitchPlay(t.channel); }}>{t.label}</button>
              ))}
            </div>
            {twitchPlay && (
              <div>
                <iframe src={`https://player.twitch.tv/?channel=${encodeURIComponent(twitchPlay)}&parent=127.0.0.1&muted=true`}
                  title={`Twitch ${twitchPlay}`} allowFullScreen
                  style={{ width: '100%', height: 380, border: '1px solid var(--border)', borderRadius: 6, background: '#000' }} />
                <div style={{ marginTop: 6 }}>
                  <a href={`https://www.twitch.tv/${encodeURIComponent(twitchPlay)}`} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'var(--green)' }}>🔗 Abrir en Twitch</a>
                </div>
              </div>
            )}
          </div>
          <YTLive api={api} />
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>▶ Directos hacking en YouTube (externo)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {HACK_YT_SEARCHES.slice(0, 5).map((s) => (
                <a key={s.label} className="btn btn-sm btn-outline" href={`https://www.youtube.com/results?search_query=${s.q}+live`} target="_blank" rel="noopener">{s.label}</a>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && tab === 'community' && (
        <div className="card">
          <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🌐 Directorios comunitarios (SFW)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {directories.map((d) => (
              <div key={d.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 4 }}>{d.name}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>{d.note}</div>
                <a href={d.url} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'var(--green)' }}>🔗 Abrir {d.url.replace('https://', '').replace('http://', '').split('/')[0]}</a>
              </div>
            ))}
          </div>
          <h3 style={{ color: 'var(--primary)', fontSize: 14, margin: '16px 0 8px' }}>💡 Sugerido para ampliar</h3>
          {suggestions.map((s) => (
            <div key={s.id} style={{ fontSize: 10, marginBottom: 4 }}>
              <span style={{ color: 'var(--green)' }}>＋ {s.title}</span>
              <span style={{ color: 'var(--muted)' }}> — {s.why} ({s.cost})</span>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'adult' && (
        <div className="card">
          {!adultOk ? (
            <PinGate onOk={() => setAdultOk(true)} />
          ) : (
            <AdultLive api={api} platforms={platforms} adultTag={adultTag} setAdultTag={setAdultTag} />
          )}
        </div>
      )}

      {!loading && tab === 'custom' && (
        <div className="card">
          <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔗 Reproducir URL pública</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://…/stream.m3u8  ·  https://…/video.mjpg  ·  https://…/foto.jpg"
              onKeyDown={(e) => { if (e.key === 'Enter') playCustom(); }}
              style={{ flex: 1, minWidth: 240, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, fontFamily: 'monospace' }} />
            <button className="btn btn-sm" onClick={playCustom} disabled={!customUrl.trim()}>▶ Reproducir</button>
          </div>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 10 }}>Solo hosts públicos (se bloquean RFC1918, localhost y metadata cloud).</div>
          {customPlay && (
            <div>
              {customPlay.kind === 'hls' && <HLSPlayer src={customPlay.src} rawUrl={customPlay.raw} width="100%" height={340} autoPlay muted showCheck logCtx={{ view: 'custom', label: (customPlay.raw || '').slice(0, 60) }} />}
              {customPlay.kind === 'mjpeg' && <img src={customPlay.src} alt="MJPEG" style={{ width: '100%', maxHeight: 340, objectFit: 'contain', background: '#000', borderRadius: 6 }} />}
              {customPlay.kind === 'img' && <img src={customPlay.src} alt="snapshot" style={{ width: '100%', maxHeight: 340, objectFit: 'contain', background: '#000', borderRadius: 6 }} />}
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 12, padding: 8, background: 'rgba(8,216,255,0.05)', borderRadius: 6, fontFamily: 'monospace' }}>
        ⚖️ Solo fuentes públicas. El vídeo/imagen siempre pasa por el proxy local del workbench.
      </div>
    </div>
  );
}

function SkyTab({ sky, center, onLocate, geoState }) {
  const { flights, fTotal, sats, sun, planets } = sky;
  const proj = (lat, lon) => ({ x: ((lon + 180) / 360) * 360, y: ((90 - lat) / 180) * 180 });
  const c = center || { lat: 40.4, lon: -3.7 };
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ color: 'var(--primary)', fontSize: 14, margin: 0 }}>🛩️ Vuelos ADS-B en directo — {fTotal} en zona</h3>
          <button className="btn btn-sm btn-outline" onClick={onLocate}>
            {geoState === 'asking' ? '📡 Localizando…' : '📍 Centrar en mí'}
          </button>
        </div>
        <svg viewBox="0 0 360 180" style={{ width: '100%', aspectRatio: '2 / 1', display: 'block', background: '#05070c', border: '1px solid var(--border)', borderRadius: 6 }}>
          <g stroke="rgba(8,216,255,0.10)" strokeWidth="0.4">
            {Array.from({ length: 11 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 18} x2="360" y2={i * 18} />)}
            {Array.from({ length: 19 }, (_, i) => <line key={`v${i}`} x1={i * 20} y1="0" x2={i * 20} y2="180" />)}
          </g>
          {flights.slice(0, 120).map((f) => {
            const p = proj(f.lat, f.lon);
            return (
              <g key={f.icao24} transform={`translate(${p.x},${p.y}) rotate(${f.heading || 0})`}>
                <title>{`${f.callsign || f.icao24} · ${f.country} · ${f.altM != null ? Math.round(f.altM) + ' m' : 'sin alt'} · ${f.distanceKm} km`}</title>
                <path d="M0,-4 L3,3 L0,1.5 L-3,3 Z" fill={f.onGround ? 'var(--muted)' : 'var(--primary)'} opacity="0.9" />
              </g>
            );
          })}
          {(() => { const p = proj(c.lat, c.lon); return (
            <g>
              <circle cx={p.x} cy={p.y} r="5" fill="none" stroke="#ff4dd2" strokeWidth="1.2" />
              <circle cx={p.x} cy={p.y} r="1.8" fill="#ff4dd2" />
            </g>
          ); })()}
        </svg>
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4 }}>OpenSky (anónimo, caché 75 s) · centro {c.lat}, {c.lon}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginTop: 8 }}>
          {flights.slice(0, 12).map((f) => (
            <div key={f.icao24} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 6, fontSize: 10, fontFamily: 'monospace' }}>
              <div style={{ fontWeight: 700, color: 'var(--primary)' }}>✈ {f.callsign || f.icao24}</div>
              <div style={{ color: 'var(--muted)' }}>{f.country} · ◎ {f.distanceKm} km{f.altM != null && ` · ${Math.round(f.altM / 30.48) * 100} ft`}{f.velMs != null && ` · ${Math.round(f.velMs * 1.944)} kt`}</div>
            </div>
          ))}
          {!flights.length && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sin vuelos en la zona ahora mismo.</div>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🛰️ Satélites (TLE + SGP4 local)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
          {sats.map((s) => (
            <div key={s.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 10, fontFamily: 'monospace' }}>
              <div style={{ fontWeight: 700, color: 'var(--green)' }}>🛰️ {s.name}</div>
              <div style={{ color: 'var(--muted)' }}>{s.category} · NORAD {s.id}</div>
              {s.ok
                ? <div>lat {s.lat} · lon {s.lon}<br />alt {s.altKm} km</div>
                : <div style={{ color: 'var(--yellow)' }}>sin TLE ({s.error || '?'})</div>}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>CelesTrak (caché 6 h) · posiciones calculadas en tu máquina, sin clave.</div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>☀️ Sol ahora (SWPC/NOAA)</h3>
        {sun ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, fontFamily: 'monospace' }}>
            <span>Flujo X: <b style={{ color: 'var(--yellow)' }}>{sun.classNow}</b></span>
            <span style={{ color: 'var(--muted)' }}>{sun.fluxNow != null ? sun.fluxNow.toExponential(1) + ' W/m²' : ''}</span>
            {sun.scales && <span style={{ color: 'var(--muted)' }}>R{minScale(sun.scales)} S{minScale(sun.scales, 'S')} G{minScale(sun.scales, 'G')}</span>}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sin datos solares ahora mismo.</div>
        )}
      </div>

      <div className="card">
        <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🪐 Sistema solar</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
          {planets.map((p) => (
            <div key={p.name} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 10 }}>
              <div style={{ fontWeight: 700 }}><span style={{ color: p.color }}>●</span> {p.name}</div>
              <div style={{ color: 'var(--muted)', fontFamily: 'monospace' }}>{p.distAU} UA · {p.diameterKm.toLocaleString('es')} km<br />año {p.yearD} d · 🌙 {p.moons}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function minScale(scales, prefix = 'R') {
  try {
    const k = Object.keys(scales).find((x) => x.startsWith(prefix));
    return k ? scales[k].Scale || '0' : '0';
  } catch { return '0'; }
}

const GENDER_FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'f', label: 'Mujeres' },
  { id: 'm', label: 'Hombres' },
  { id: 'c', label: 'Parejas' },
  { id: 't', label: 'Trans' },
];

// Salas públicas en directo: miniaturas live (refresco 25 s, como las de
// tráfico) + vídeo HLS a petición + ficha externa. Sin scraping agresivo:
// el listado se cachea 90 s en el backend y el HLS se pide por sala.
function AdultLive({ api, platforms, adultTag, setAdultTag }) {
  const [rooms, setRooms] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [roomsError, setRoomsError] = useState('');
  const [gender, setGender] = useState('all');
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(null); // {user,title,viewers,src}
  const [playingError, setPlayingError] = useState('');
  const [loadingVideo, setLoadingVideo] = useState(null);
  const [favs, setFavs] = useState(() => { try { return JSON.parse(localStorage.getItem('knk_favs') || '[]'); } catch { return []; } });
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [sortBy, setSortBy] = useState('viewers');
  const [autoRef, setAutoRef] = useState(true);
  const [mosaic, setMosaic] = useState([]);
  const [hist, setHist] = useState(() => { try { return JSON.parse(localStorage.getItem('knk_hist') || '[]'); } catch { return []; } });
  const [onlyHist, setOnlyHist] = useState(false);

  const toggleFav = (user) => {
    setFavs((prev) => {
      const next = prev.includes(user) ? prev.filter((u) => u !== user) : [...prev, user];
      try { localStorage.setItem('knk_favs', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const loadRooms = useCallback(async (g = gender, silent = false) => {
    if (!silent) setLoadingRooms(true);
    setRoomsError('');
    try {
      const r = await api(`/live/adult/rooms?platform=chaturbate&limit=100&gender=${g}`);
      if (!r.ok) setRoomsError(r.error || 'Sin salas ahora mismo');
      else { setRooms(r.rooms || []); setTotal(r.total || 0); }
    } catch (e) { if (!silent) setRoomsError(e.message); }
    setLoadingRooms(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  // Auto-refresh silencioso cada 90 s (respeta la caché del backend).
  useEffect(() => {
    if (!autoRef) return undefined;
    const id = setInterval(() => loadRooms(gender, true), 90000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRef, gender]);

  const pickGender = (g) => { setGender(g); setQuery(''); loadRooms(g); };
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 25000);
    return () => clearInterval(id);
  }, []);

  const pushHist = (user) => {
    setHist((prev) => {
      const next = [user, ...prev.filter((u) => u !== user)].slice(0, 24);
      try { localStorage.setItem('knk_hist', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rooms.filter((r) => {
      if (onlyFavs && !favs.includes(r.user)) return false;
      if (onlyHist && !hist.includes(r.user)) return false;
      if (gender !== 'all' && r.gender !== gender) return false;
      if (!q) return true;
      return `${r.user} ${r.subject} ${r.country || ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(q);
    });
    const byFav = (a, b) => (favs.includes(a.user) ? 0 : 1) - (favs.includes(b.user) ? 0 : 1);
    switch (sortBy) {
      case 'age-asc': return list.sort((a, b) => byFav(a, b) || (a.age || 99) - (b.age || 99));
      case 'age-desc': return list.sort((a, b) => byFav(a, b) || (b.age || 0) - (a.age || 0));
      case 'az': return list.sort((a, b) => byFav(a, b) || String(a.user).localeCompare(String(b.user)));
      case 'new': return list.sort((a, b) => byFav(a, b) || ((b.isNew ? 1 : 0) - (a.isNew ? 1 : 0)) || b.viewers - a.viewers);
      default: return list.sort((a, b) => byFav(a, b) || b.viewers - a.viewers);
    }
  }, [rooms, gender, query, onlyFavs, onlyHist, favs, hist, sortBy]);

  const playRoom = async (user) => {
    setLoadingVideo(user); setPlayingError(''); setPlaying(null);
    try {
      const r = await api(`/live/adult/hls?platform=chaturbate&user=${encodeURIComponent(user)}`);
      if (!r.ok) setPlayingError(`${r.error || 'Sin vídeo en esta sala'} (si cerró, ↻ Actualiza el listado)`);
      else {
        setPlaying({ user: r.user, title: r.title, viewers: r.viewers, src: r.proxy, raw: r.hls });
        pushHist(r.user);
      }
    } catch (e) { setPlayingError(e.message); }
    setLoadingVideo(null);
  };

  const toggleMosaic = async (user) => {
    if (mosaic.some((m) => m.user === user)) {
      setMosaic((prev) => prev.filter((m) => m.user !== user));
      return;
    }
    if (mosaic.length >= 4) return;
    try {
      const r = await api(`/live/adult/hls?platform=chaturbate&user=${encodeURIComponent(user)}`);
      if (r.ok) {
        setMosaic((prev) => (prev.length < 4 && !prev.some((m) => m.user === user)
          ? [...prev, { user: r.user, title: r.title, src: r.proxy, raw: r.hls }]
          : prev));
        pushHist(r.user);
      }
    } catch {}
  };

  // Renovación de token a petición del reproductor (una vez por reproducción).
  const renewPlaying = useCallback(async (user) => {
    try {
      const r = await api(`/live/adult/hls?platform=chaturbate&user=${encodeURIComponent(user)}`);
      if (r.ok) setPlaying((p) => (p && p.user === user ? { ...p, src: r.proxy, raw: r.hls } : p));
    } catch {}
  }, [api]);

  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 4 }}>
        🔴 En directo ahora — Chaturbate {total > 0 && <span style={{ color: 'var(--muted)' }}>({total} salas públicas)</span>}
      </h3>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 8 }}>
        Miniaturas en directo (refresco 25 s) · vídeo HLS a petición · listado cacheado 90 s para no saturar la fuente.
      </div>
      {playing && (
        <div style={{ marginBottom: 12, padding: 10, background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
              <span onClick={() => toggleFav(playing.user)} title="Favorito"
                style={{ cursor: 'pointer', marginRight: 6, color: favs.includes(playing.user) ? 'var(--yellow)' : 'var(--muted)' }}>
                {favs.includes(playing.user) ? '★' : '☆'}
              </span>
              ▶ {playing.user}{playing.viewers ? ` · 👁 ${playing.viewers}` : ''}
            </span>
            <span>
              <a href={`https://chaturbate.com/${playing.user}/`} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'var(--green)', marginRight: 8 }}>🔗 Ficha</a>
              <button className="btn btn-sm btn-outline" onClick={() => setPlaying(null)}>✕ Cerrar</button>
            </span>
          </div>
          <HLSPlayer src={playing.src} rawUrl={playing.raw} width="100%" height={360} autoPlay muted showCheck onExpired={() => renewPlaying(playing.user)} deniedHint="Puede estar en privado o ticket: prueba con otra sala." poster={`/api/cameras/media/img?url=${encodeURIComponent(`https://thumb.live.mmcdn.com/riw/${playing.user}.jpg`)}`} logCtx={{ view: 'adult', label: playing.user }} />
          {playing.title && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>{playing.title}</div>}
        </div>
      )}
      {playingError && <div style={{ fontSize: 11, color: 'var(--yellow)', marginBottom: 8 }}>⚠️ {playingError}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        {GENDER_FILTERS.map((g) => (
          <button key={g.id} onClick={() => pickGender(g.id)}
            style={{ padding: '3px 9px', fontSize: 10, fontFamily: 'monospace', borderRadius: 5, cursor: 'pointer',
              background: gender === g.id ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
              border: `1px solid ${gender === g.id ? 'var(--primary)' : 'var(--border)'}`,
              color: gender === g.id ? 'var(--primary)' : 'var(--muted)' }}>
            {g.label}
          </button>
        ))}
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrar por tag, país o nombre…"
          style={{ flex: 1, minWidth: 160, padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 10 }} />
        <button className="btn btn-sm btn-outline" onClick={() => loadRooms()} disabled={loadingRooms}>{loadingRooms ? '⏳' : '↻ Actualizar'}</button>
        <button onClick={() => setAutoRef((v) => !v)} title="Recarga el listado solo cada 90 s"
          style={{ padding: '3px 9px', fontSize: 10, fontFamily: 'monospace', borderRadius: 5, cursor: 'pointer',
            background: autoRef ? 'rgba(63,185,80,0.15)' : 'var(--panel)',
            border: `1px solid ${autoRef ? 'var(--green)' : 'var(--border)'}`,
            color: autoRef ? 'var(--green)' : 'var(--muted)' }}>
          {autoRef ? '↻ auto 90s' : '↻ auto off'}
        </button>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} title="Orden"
          style={{ padding: '3px 6px', fontSize: 10, fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 5, cursor: 'pointer' }}>
          <option value="viewers">👁 viewers</option>
          <option value="age-asc">🎂 menor edad</option>
          <option value="age-desc">🎂 mayor edad</option>
          <option value="az">🔤 A–Z</option>
          <option value="new">✨ nuevas</option>
        </select>
        <button onClick={() => setOnlyFavs((v) => !v)}
          style={{ padding: '3px 9px', fontSize: 10, fontFamily: 'monospace', borderRadius: 5, cursor: 'pointer',
            background: onlyFavs ? 'rgba(255,199,0,0.15)' : 'var(--panel)',
            border: `1px solid ${onlyFavs ? 'var(--yellow)' : 'var(--border)'}`,
            color: onlyFavs ? 'var(--yellow)' : 'var(--muted)' }}>
          ★ Favoritos{favs.length ? ` (${favs.length})` : ''}
        </button>
        <button onClick={() => setOnlyHist((v) => !v)}
          style={{ padding: '3px 9px', fontSize: 10, fontFamily: 'monospace', borderRadius: 5, cursor: 'pointer',
            background: onlyHist ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
            border: `1px solid ${onlyHist ? 'var(--primary)' : 'var(--border)'}`,
            color: onlyHist ? 'var(--primary)' : 'var(--muted)' }}>
          🕘 Vistos{hist.length ? ` (${hist.length})` : ''}
        </button>
      </div>
      {mosaic.length > 0 && (
        <div style={{ marginBottom: 12, padding: 8, background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>⬛ Mosaico ({mosaic.length}/4, todos silenciados)</span>
            <button className="btn btn-sm btn-outline" onClick={() => setMosaic([])}>✕ Cerrar mosaico</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
            {mosaic.map((m) => (
              <div key={m.user} style={{ position: 'relative' }}>
                <HLSPlayer src={m.src} rawUrl={m.raw} width="100%" height={200} autoPlay muted
                  poster={`/api/cameras/media/img?url=${encodeURIComponent(`https://thumb.live.mmcdn.com/riw/${m.user}.jpg`)}`}
                  logCtx={{ view: 'mosaic', label: m.user }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700 }}>{m.user}</span>
                  <button onClick={() => toggleMosaic(m.user)} style={{ fontSize: 9, background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}>✕ quitar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {loadingRooms && <div style={{ fontSize: 11, color: 'var(--muted)' }}>⏳ Cargando salas…</div>}
      {roomsError && !loadingRooms && <div style={{ fontSize: 11, color: 'var(--yellow)' }}>⚠️ {roomsError}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {visible.map((r) => (
          <div key={r.user} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <img src={`/api/cameras/media/img?url=${encodeURIComponent(`${r.thumb}?t=${tick}`)}`} alt={r.user}
              style={{ width: '100%', height: 140, objectFit: 'cover', background: '#000', display: 'block' }}
              loading="lazy" />
            <div style={{ padding: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>
                  <span onClick={(e) => { e.stopPropagation(); toggleFav(r.user); }} title={favs.includes(r.user) ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                    style={{ cursor: 'pointer', marginRight: 4, color: favs.includes(r.user) ? 'var(--yellow)' : 'var(--muted)' }}>
                    {favs.includes(r.user) ? '★' : '☆'}
                  </span>
                  {r.user}
                </span>
                <span style={{ fontSize: 9, color: 'var(--muted)' }}>👁 {r.viewers}{r.age ? ` · ${r.age}` : ''}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.subject}>
                {r.subject || (r.tags || []).slice(0, 4).map((t) => `#${t}`).join(' ')}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn btn-sm" style={{ padding: '1px 8px', fontSize: 9 }} disabled={loadingVideo === r.user}
                  onClick={() => playRoom(r.user)}>
                  {loadingVideo === r.user ? '⏳' : '▶ Ver'}
                </button>
                <button className="btn btn-sm btn-outline" style={{ padding: '1px 8px', fontSize: 9 }}
                  title={mosaic.some((m) => m.user === r.user) ? 'Quitar del mosaico' : 'Añadir al mosaico (máx 4)'}
                  onClick={() => toggleMosaic(r.user)}>
                  {mosaic.some((m) => m.user === r.user) ? '⬛✓' : '⬛+'}
                </button>
                <a href={r.roomUrl} target="_blank" rel="noopener" style={{ fontSize: 9, color: 'var(--green)', alignSelf: 'center' }}>🔗 Ficha</a>
              </div>
            </div>
          </div>
        ))}
      </div>
      {!loadingRooms && !visible.length && !roomsError && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Sin resultados para este filtro.</div>
      )}

      <h3 style={{ color: 'var(--primary)', fontSize: 13, margin: '18px 0 6px' }}>🌐 Otras plataformas (fichas externas)</h3>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>
        Sin API pública estable: búsqueda por idioma/región con tags. Elige un tag:
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input value={adultTag} onChange={(e) => setAdultTag(e.target.value)}
          placeholder="tag o región (ej: spanish, latina…)"
          style={{ width: 220, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
        {ADULT_TAGS.map((t) => (
          <button key={t} onClick={() => setAdultTag(t)}
            style={{ padding: '3px 8px', fontSize: 9, fontFamily: 'monospace', borderRadius: 5, cursor: 'pointer',
              background: adultTag === t ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
              border: `1px solid ${adultTag === t ? 'var(--primary)' : 'var(--border)'}`,
              color: adultTag === t ? 'var(--primary)' : 'var(--muted)' }}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {platforms.filter((p) => p.id !== 'chaturbate').map((p) => {
          const tagUrl = adultTag.trim() ? adultSearchUrl(p.id, adultTag.trim()) : null;
          return (
            <div key={p.id} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>{p.note}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a href={p.url} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'var(--green)' }}>🔗 Portada</a>
                {tagUrl && <a href={tagUrl} target="_blank" rel="noopener" style={{ fontSize: 10, color: 'var(--primary)' }}>🔎 «{adultTag.trim()}»</a>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YTLive({ api }) {
  const [q, setQ] = useState('bug bounty');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const search = async () => {
    setLoading(true);
    try {
      const r = await api(`/live/youtube?q=${encodeURIComponent(q)}`);
      setData(r);
    } catch { setData({ ok: false, error: 'sin respuesta' }); }
    setLoading(false);
  };

  useEffect(() => { search(); }, []);

  if (data && data.configured === false) return null;

  return (
    <div className="card" style={{ marginBottom: 12, borderColor: 'var(--green)' }}>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔴 YouTube en directo ahora</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="buscar directos…"
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          style={{ flex: 1, minWidth: 180, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
        <button className="btn btn-sm" onClick={search} disabled={loading}>{loading ? '⏳' : '🔍 Buscar directos'}</button>
      </div>
      {data && !data.ok && <div style={{ fontSize: 11, color: 'var(--yellow)' }}>⚠️ {data.error || 'Sin clave YouTube: pon youtubeApiKey en config para activar.'}</div>}
      {selected && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{selected.title}</span>
            <button className="btn btn-sm btn-outline" onClick={() => setSelected(null)}>✕ Cerrar</button>
          </div>
          <iframe src={`${selected.embed}`} title={selected.title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen
            style={{ width: '100%', height: 360, border: '1px solid var(--border)', borderRadius: 6, background: '#000' }} />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
        {(data?.lives || []).map((v) => (
          <div key={v.id} onClick={() => setSelected(v)}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', cursor: 'pointer' }}>
            {v.thumb && <img src={`/api/cameras/media/img?url=${encodeURIComponent(v.thumb)}`} alt={v.title} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} loading="lazy" />}
            <div style={{ padding: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>{v.channel}</div>
            </div>
          </div>
        ))}
      </div>
      {data?.ok && !(data?.lives || []).length && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nadie en directo para esa búsqueda ahora mismo.</div>}
    </div>
  );
}

function dotToLive(c) {
  return {
    id: `${c.source}:${c.id}`,
    name: c.name, country: c.country, city: c.city, category: c.kind,
    source: c.source, road: c.road, snapshot: c.snapshot, distanceKm: c.distanceKm, video: c.video,
    play: c.hls ? { kind: 'hls', src: c.hls } : { kind: 'img', src: `${c.snapshot}&t=0` },
  };
}

function NasaTab({ nasa }) {
  const { epic, iss, err } = nasa || {};
  const issX = iss && Number.isFinite(iss.lon) ? ((iss.lon + 180) / 360) * 360 : null;
  const issY = iss && Number.isFinite(iss.lat) ? ((90 - iss.lat) / 180) * 180 : null;
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🛰️ Tierra hoy — EPIC / DSCOVR (NASA)</h3>
        {err && !epic && <div style={{ fontSize: 11, color: 'var(--yellow)' }}>⚠️ {err}</div>}
        {epic && (
          <>
            <img src={epic.proxy} alt="Tierra EPIC" style={{ width: '100%', maxHeight: 420, objectFit: 'contain', background: '#000', borderRadius: 6 }} />
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
              {epic.date} · {epic.caption}
              {epic.centroid && Number.isFinite(epic.centroid.lat) && ` · centro ${Number(epic.centroid.lat).toFixed(1)}, ${Number(epic.centroid.lon).toFixed(1)}`}
            </div>
          </>
        )}
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔴 ISS en directo 24/7 (YouTube)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 8 }}>
          {[
            { id: 'tj4knR4r1UU', title: 'NASA Live: Tierra desde la ISS (afarTV)' },
            { id: 'TAkk2B9GOmc', title: 'ISS Live: órbita, auroras y meteo (Tripwebcam)' },
          ].map((v) => (
            <div key={v.id}>
              <iframe src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&mute=1`}
                title={v.title} allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowFullScreen
                style={{ width: '100%', height: 220, border: '1px solid var(--border)', borderRadius: 6, background: '#000' }} />
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                🔴 {v.title} · <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>abrir en YouTube</a>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🛰️ ISS ahora mismo</h3>
        {iss ? (
          <>
            <svg viewBox="0 0 360 180" style={{ width: '100%', aspectRatio: '2 / 1', display: 'block', background: '#05070c', border: '1px solid var(--border)', borderRadius: 6 }}>
              <g stroke="rgba(8,216,255,0.10)" strokeWidth="0.4">
                {Array.from({ length: 11 }, (_, i) => <line key={`h${i}`} x1="0" y1={i * 18} x2="360" y2={i * 18} />)}
                {Array.from({ length: 19 }, (_, i) => <line key={`v${i}`} x1={i * 20} y1="0" x2={i * 20} y2="180" />)}
              </g>
              {issX != null && (
                <g>
                  <circle cx={issX} cy={issY} r="10" fill="none" stroke="rgba(63,185,80,0.5)" strokeWidth="1" />
                  <circle cx={issX} cy={issY} r="3" fill="var(--green)">
                    <title>{`ISS ${iss.lat}, ${iss.lon}`}</title>
                  </circle>
                </g>
              )}
            </svg>
            <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'monospace' }}>
              🛰️ lat {iss.lat} · lon {iss.lon}
              <span style={{ color: 'var(--muted)' }}> · se actualiza cada 30 s · la NASA emite el directo en YouTube/NASA+</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <a className="btn btn-sm" href="https://www.youtube.com/results?search_query=iss+live+now" target="_blank" rel="noopener">▶ Directo ISS (YouTube)</a>
              <a className="btn btn-sm btn-outline" href="https://plus.nasa.gov/" target="_blank" rel="noopener">NASA+ official</a>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sin posición ISS ahora mismo.</div>
        )}
      </div>
    </div>
  );
}

function LiveCard({ item, onOpen }) {
  const play = item.play || {};
  const poster = item.snapshot ? `${item.snapshot}&t=0` : undefined;
  const [liveOn, setLiveOn] = useState(!poster && play.kind === 'hls');
  return (
    <div onClick={onOpen}
      style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', background: 'rgba(8,216,255,0.08)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
          {item.name}
        </span>
        <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
          background: play.kind === 'hls' ? 'rgba(63,185,80,0.15)' : 'rgba(255,199,0,0.15)',
          color: play.kind === 'hls' ? 'var(--green)' : 'var(--yellow)' }}>
          {play.kind === 'hls' ? '🔴 HLS' : play.kind === 'mjpeg' ? '🎞️ MJPEG' : '📷 FOTO'}
        </span>
      </div>
      <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        {play.kind === 'hls' && (liveOn || !poster) && (
          <HLSPlayer src={play.src} rawUrl={item.video || item.url} poster={poster} width="100%" height={190} autoPlay muted showCheck logCtx={{ view: 'live', label: item.name }} />
        )}
        {play.kind === 'hls' && poster && !liveOn && (
          <>
            <img src={poster} alt={item.name} style={{ width: '100%', height: 190, objectFit: 'cover', background: '#000', display: 'block' }} />
            <button onClick={() => setLiveOn(true)} title="Ver en directo"
              style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', padding: '3px 12px', fontSize: 10, fontWeight: 700,
                background: 'rgba(63,185,80,0.9)', color: '#fff', border: 'none', borderRadius: 12, cursor: 'pointer', fontFamily: 'monospace' }}>
              ▶ DIRECTO
            </button>
          </>
        )}
        {play.kind === 'hls' && poster && liveOn && (
          <button onClick={() => setLiveOn(false)} title="Volver a la foto"
            style={{ position: 'absolute', top: 4, right: 4, padding: '2px 8px', fontSize: 9, background: 'rgba(0,0,0,0.65)', color: '#fff', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer' }}>
            📷 Foto
          </button>
        )}
        {play.kind === 'mjpeg' && <img src={play.src} alt={item.name} style={{ width: '100%', height: 190, objectFit: 'cover', background: '#000', display: 'block' }} />}
        {play.kind === 'img' && <img src={play.src} alt={item.name} style={{ width: '100%', height: 190, objectFit: 'cover', background: '#000', display: 'block' }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[item.country, item.city, item.road].filter(Boolean).join(' · ')}
        </span>
        {item.distanceKm != null && <span style={{ color: 'var(--primary)', whiteSpace: 'nowrap', marginLeft: 6 }}>◎ {item.distanceKm} km</span>}
      </div>
    </div>
  );
}

function LiveDetail({ item, onClose }) {
  const play = item.play || {};
  const detail = useMemo(() => item, [item]);
  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>{detail.name}</span>
        <button className="btn btn-sm btn-outline" onClick={onClose}>✕ Cerrar</button>
      </div>
      {play.kind === 'hls' && <HLSPlayer src={play.src} rawUrl={detail.video || detail.url} poster={detail.snapshot ? `${detail.snapshot}&t=0` : undefined} width="100%" height={380} autoPlay muted showCheck logCtx={{ view: 'live-detail', label: detail.name }} />}
      {play.kind !== 'hls' && <img src={play.src} alt={detail.name} style={{ width: '100%', maxHeight: 380, objectFit: 'contain', background: '#000', borderRadius: 6 }} />}
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
        {[detail.country, detail.city, detail.road].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}
