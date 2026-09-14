import React, { useState } from 'react';
import LanCameraFeed, { lanRelayBlockReason } from './LanCameraFeed';
import ExposedCameras from './ExposedCameras';

// ============================================================================
// OSINT.jsx — Deep OSINT Hub + Camera Scanner with live streams
//
// Los streams de cámaras de la LAN se reproducen a través del relé del backend
// (`/api/cameras/local/stream`), no directamente: el CSP del workbench de
// escritorio solo permite imágenes same-origin, así que un <img> apuntando a
// http://192.168.x.x se bloqueaba en silencio. Ver LanCameraFeed.jsx.
//
// «Cámaras Externas» vive en ExposedCameras.jsx: índices públicos con filtros
// traducidos a la sintaxis de cada buscador.
// ============================================================================

const SECTIONS = [
  { id: 'cam-scan', icon: '🎥', name: 'Escáner Local', desc: 'Scan red local de cámaras (RTSP/HTTP/ONVIF) — streams por el relé del backend' },
  { id: 'cam-external', icon: '🛰️', name: 'Cámaras Expuestas', desc: 'Índices públicos (Shodan, FOFA, ZoomEye…) con filtros + InternetDB' },
  { id: 'cam-cves', icon: '🔓', name: 'CVE Cámaras', desc: 'Vulnerabilidades por marca (Hikvision, Dahua...)' },
  { id: 'cam-dorks', icon: '🔍', name: 'Camera Dorks', desc: 'Google Dorks específicas para cámaras' },
  { id: 'cam-audit', icon: '🛡️', name: 'Auditoría IP', desc: 'Auditar IP de cámara completa' },
  { id: 'people', icon: '🧑‍💻', name: 'People', desc: 'Auto-detecta email/teléfono/username y lo busca' },
  { id: 'username', icon: '👤', name: 'Username', desc: 'Find accounts across platforms' },
  { id: 'email', icon: '📧', name: 'Email OSINT', desc: 'Breach check, MX, social profiles' },
  { id: 'phone', icon: '📱', name: 'Phone Lookup', desc: 'Carrier, location, OSINT links' },
  { id: 'domain', icon: '🌐', name: 'Domain Recon', desc: 'DNS, tech stack, subdomains' },
  { id: 'dorks', icon: '🔍', name: 'Google Dorks', desc: 'Advanced search operators' },
  { id: 'robots', icon: '🤖', name: 'robots.txt', desc: 'Analyze crawler directives' },
  { id: 'ip', icon: '📍', name: 'IP Lookup', desc: 'Geo, ISP, open ports' },
  { id: 'trace', icon: '🧭', name: 'Trazar ruta', desc: 'Traceroute por saltos hasta el objetivo' },
  { id: 'hash', icon: '🔐', name: 'Hash Lookup', desc: 'Malware hash check' },
];

const CAMERA_BRANDS = [
  'Hikvision', 'Dahua', 'Axis', 'Amcrest', 'Foscam', 'Reolink', 'TP-Link Tapo',
  'UNV (Uniview)', 'Vivotek', 'Bosch', 'Geovision', 'Pelco', 'Sony', 'Samsung',
  'Panasonic', 'Lorex', 'Swann', 'Night Owl', 'Xiaomi',
];

