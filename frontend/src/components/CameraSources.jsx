import React, { useState, useEffect, useCallback } from 'react';
import HLSPlayer from './HLSPlayer';

// ============================================================================
// CameraSources.jsx — Multi-source public camera discovery
//
// Aggregates: Insecam, EarthCam, curated HLS/MJPEG streams, Google dorks,
// IP search dorks, and exposed camera detection via InternetDB.
// ============================================================================

const TABS = [
  { id: 'streams', icon: '📺', name: 'Streams Públicos', desc: 'HLS/MJPEG de ciudades, tráfico, naturaleza' },
  { id: 'insecam', icon: '📷', name: 'Insecam', desc: 'Directorio de cámaras públicas mundiales' },
  { id: 'earthcam', icon: '🌍', name: 'EarthCam', desc: 'Webcams de todo el mundo' },
  { id: 'dorks', icon: '🔍', name: 'Camera Dorks', desc: 'Google Dorks para marcas de cámaras' },
  { id: 'ip-dorks', icon: '🔎', name: 'IP Search Dorks', desc: 'Shodan/Censys/FOFA/ZoomEye dorks' },
  { id: 'exposed', icon: '🛡️', name: 'Exposed Scan', desc: 'Detectar cámaras expuestas por IP' },
  { id: 'brands', icon: '🏷️', name: 'Marcas', desc: 'Credenciales por defecto por marca' },
];

const BRANDS = [
  'Hikvision', 'Dahua', 'Axis', 'Foscam', 'Reolink', 'Amcrest',
  'Sony', 'Panasonic', 'Samsung', 'Bosch', 'Vivotek', 'Geovision',
  'UNV (Uniview)', 'TP-Link Tapo', 'Xiaomi', 'Lorex', 'Swann', 'Night Owl',
];

const CATEGORIES = [
  { id: 'traffic', label: '🚦 Tráfico' },
  { id: 'weather', label: '🌤️ Meteorología' },
  { id: 'nature', label: '🌿 Naturaleza' },
  { id: 'city', label: '🏙️ Ciudad' },
  { id: 'beach', label: '🏖️ Playa' },
  { id: 'mountain', label: '⛰️ Montaña' },
  { id: 'airport', label: '✈️ Aeropuerto' },
  { id: 'port', label: '⚓ Puerto' },
];

const SERVICES = [
  { id: 'shodan', label: 'Shodan', url: 'https://www.shodan.io' },
  { id: 'censys', label: 'Censys', url: 'https://search.censys.io' },
  { id: 'fofa', label: 'FOFA', url: 'https://fofa.info' },
  { id: 'zoomeye', label: 'ZoomEye', url: 'https://www.zoomeye.org' },
  { id: 'hunter', label: 'Hunter', url: 'https://hunter.io' },
];

const SELECT_STYLE = {
  padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11, fontFamily: 'monospace',
};

