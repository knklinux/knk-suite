import React, { useState, useEffect } from 'react';

// Indicador permanente de la ruta de SALIDA del tráfico de la suite:
// directo / Tor / proxy del sistema / proxy externo (Burp). El backend
// resuelve la prioridad real (la de lib/net.js) en /api/egress.
//
// Es CLICABLE: burp → tab Labs (donde se configura el proxy de salida),
// tor → tab Red Tor. El resto de modos no abren panel (no hay nada que
// configurar en un estado directo o un proxy que la suite no usa).
const EGRESS_COLORS = {
  direct: 'var(--green, #35d07f)',
  burp: 'var(--yellow, #ffb454)',
  tor: 'var(--violet, #b12cff)',
  system: 'var(--yellow, #ffb454)',
  unknown: 'var(--muted)',
};
const EGRESS_ICONS = { direct: '⇢', burp: '⇄', tor: '🧅', system: '⇢', unknown: '?' };
const EGRESS_TARGET = { burp: 'labs', tor: 'tor' };

function EgressIndicator({ api, go }) {
  const [egress, setEgress] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api('/egress')
      .then((r) => { if (alive && r && r.mode) setEgress(r); })
      .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [api]);

  if (!egress) {
    return <span className="badge" style={{ position: 'absolute', top: 12, right: 118, backdropFilter: 'blur(4px)', color: 'var(--muted)' }}>salida…</span>;
  }
  const color = EGRESS_COLORS[egress.mode] || EGRESS_COLORS.unknown;
  const target = EGRESS_TARGET[egress.mode];
  const tip = [
    `Ruta de salida: ${egress.label}`,
    egress.detail ? `→ ${egress.detail}` : null,
    egress.mode === 'burp' && egress.burp?.source ? `origen: ${egress.burp.source}` : null,
    egress.mode === 'tor' && egress.tor?.ip ? `exit: ${egress.tor.ip}${egress.tor.country ? ` (${String(egress.tor.country).toUpperCase()})` : ''}` : null,
    egress.note || null,
    target ? 'clic para abrir el panel' : null,
  ].filter(Boolean).join('  ·  ');

  const pillStyle = {
    position: 'absolute', top: 12, right: 118, backdropFilter: 'blur(4px)',
    borderColor: color, color, boxShadow: `0 0 10px ${color}33`,
    ...(target ? { cursor: 'pointer' } : {}),
  };

  if (target && go) {
    return (
      <button
        type="button" className="badge" title={tip} style={pillStyle}
        onClick={() => go(target)}
      >
        {EGRESS_ICONS[egress.mode] || '?'} salida: {egress.label.toLowerCase()}
      </button>
    );
  }
  return <span className="badge" title={tip} style={pillStyle}>{EGRESS_ICONS[egress.mode] || '?'} salida: {egress.label.toLowerCase()}</span>;
}

const SEVERITY_COLORS = {
  critical: 'var(--red)',
  high: '#f97316',
  medium: 'var(--yellow)',
  low: '#3b82f6',
  info: 'var(--muted)',
};

const SEVERITY_LABELS = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo', info: 'Info' };

export default function Dashboard({ api, status, health, go }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/dashboard/stats')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">Cargando dashboard...</span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">No se pudieron cargar las estadísticas</span>
      </div>
    );
  }

  const { totalSessions, totalFindings, totalReports, findingsBySeverity, recentActivity, uptimeSeconds } = stats;

  const formatUptime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  const maxSeverity = Math.max(...Object.values(findingsBySeverity), 1);

  return (
    <div>
      <div style={{
        position: 'relative', borderRadius: 12, overflow: 'hidden',
        border: '1px solid var(--border)',
        boxShadow: '0 0 32px rgba(8,216,255,0.18), 0 0 72px rgba(177,44,255,0.12)',
      }}>
        <img src="knklinux-hub.png" alt="knkLinux Security Workbench"
          style={{ width: '100%', height: 230, objectFit: 'cover', objectPosition: 'center 28%', display: 'block' }} />
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'linear-gradient(90deg, rgba(2,6,12,0.82) 0%, rgba(2,6,12,0.45) 38%, transparent 65%), linear-gradient(transparent 55%, rgba(2,6,12,0.88) 100%)',
        }} />
        <div style={{ position: 'absolute', left: 18, bottom: 40 }}>
          <span className="eyebrow">DASHBOARD</span>
          <h2 style={{ margin: '2px 0 0', textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>Métricas del workbench</h2>
        </div>
        <span className="badge badge-ok" style={{ position: 'absolute', top: 12, right: 12, backdropFilter: 'blur(4px)' }}>ACTIVO</span>
        <EgressIndicator api={api} go={go} />
      </div>

      <div className="module-grid" style={{ marginBottom: 16, marginTop: -26, position: 'relative', padding: '0 12px' }}>
        <div className="card">
          <h3>Sesiones</h3>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{totalSessions}</div>
          <span className="muted">objetivos escaneados</span>
        </div>
        <div className="card">
          <h3>Hallazgos</h3>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--violet)' }}>{totalFindings}</div>
          <span className="muted">vulnerabilidades detectadas</span>
        </div>
        <div className="card">
          <h3>Reportes</h3>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>{totalReports}</div>
          <span className="muted">informes generados</span>
        </div>
        <div className="card">
          <h3>Uptime</h3>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--yellow)' }}>{formatUptime(uptimeSeconds)}</div>
          <span className="muted">tiempo activo</span>
        </div>
      </div>

      <div className="card">
        <h3>Hallazgos por severidad</h3>
        {Object.entries(findingsBySeverity).map(([sev, count]) => (
          <div key={sev} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ width: 60, fontSize: 10, color: SEVERITY_COLORS[sev], textAlign: 'right' }}>
              {SEVERITY_LABELS[sev]}
            </span>
            <div style={{ flex: 1, height: 14, background: '#0a101d', borderRadius: 4, overflow: 'hidden', border: '1px solid #16314b' }}>
              <div style={{
                width: `${(count / maxSeverity) * 100}%`,
                height: '100%',
                background: SEVERITY_COLORS[sev],
                borderRadius: 4,
                boxShadow: `0 0 8px ${SEVERITY_COLORS[sev]}`,
                transition: 'width 0.4s ease',
                minWidth: count > 0 ? 4 : 0,
              }} />
            </div>
            <span style={{ width: 30, fontSize: 11, color: 'var(--text)', textAlign: 'right' }}>{count}</span>
          </div>
        ))}
        {Object.values(findingsBySeverity).every(v => v === 0) && (
          <span className="muted" style={{ fontSize: 11 }}>Sin hallazgos registrados</span>
        )}
      </div>

      <div className="card">
        <h3>Actividad reciente</h3>
        {recentActivity.length === 0 && <span className="muted" style={{ fontSize: 11 }}>Sin actividad reciente</span>}
        {recentActivity.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #16314b' }}>
            <span className={`badge ${a.type === 'finding' ? 'badge-err' : a.type === 'report' ? 'badge-ok' : 'badge-warn'}`} style={{ minWidth: 54, textAlign: 'center' }}>
              {a.type}
            </span>
            <span style={{ flex: 1, fontSize: 11, color: 'var(--text)' }}>{a.message}</span>
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>{a.timestamp ? new Date(a.timestamp).toLocaleDateString() : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