export default function OSINT({ api }) {
  const [section, setSection] = useState('cam-scan');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [query, setQuery] = useState('');
  const [dorkType, setDorkType] = useState('security');
  const [camBrand, setCamBrand] = useState('Hikvision');
  const [auditIP, setAuditIP] = useState('');
  const [toast, setToast] = useState('');

  const runQuery = async () => {
    setLoading(true);
    setResults(null);
    try {
      let r;
      switch (section) {
        case 'cam-scan': r = await api(`/camera/scan-local${query ? `?range=${encodeURIComponent(query)}` : ''}`); break;
        case 'cam-cves': r = await api(`/camera/cves?brand=${encodeURIComponent(camBrand)}`); break;
        case 'cam-dorks': r = await api(`/camera/dorks?brand=${camBrand}&target=${encodeURIComponent(query)}`); break;
        case 'cam-audit': r = await api('/camera/audit', { method: 'POST', body: JSON.stringify({ ip: auditIP }), headers: { 'Content-Type': 'application/json' } }); break;
        case 'people': r = await api(`/osint/people?q=${encodeURIComponent(query)}`); break;
        case 'username': r = await api(`/osint/username?user=${encodeURIComponent(query)}`); break;
        case 'email': r = await api(`/osint/email?address=${encodeURIComponent(query)}`); break;
        case 'phone': r = await api(`/osint/phone?number=${encodeURIComponent(query)}`); break;
        case 'domain': r = await api(`/osint/domain?target=${encodeURIComponent(query)}`); break;
        case 'dorks': r = await api(`/osint/dorks?target=${encodeURIComponent(query)}&type=${dorkType}`); break;
        case 'robots': r = await api(`/osint/robots?domain=${encodeURIComponent(query)}`); break;
        case 'ip': r = await api(`/osint/ip?target=${encodeURIComponent(query)}`); break;
        case 'trace': r = await api(`/osint/traceroute?target=${encodeURIComponent(query)}`); break;
        case 'hash': r = await api(`/osint/hash?target=${encodeURIComponent(query)}`); break;
      }
      setResults(r);
    } catch (e) {
      setToast('❌ ' + e.message);
    }
    setLoading(false);
  };

  const isCamSection = section.startsWith('cam-');
  const isExposed = section === 'cam-external';

  return (
    <div style={{ color: 'var(--text)' }}>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>🕵️</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontFamily: "'Courier New', monospace" }}>OSINT HUB</h2>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>Cámaras + OSINT gratuito — Sin APIs de pago</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => { setSection(s.id); setResults(null); setQuery(''); }}
            style={{
              padding: '5px 10px', fontSize: 10, fontFamily: 'monospace',
              background: section === s.id ? 'rgba(8,216,255,0.15)' : 'var(--panel)',
              border: `1px solid ${section === s.id ? 'var(--primary)' : 'var(--border)'}`,
              color: section === s.id ? 'var(--primary)' : 'var(--muted)',
              borderRadius: 6, cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {s.icon} {s.name}
          </button>
        ))}
      </div>

      {isExposed ? (
        <ExposedCameras api={api} />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {section === 'cam-scan' && (
                <>
                  <input value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Rango IP (ej: 192.168.1.0 o vacío = auto)"
                    style={{ flex: 1, minWidth: 200, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}
                    onKeyDown={e => e.key === 'Enter' && runQuery()} />
                  <button className="btn btn-sm" onClick={runQuery} disabled={loading}>
                    {loading ? '⏳ Escaneando...' : '🎥 Escanear'}
                  </button>
                </>
              )}
              {section === 'cam-cves' && (
                <>
                  <select value={camBrand} onChange={e => setCamBrand(e.target.value)}
                    style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, minWidth: 180 }}>
                    {CAMERA_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <button className="btn btn-sm" onClick={runQuery} disabled={loading}>
                    {loading ? '⏳ Buscando...' : '🔓 CVEs'}
                  </button>
                </>
              )}
              {section === 'cam-dorks' && (
                <>
                  <select value={camBrand} onChange={e => setCamBrand(e.target.value)}
                    style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}>
                    <option value="all">Todas</option>
                    <option value="hikvision">Hikvision</option>
                    <option value="dahua">Dahua</option>
                    <option value="axis">Axis</option>
                    <option value="foscam">Foscam</option>
                    <option value="reolink">Reolink</option>
                    <option value="amcrest">Amcrest</option>
                    <option value="onvif">ONVIF</option>
                  </select>
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Target (opcional)"
                    style={{ flex: 1, minWidth: 150, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}
                    onKeyDown={e => e.key === 'Enter' && runQuery()} />
                  <button className="btn btn-sm" onClick={runQuery} disabled={loading}>
                    {loading ? '⏳ Generando...' : '🔍 Dorks'}
                  </button>
                </>
              )}
              {section === 'cam-audit' && (
                <>
                  <input value={auditIP} onChange={e => setAuditIP(e.target.value)}
                    placeholder="IP a auditar (ej: 192.168.1.100)"
                    style={{ flex: 1, minWidth: 200, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}
                    onKeyDown={e => e.key === 'Enter' && runQuery()} />
                  <button className="btn btn-sm" onClick={runQuery} disabled={loading || !auditIP}>
                    {loading ? '⏳ Auditando...' : '🛡️ Auditar'}
                  </button>
                </>
              )}
              {!isCamSection && (
                <>
                  <input value={query} onChange={e => setQuery(e.target.value)}
                    placeholder={getPlaceholder(section)}
                    style={{ flex: 1, minWidth: 200, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}
                    onKeyDown={e => e.key === 'Enter' && runQuery()} />
                  {section === 'dorks' && (
                    <select value={dorkType} onChange={e => setDorkType(e.target.value)}
                      style={{ padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}>
                      <option value="security">Security</option>
                      <option value="general">General</option>
                      <option value="files">Files</option>
                      <option value="subdomains">Subdomains</option>
                    </select>
                  )}
                  <button className="btn btn-sm" onClick={runQuery} disabled={loading || !query}>
                    {loading ? '⏳ Buscando...' : '🔍 Buscar'}
                  </button>
                </>
              )}
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{SECTIONS.find(s => s.id === section)?.desc}</div>
          </div>

          {results && (
            <div className="card">
              {section === 'cam-scan' && <LocalScanResults data={results} />}
              {section === 'cam-cves' && <CVEResults data={results} />}
              {section === 'cam-dorks' && <CameraDorksResults data={results} />}
              {section === 'cam-audit' && <AuditResults data={results} />}
              {section === 'people' && <PeopleResults data={results} />}
              {section === 'username' && <UsernameResults data={results} />}
              {section === 'email' && <EmailResults data={results} />}
              {section === 'phone' && <PhoneResults data={results} />}
              {section === 'domain' && <DomainResults data={results} />}
              {section === 'dorks' && <DorksResults data={results} />}
              {section === 'robots' && <RobotsResults data={results} />}
              {section === 'ip' && <IPResults data={results} />}
              {section === 'trace' && <TraceResults data={results} />}
              {section === 'hash' && <HashResults data={results} />}
            </div>
          )}

          {!results && isCamSection && (
            <div className="card" style={{ padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'monospace' }}>
                {section === 'cam-scan' && 'Escanea tu red local para encontrar cámaras IP con streams de video'}
                {section === 'cam-cves' && 'Consulta vulnerabilidades conocidas por marca de cámara'}
                {section === 'cam-dorks' && 'Genera Google Dorks para encontrar cámaras'}
                {section === 'cam-audit' && 'Auditoría completa de una IP: puertos, marca, streams, CVEs'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--primary)', marginTop: 8 }}>100% gratuito — Sin API keys</div>
              {(section === 'cam-scan' || section === 'cam-audit') && (
                <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 8, fontFamily: 'monospace' }}>
                  🔌 Los streams de tu LAN se ven por el relé del backend (same-origin): el CSP del escritorio no los bloquea
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function getPlaceholder(section) {
  const p = { people: 'usuario, email o teléfono', username: 'username', email: 'user@example.com', phone: '+34612345678', domain: 'example.com', dorks: 'target.com', robots: 'example.com', ip: '8.8.8.8', trace: '8.8.8.8 o ejemplo.com', hash: 'SHA256 hash' };
  return p[section] || 'Target...';
}

// ── Stream Preview Component ────────────────────────────────────────

function StreamPreview({ streams, compact = false, fallbackSnapshot = null }) {
  if (!streams || streams.length === 0) return null;

  const mjpegStreams = streams.filter(s => s.type === 'mjpeg');
  const rtspStreams = streams.filter(s => s.type === 'rtsp');
  // Fotograma suelto de la misma cámara, para el modo 📷 cuando el MJPEG falla.
  const snapshotFallback = fallbackSnapshot || mjpegStreams.find(s => /snapshot|picture|snap/i.test(s.url))?.url || null;

  return (
    <div style={{ marginTop: 6 }}>
      {mjpegStreams.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {!compact && (
            <div style={{ fontSize: 9, color: 'var(--green)', marginBottom: 4, fontWeight: 700 }}>
              📹 VIDEO EN VIVO (MJPEG) — 🔌 vía relé local
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
            {mjpegStreams.map((s, i) => (
              <LanCameraFeed key={i} stream={s} fallbackUrl={snapshotFallback !== s.url ? snapshotFallback : null} />
            ))}
          </div>
        </div>
      )}
      {rtspStreams.length > 0 && (
        <div>
          {!compact && <div style={{ fontSize: 9, color: 'var(--yellow)', marginBottom: 4, fontWeight: 700 }}>🎬 RTSP (abrir en VLC):</div>}
          {rtspStreams.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, padding: '3px 6px', background: 'rgba(255,199,0,0.08)', border: '1px solid rgba(255,199,0,0.2)', borderRadius: 4 }}>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--yellow)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                🎬 {s.url}
              </span>
              <button onClick={() => navigator.clipboard?.writeText(s.url)}
                style={{ fontSize: 8, padding: '2px 6px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                📋
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Camera Result Components ────────────────────────────────────────

function LocalScanResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>
        🎥 Cámaras en {data.subnet}.0/24 — {data.total} encontradas
      </h3>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 12 }}>Hosts escaneados: {data.scanned}</div>
      {data.cameras?.length === 0 && (
        <div style={{ padding: 12, background: 'rgba(255,199,0,0.1)', borderRadius: 6, fontSize: 11 }}>
          No se encontraron cámaras. Asegúrate de estar en la misma subnet.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 12 }}>
        {data.cameras?.map((cam, i) => {
          const snapshotStream = cam.streams?.find(s => /snapshot|picture|snap/i.test(s.url))?.url || null;
          const hasMjpeg = cam.streams?.some(s => s.type === 'mjpeg');
          const blockedReason = cam.streams?.length ? lanRelayBlockReason(cam.streams[0].url) : null;
          return (
            <div key={i} style={{ background: 'var(--bg)', border: `1px solid ${cam.brand ? 'var(--green)' : 'var(--border)'}`, borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace' }}>{cam.ip}</div>
                {cam.brand && (
                  <span style={{ fontSize: 10, padding: '2px 8px', background: 'rgba(63,185,80,0.15)', color: 'var(--green)', borderRadius: 4, fontWeight: 700 }}>
                    {cam.brand}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>
                Puertos: {cam.ports?.join(', ')}
              </div>
              {cam.webInterface && (
                <a href={cam.webInterface} target="_blank" rel="noopener"
                  style={{ display: 'inline-block', fontSize: 10, color: 'var(--primary)', marginBottom: 6, fontFamily: 'monospace' }}>
                  🌐 {cam.webInterface}
                </a>
              )}
              <StreamPreview streams={cam.streams} fallbackSnapshot={snapshotStream} />
              {!hasMjpeg && cam.ports?.some(p => [80, 443, 8000, 8080, 8443].includes(p)) && (
                <div style={{ marginTop: 4, fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  ℹ️ Puerto HTTP abierto pero sin ruta de stream conocida para esta marca — prueba la URL del fabricante en «Auditoría IP» o directamente en el navegador.
                </div>
              )}
              {blockedReason && cam.streams?.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 9, color: 'var(--yellow)', fontFamily: 'monospace' }}>🚫 {blockedReason}</div>
              )}
              {!hasMjpeg && !cam.streams?.length && cam.ports?.some(p => [554, 8554].includes(p)) && (
                <div style={{ marginTop: 4, fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  ℹ️ Solo RTSP: cópialo y ábrelo en VLC.
                </div>
              )}
              {cam.credentials && (
                <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(248,81,73,0.1)', borderRadius: 4, fontSize: 10 }}>
                  <span style={{ color: 'var(--yellow)' }}>🔑</span>{' '}
                  <span style={{ fontFamily: 'monospace' }}>{cam.credentials.user}:{cam.credentials.pass || '(vacía)'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 12, padding: 8, background: 'rgba(255,139,74,0.1)', borderRadius: 6 }}>
        ⚖️ Solo usa en redes autorizadas. Las credenciales son fábricas por defecto.
      </div>
    </div>
  );
}

function AuditResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  const snapshotStream = data.streams?.find(s => /snapshot|picture|snap/i.test(s.url))?.url || null;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🛡️ Auditoría — {data.ip}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 12 }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Puertos</div>
          <div style={{ fontSize: 12, fontFamily: 'monospace' }}>{data.openPorts?.join(', ') || 'Ninguno'}</div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Marca</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: data.brand ? 'var(--green)' : 'var(--muted)' }}>{data.brand || 'Desconocida'}</div>
        </div>
        {data.webInterface && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--muted)' }}>Web</div>
            <a href={data.webInterface} target="_blank" rel="noopener" style={{ fontSize: 11, color: 'var(--primary)' }}>{data.webInterface}</a>
          </div>
        )}
        {data.rtspAccessible && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--green)', borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--green)' }}>RTSP</div>
            <div style={{ fontSize: 11, color: 'var(--green)' }}>✅ Accesible</div>
          </div>
        )}
      </div>
      {data.credentials?.length > 0 && (
        <div style={{ marginBottom: 10, padding: 8, background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>🔑 Credenciales por defecto</div>
          {data.credentials.map((c, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'monospace' }}>{c.user}:{c.pass || '(vacía)'}</div>
          ))}
        </div>
      )}
      <StreamPreview streams={data.streams} fallbackSnapshot={snapshotStream} />
      {data.vulnerabilities?.length > 0 && (
        <div style={{ marginTop: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 6 }}>🔓 Vulnerabilidades</div>
          {data.vulnerabilities.map((v, i) => (
            <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 11 }}>{v.id}</span>
                <span style={{
                  fontSize: 8, padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                  background: v.severity === 'CRITICAL' ? 'rgba(248,81,73,0.2)' : 'rgba(255,199,0,0.2)',
                  color: v.severity === 'CRITICAL' ? 'var(--red)' : 'var(--yellow)',
                }}>{v.severity}</span>
              </div>
              <div style={{ fontSize: 10 }}>{v.desc}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)' }}>{v.affected}</div>
            </div>
          ))}
        </div>
      )}
      {data.vulnerablePaths?.length > 0 && (
        <div style={{ padding: 8, background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, marginBottom: 4 }}>🚨 Paths vulnerables</div>
          {data.vulnerablePaths.map((vp, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--red)' }}>{vp.path} — HTTP {vp.status}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function CVEResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔓 CVEs — {data.brand}</h3>
      {data.total === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          Sin CVEs registrados. <a href={data.searchNvd} target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>Buscar en NVD →</a>
        </div>
      )}
      {data.cves?.map((cve, i) => (
        <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{cve.id}</span>
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 4, fontWeight: 700,
              background: cve.severity === 'CRITICAL' ? 'rgba(248,81,73,0.2)' : cve.severity === 'HIGH' ? 'rgba(255,123,114,0.2)' : 'rgba(255,199,0,0.2)',
              color: cve.severity === 'CRITICAL' ? 'var(--red)' : cve.severity === 'HIGH' ? '#ff7b72' : 'var(--yellow)',
            }}>{cve.severity}</span>
          </div>
          <div style={{ fontSize: 11, marginBottom: 2 }}>{cve.desc}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{cve.affected}</div>
        </div>
      ))}
    </div>
  );
}

function CameraDorksResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔍 {data.brand} — {data.total} dorks</h3>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontFamily: 'monospace', fontSize: 10 }}>
        {data.dorks?.map((d, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(d)}`} target="_blank" rel="noopener"
              style={{ color: 'var(--green)', textDecoration: 'none' }}>{d}</a>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(data.dorks?.join('\n'))}>📋 Copiar</button>
    </div>
  );
}

// ── Generic OSINT Components ────────────────────────────────────────

function PeopleResults({ data }) {
  if (!data) return null;
  if (data.error) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        🧑‍💻 Detectado como <b style={{ color: 'var(--primary)' }}>{data.type}</b>: {data.query}
      </div>
      {data.type === 'email' && data.email && (
        data.email.mxRecords || data.email.breachCheck || data.email.searchLinks
          ? <EmailResults data={{ ok: true, ...data.email }} />
          : <div>
            <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📧 {data.email.email}</h3>
            <div style={{ fontSize: 11, marginBottom: 4 }}>{data.email.valid ? '✅ Formato válido' : '❌ Formato inválido'}</div>
            {data.email.mx?.length > 0 && <div style={{ fontSize: 11, marginBottom: 8 }}>MX: {data.email.mx.join(', ')}</div>}
            {Array.isArray(data.email.breaches) && (
              <div style={{ padding: 6, background: data.email.breaches.length ? 'rgba(248,81,73,0.1)' : 'rgba(63,185,80,0.1)', borderRadius: 4, fontSize: 11, marginBottom: 8 }}>
                {data.email.breaches.length ? `🔴 BREACH: ${data.email.breaches.map((b) => b.name || b).join(', ')}` : '🟢 Sin breaches'}
              </div>
            )}
          </div>
      )}
      {data.type === 'phone' && data.phone && (
        data.phone.format || data.phone.searchLinks
          ? <PhoneResults data={{ ok: true, ...data.phone }} />
          : <div>
            <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📱 {data.phone.phone}</h3>
            <div style={{ fontSize: 11 }}>{data.phone.valid ? '✅ Formato válido' : '❌ Formato inválido'}</div>
            {data.phone.country && <div style={{ fontSize: 11 }}>🌍 {data.phone.country}</div>}
          </div>
      )}
      {data.type === 'username' && data.username && <UsernameResults data={{ ok: true, ...data.username }} />}
    </div>
  );
}

function UsernameResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  const mark = (p) => (p.found === true
    ? { icon: '✅', color: 'var(--green)', bg: 'rgba(63,185,80,0.1)', border: 'var(--green)' }
    : p.found === 'maybe'
      ? { icon: '❓', color: 'var(--yellow)', bg: 'rgba(255,199,0,0.08)', border: 'rgba(255,199,0,0.4)' }
      : { icon: '❌', color: 'var(--red)', bg: 'var(--bg)', border: 'var(--border)' });
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>
        👤 @{data.username} — {data.found}/{data.total}{data.maybe ? <span style={{ color: 'var(--yellow)' }}> (+{data.maybe} dudosos)</span> : ''}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
        {data.platforms?.map((p, i) => {
          const m = mark(p);
          return (
            <a key={i} href={p.url} target="_blank" rel="noopener" title={p.found === 'maybe' ? (p.note || 'Muro de login o anti-bot: no verificable') : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: m.bg, border: `1px solid ${m.border}`, borderRadius: 6, textDecoration: 'none', color: 'var(--text)', fontSize: 11 }}>
              <span style={{ color: m.color }}>{m.icon}</span>
              <span>{p.name}</span>
            </a>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 6 }}>❓ = la web responde pero con muro de login/anti-bot: existe o no, no se puede saber desde aquí.</div>
    </div>
  );
}

function EmailResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📧 {data.email}</h3>
      {data.mxRecords?.length > 0 && <div style={{ fontSize: 11, marginBottom: 8 }}>MX: {data.mxRecords.join(', ')}</div>}
      {data.breachCheck && (
        <div style={{
          padding: 6, borderRadius: 4, fontSize: 11, marginBottom: 8,
          background: data.breachCheck.breached === true ? 'rgba(248,81,73,0.1)' : data.breachCheck.breached === 'unknown' ? 'rgba(255,199,0,0.08)' : 'rgba(63,185,80,0.1)',
        }}>
          {data.breachCheck.breached === true
            ? <>🔴 BREACH{data.breachCheck.breaches?.length ? `: ${(data.breachCheck.breaches || []).join(', ')}` : ''}</>
            : data.breachCheck.breached === 'unknown'
              ? `🟡 Desconocido — ${data.breachCheck.error || 'HIBP exige API key'}`
              : '🟢 Sin breaches'}
        </div>
      )}
      {data.searchLinks?.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 11, color: 'var(--primary)', marginBottom: 3 }}>🔗 {l.engine}</a>
      ))}
    </div>
  );
}

function PhoneResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📱 {data.phone}</h3>
      {data.format?.country && <div style={{ fontSize: 11 }}>🌍 {data.format.country}</div>}
      {data.format?.carrier && <div style={{ fontSize: 11 }}>📡 {data.format.carrier}</div>}
      {data.searchLinks?.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 11, color: 'var(--primary)', marginBottom: 3 }}>🔗 {l.engine}</a>
      ))}
    </div>
  );
}

function DomainResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🌐 {data.domain}</h3>
      {data.technologies?.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {data.technologies.map((t, i) => (
            <span key={i} style={{ fontSize: 9, padding: '2px 6px', background: 'rgba(88,166,255,0.15)', color: 'var(--blue)', borderRadius: 4 }}>{t.name}: {t.value}</span>
          ))}
        </div>
      )}
      {data.searchLinks?.map((l, i) => (
        <a key={i} href={l.url || '#'} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 11, color: 'var(--primary)', marginBottom: 3 }}>🔗 {l.engine}</a>
      ))}
    </div>
  );
}

function DorksResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔍 Google Dorks — {data.target}</h3>
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10, fontFamily: 'monospace', fontSize: 10 }}>
        {data.dorks?.map((d, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <a href={`https://www.google.com/search?q=${encodeURIComponent(d)}`} target="_blank" rel="noopener" style={{ color: 'var(--green)', textDecoration: 'none' }}>{d}</a>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(data.dorks?.join('\n'))}>📋 Copiar</button>
    </div>
  );
}

function RobotsResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🤖 robots.txt — {data.domain}</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 11 }}>
        <span>🚫 {data.disallowed}</span><span>✅ {data.allowed}</span><span>🗺️ {data.sitemaps?.length || 0}</span>
      </div>
      {data.interesting?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--yellow)', marginBottom: 4 }}>⚠️ Interesantes:</div>
          {data.interesting.map((item, i) => (
            <div key={i} style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--red)' }}>🚫 {item.path}</div>
          ))}
        </div>
      )}
      <details>
        <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--muted)' }}>Raw</summary>
        <pre style={{ fontSize: 9, fontFamily: 'monospace', maxHeight: 200, overflow: 'auto', background: 'var(--bg)', padding: 6, borderRadius: 4 }}>{data.raw}</pre>
      </details>
    </div>
  );
}

function IPResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>📍 {data.ip}</h3>
      {data.geo && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
          {data.geo.country && <div style={{ fontSize: 11 }}>🌍 {data.geo.country}</div>}
          {data.geo.city && <div style={{ fontSize: 11 }}>🏙️ {data.geo.city}</div>}
          {data.geo.isp && <div style={{ fontSize: 11 }}>📡 {data.geo.isp}</div>}
          {data.geo.org && <div style={{ fontSize: 11 }}>🏢 {data.geo.org}</div>}
        </div>
      )}
    </div>
  );
}

function TraceResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  const maxMs = Math.max(1, ...data.hops.flatMap((h) => h.ms));
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🧭 Ruta → {data.target} ({data.count} saltos, {data.tool})</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.hops.map((h) => (
          <div key={h.n} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 10px' }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--muted)', minWidth: 26 }}>{h.n}</span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 120 }}>{h.ip}</span>
            <div style={{ flex: 1, height: 8, background: '#0a101d', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(100, Math.round((Math.min(...h.ms.length ? h.ms : [maxMs]) / maxMs) * 100))}%`,
                background: 'var(--primary)',
              }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--muted)' }}>{h.ms.length ? `${Math.min(...h.ms)} ms` : '* * *'}</span>
          </div>
        ))}
      </div>
      {!data.hops.length && <div style={{ fontSize: 11, color: 'var(--muted)' }}>Sin saltos (todos con * * *): el objetivo o un salto intermedio no responde a ICMP/UDP.</div>}
    </div>
  );
}

function HashResults({ data }) {
  if (!data.ok) return <div style={{ color: 'var(--red)' }}>❌ {data.error}</div>;
  return (
    <div>
      <h3 style={{ color: 'var(--primary)', fontSize: 14, marginBottom: 8 }}>🔐 Hash</h3>
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)', marginBottom: 8, wordBreak: 'break-all' }}>{data.hash}</div>
      {data.sources?.map((s, i) => (
        <a key={i} href={s.url} target="_blank" rel="noopener" style={{ display: 'block', fontSize: 11, color: 'var(--primary)', marginBottom: 3 }}>🔗 {s.name}</a>
      ))}
    </div>
  );
}