export default function CameraSources({ api }) {
  const [tab, setTab] = useState('streams');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [brand, setBrand] = useState('Hikvision');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');
  const [service, setService] = useState('shodan');
  const [port, setPort] = useState('80');
  const [ip, setIp] = useState('');
  const [selected, setSelected] = useState(null);
  const [showBatch, setShowBatch] = useState(false);
  const [batchUrls, setBatchUrls] = useState('');
  const [batchRes, setBatchRes] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);

  const runBatch = async () => {
    const urls = batchUrls.split(/[\s,]+/).map((s) => s.trim()).filter((s) => /insecam\.org\/en\/view\//i.test(s)).slice(0, 12);
    if (!urls.length) { setBatchRes({ ok: false, error: 'Pega URLs de fichas insecam (/en/view/…), máx 12.' }); return; }
    setBatchLoading(true);
    try {
      const r = await api('/cameras/sources/insecam/resolve-batch', { method: 'POST', body: JSON.stringify({ urls }), headers: { 'Content-Type': 'application/json' } });
      setBatchRes(r);
    } catch (e) { setBatchRes({ ok: false, error: e.message }); }
    setBatchLoading(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setResults(null);
    try {
      let data;
      switch (tab) {
        case 'streams':
          data = await api('/cameras/sources/streams');
          break;
        case 'insecam':
          data = await api(`/cameras/sources/insecam?country=${country}&category=${category}`);
          break;
        case 'earthcam':
          data = await api(`/cameras/sources/earthcam?category=${category}`);
          break;
        case 'dorks':
          data = await api(`/cameras/sources/dorks?brand=${brand}&country=${country}`);
          break;
        case 'ip-dorks':
          data = await api(`/cameras/sources/ip-dorks?service=${service}&port=${port}`);
          break;
        case 'exposed':
          if (!ip) { setError('Introduce una IP'); break; }
          data = await api(`/cameras/sources/exposed/${ip}`);
          break;
        case 'brands':
          data = await api('/cameras/sources/brands');
          break;
      }
      setResults(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [tab, brand, country, category, service, port, ip, api]);

  useEffect(() => { load(); }, [tab]);

  return (
    <div style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>📡</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontFamily: "'Courier New', monospace" }}>FUENTES DE CÁMARAS</h2>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>Multi-fuente: streams, directorios, dorks, detección</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setResults(null); setError(''); }}
            style={{
              padding: '5px 10px', fontSize: 10, fontFamily: 'monospace',
              background: tab === t.id ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
              border: `1px solid ${tab === t.id ? 'var(--primary)' : 'var(--border)'}`,
              color: tab === t.id ? 'var(--primary)' : 'var(--muted)',
              borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {t.icon} {t.name}
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {tab === 'insecam' && (
            <>
              <input value={country} onChange={e => setCountry(e.target.value)}
                placeholder="País (ej: ES, US, DE)" style={{ width: 80, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
              <select value={category} onChange={e => setCategory(e.target.value)} style={SELECT_STYLE}>
                <option value="">Todas</option>
                <option value="city">Ciudad</option>
                <option value="nature">Naturaleza</option>
                <option value="traffic">Tráfico</option>
                <option value="weather">Meteorología</option>
              </select>
              <button className="btn btn-sm btn-outline" onClick={() => setShowBatch((v) => !v)} title="Pegar fichas y resolverlas en lote">
                📦 Lote
              </button>
            </>
          )}
          {tab === 'earthcam' && (
            <select value={category} onChange={e => setCategory(e.target.value)} style={SELECT_STYLE}>
              <option value="">Todas</option>
              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          {tab === 'dorks' && (
            <>
              <select value={brand} onChange={e => setBrand(e.target.value)} style={SELECT_STYLE}>
                {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <input value={country} onChange={e => setCountry(e.target.value)}
                placeholder="País (opcional)" style={{ width: 80, padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
            </>
          )}
          {tab === 'ip-dorks' && (
            <>
              <select value={service} onChange={e => setService(e.target.value)} style={SELECT_STYLE}>
                {SERVICES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <select value={port} onChange={e => setPort(e.target.value)} style={SELECT_STYLE}>
                <option value="80">80 (HTTP)</option>
                <option value="443">443 (HTTPS)</option>
                <option value="554">554 (RTSP)</option>
                <option value="8000">8000</option>
                <option value="8080">8080</option>
                <option value="8443">8443</option>
                <option value="8554">8554</option>
              </select>
            </>
          )}
          {tab === 'exposed' && (
            <input value={ip} onChange={e => setIp(e.target.value)}
              placeholder="IP a escanear (ej: 8.8.8.8)"
              style={{ flex: 1, minWidth: 200, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}
              onKeyDown={e => e.key === 'Enter' && load()} />
          )}
          {tab !== 'brands' && tab !== 'streams' && (
            <button className="btn btn-sm" onClick={load} disabled={loading}>
              {loading ? '⏳ Cargando...' : '🔍 Buscar'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
          {TABS.find(t => t.id === tab)?.desc}
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(255,199,0,0.4)', background: 'rgba(255,199,0,0.08)' }}>
          <div style={{ fontSize: 12, color: 'var(--yellow)' }}>⚠️ {error}</div>
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 24, animation: 'pulse 1.5s infinite' }}>⏳</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Cargando...</div>
        </div>
      )}

      {tab === 'insecam' && showBatch && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ color: 'var(--primary)', fontSize: 13, marginBottom: 6 }}>📦 Resolver lote (máx 12 fichas)</h3>
          <textarea value={batchUrls} onChange={(e) => setBatchUrls(e.target.value)}
            placeholder={'http://www.insecam.org/en/view/1011887/\nhttp://www.insecam.org/en/view/1011864/'}
            rows={3} style={{ width: '100%', padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 10, fontFamily: 'monospace' }} />
          <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={runBatch} disabled={batchLoading}>
            {batchLoading ? '⏳ Resolviendo…' : '🔍 Resolver lote'}
          </button>
          {batchRes && !batchRes.ok && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>❌ {batchRes.error}</div>}
          {batchRes?.results && (
            <div style={{ fontSize: 10, color: 'var(--green)', margin: '6px 0' }}>
              ✅ {batchRes.resolved}/{batchRes.total} con imagen o stream
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginTop: 8 }}>
            {(batchRes?.results || []).filter((r) => r.ok && (r.image || (r.mjpeg || []).length)).map((r, i) => (
              <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                {r.image && <img src={`/api/cameras/media/img?url=${encodeURIComponent(r.image)}`} alt={r.title || 'insecam'} style={{ width: '100%', height: 140, objectFit: 'cover', background: '#000', display: 'block' }} loading="lazy" />}
                <div style={{ padding: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || r.url}</div>
                  {(r.mjpeg || []).length > 0 && (
                    <a href={`/api/cameras/media/img?url=${encodeURIComponent(r.mjpeg[0])}&stream=1`} target="_blank" rel="noopener" style={{ fontSize: 9, color: 'var(--green)' }}>▶ MJPEG directo (proxy)</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results && !loading && (
        <div className="card">
          {tab === 'streams' && <StreamsResults data={results} selected={selected} setSelected={setSelected} />}
          {tab === 'insecam' && <InsecamResults data={results} />}
          {tab === 'earthcam' && <EarthCamResults data={results} />}
          {tab === 'dorks' && <DorksResults data={results} brand={brand} />}
          {tab === 'ip-dorks' && <IPDorksResults data={results} service={service} />}
          {tab === 'exposed' && <ExposedResults data={results} />}
          {tab === 'brands' && <BrandsResults data={results} />}
        </div>
      )}

      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 12, padding: 8, background: 'rgba(8,216,255,0.05)', borderRadius: 6, fontFamily: 'monospace' }}>
        ⚖️ Solo fuentes públicas. El módulo es un agregador, no un escáner. No se conecta a IPs privadas.
      </div>
    </div>
  );
}

// ── Results Components ──────────────────────────────────────────

function StreamsResults({ data, selected, setSelected }) {
  const [checks, setChecks] = useState({});
  if (!Array.isArray(data)) return <div style={{ color: 'var(--muted)' }}>Sin datos</div>;

  const checkOne = async (s, i) => {
    if (s.type !== 'hls' || checks[i]) return;
    setChecks((p) => ({ ...p, [i]: { loading: true } }));
    try {
      let remote = s.streamUrl || s.url;
      try {
        const u = new URL(remote, window.location.origin);
        remote = u.searchParams.get('url') || remote;
      } catch {}
      const r = await fetch(`/api/cameras/public/hls-check?url=${encodeURIComponent(remote)}`, { credentials: 'same-origin' });
      const j = await r.json();
      setChecks((p) => ({ ...p, [i]: { ...j, loading: false } }));
    } catch (e) {
      setChecks((p) => ({ ...p, [i]: { ok: false, error: e.message, loading: false } }));
    }
  };

  const playableSrc = (s) => s.streamUrl || s.url;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📺 Streams Públicos — {data.length}</h3>
      {selected && (
        <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>{selected.name}</span>
            <button className="btn btn-sm btn-outline" onClick={() => setSelected(null)}>✕ Cerrar</button>
          </div>
          {selected.type === 'hls' && selected.playable !== false ? (
            <HLSPlayer src={playableSrc(selected)} rawUrl={selected.streamUrl && /^https?:\/\//i.test(selected.streamUrl) ? selected.streamUrl : undefined} width="100%" height={300} autoPlay={true} muted={true} showCheck logCtx={{ view: 'fuentes', label: selected.name }} />
          ) : selected.action === 'open-live' ? (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
              📡 Índice en directo: ábrelo en el módulo <b>En Directo</b> (INTELIGENCIA → 📡 En Directo).
            </div>
          ) : (
            <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>Sin stream reproducible</div>
          )}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
            {selected.country} · {selected.city} · {selected.category} · {String(selected.type || '').toUpperCase()}
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
        {data.map((s, i) => {
          const st = checks[i];
          const dot = s.type !== 'hls' || s.playable === false ? null
            : !st ? '⚪' : st.loading ? '🟡' : st.ok ? '🟢' : '🔴';
          return (
            <div key={i} onClick={() => setSelected(s)}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; checkOne(s, i); }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, cursor: 'pointer', transition: 'border-color 0.15s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dot} {s.name}
                </span>
                <span style={{ fontSize: 8, padding: '1px 4px', background: s.type === 'hls' ? 'rgba(63,185,80,0.15)' : 'rgba(255,199,0,0.15)', color: s.type === 'hls' ? 'var(--green)' : 'var(--yellow)', borderRadius: 3 }}>
                  {String(s.type || '').toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                {s.country} · {s.city} · {s.category}
                {st && !st.loading && !st.ok && <span style={{ color: 'var(--yellow)' }}> — {st.error || 'sin señal'}</span>}
                {s.type === 'hls' && s.playable !== false && <span style={{ color: 'var(--green)' }}> — ▶ pulsa para ver</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsecamResults({ data }) {
  if (!data?.cameras) return <div style={{ color: 'var(--muted)' }}>Sin datos</div>;
  if (!data.cameras.length) {
    return (
      <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
        📷 Insecam no devolvió fichas (su HTML cambia a menudo o bloquea bots).
        <div style={{ marginTop: 6 }}>Usa el módulo <b>En Directo → Explorar DOT</b> para vídeo real, o abre el directorio:</div>
        <a href="http://www.insecam.org/" target="_blank" rel="noopener" style={{ fontSize: 11, color: 'var(--green)' }}>🔗 insecam.org</a>
      </div>
    );
  }
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📷 Insecam — {data.cameras.length} cámaras</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
        {data.cameras.map((cam, i) => <InsecamCard key={i} cam={cam} />)}
      </div>
    </div>
  );
}

function InsecamCard({ cam }) {
  const [resolved, setResolved] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      if (!cam.url || !/insecam\.org\/en\/view\//i.test(cam.url)) return;
      setLoading(true);
      try {
        const r = await fetch(`/api/cameras/sources/insecam/resolve?url=${encodeURIComponent(cam.url)}`, { credentials: 'same-origin' });
        const j = await r.json();
        if (!cancelled) setResolved(j);
      } catch {}
      if (!cancelled) setLoading(false);
    }
    resolve();
    return () => { cancelled = true; };
  }, [cam.url]);

  useEffect(() => {
    if (!resolved?.image) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(id);
  }, [resolved?.image]);

  const imgSrc = resolved?.image
    ? `/api/cameras/media/img?url=${encodeURIComponent(resolved.image)}&t=${tick}`
    : null;

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{resolved?.title || cam.name || cam.url}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 4 }}>
        {cam.country} · {cam.city} · {cam.brand || 'Desconocida'}
      </div>
      {loading && <div style={{ fontSize: 10, color: 'var(--primary)' }}>⏳ Resolviendo imagen…</div>}
      {!loading && imgSrc && (
        <img src={imgSrc} alt={cam.name || 'insecam'} style={{ width: '100%', height: 170, objectFit: 'cover', background: '#000', borderRadius: 4 }} />
      )}
      {!loading && !imgSrc && (
        <div style={{ fontSize: 10, color: 'var(--yellow)', marginBottom: 4 }}>⚠️ Sin imagen directa — abre la ficha:</div>
      )}
      <a href={cam.url} target="_blank" rel="noopener" style={{ fontSize: 9, color: 'var(--green)', wordBreak: 'break-all' }}>
        🔗 Abrir ficha Insecam
      </a>
    </div>
  );
}

function EarthCamResults({ data }) {
  if (!data?.cameras) return <div style={{ color: 'var(--muted)' }}>Sin datos</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🌍 EarthCam — {data.cameras.length}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
        {data.cameras.map((cam, i) => (
          <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{cam.name}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>
              {cam.country} · {cam.city} · {cam.category}
            </div>
            {cam.url && (
              <a href={cam.url} target="_blank" rel="noopener" style={{ fontSize: 9, color: 'var(--primary)' }}>
                🔗 Ver en EarthCam
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DorksResults({ data, brand }) {
  const dorks = Array.isArray(data) ? data : (data?.dorks || []);
  if (!dorks.length) return <div style={{ color: 'var(--muted)' }}>Sin datos</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔍 {brand} — {dorks.length} dorks</h3>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
        {dorks.map((d, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(d)}`} target="_blank" rel="noopener"
              style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'monospace', textDecoration: 'none' }}>
              {d}
            </a>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(dorks.join('\n'))}>
        📋 Copiar todos
      </button>
    </div>
  );
}

function IPDorksResults({ data, service }) {
  const dorks = Array.isArray(data) ? data : (data?.dorks || []);
  const urls = data?.urls || [];
  if (!dorks.length) return <div style={{ color: 'var(--muted)' }}>Sin datos</div>;
  const serviceInfo = SERVICES.find(s => s.id === service);
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔎 {serviceInfo?.label || service} — Dorks para cámaras</h3>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
        {dorks.map((d, i) => (
          <div key={i} style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'monospace' }}>{d}</span>
          </div>
        ))}
      </div>
      {urls.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Enlaces directos:</div>
          {urls.map((u, i) => (
            <a key={i} href={u.url} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 10, color: 'var(--primary)', marginBottom: 2 }}>
              🔗 {u.label || u.url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ExposedResults({ data }) {
  if (!data?.ok) return <div style={{ color: 'var(--red)' }}>❌ {data?.error || 'Error'}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🛡️ {data.ip} — Exposed Camera Scan</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Puertos</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace' }}>{data.ports?.join(', ') || 'Ninguno'}</div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Marca</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: data.brand ? 'var(--green)' : 'var(--muted)' }}>{data.brand || 'Desconocida'}</div>
        </div>
        <div style={{ background: 'var(--bg)', border: `1px solid ${data.cameraDetected ? 'var(--green)' : 'var(--border)'}`, borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: data.cameraDetected ? 'var(--green)' : 'var(--muted)' }}>Cámara</div>
          <div style={{ fontSize: 11 }}>{data.cameraDetected ? '✅ Detectada' : '❌ No detectada'}</div>
        </div>
      </div>
      {data.vulnerabilities?.length > 0 && (
        <div style={{ padding: 8, background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>🔓 Vulnerabilidades</div>
          {data.vulnerabilities.map((v, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--yellow)' }}>{v}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandsResults({ data }) {
  const brands = Array.isArray(data) ? data : [];
  if (!brands.length) return <div style={{ color: 'var(--muted)' }}>Sin datos</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🏷️ Marcas de Cámaras — Credenciales por Defecto</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
        {brands.map((b, i) => (
          <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 4 }}>{b.brand}</div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', marginBottom: 2 }}>
              👤 {b.defaultUser || 'admin'} / 🔑 {b.defaultPass || '(vacía)'}
            </div>
            {b.paths && (
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                {b.paths.rtsp && <div>RTSP: {b.paths.rtsp}</div>}
                {b.paths.mjpeg && <div>MJPEG: {b.paths.mjpeg}</div>}
                {b.paths.snapshot && <div>Snapshot: {b.paths.snapshot}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
