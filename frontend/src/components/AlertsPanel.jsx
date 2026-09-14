import React, { useState, useEffect, useRef, useCallback } from 'react';

const SEVERITY_COLORS = {
  critical: 'var(--red)',
  high: '#f97316',
  medium: 'var(--yellow)',
  low: '#3b82f6',
  info: 'var(--muted)',
};
const SEVERITY_LABELS = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo', info: 'Info' };

const TYPE_ICONS = {
  finding: '🔓',
  scan: '🔍',
  alert: '⚠️',
  error: '❌',
  info: 'ℹ️',
  success: '✅',
  system: '⚙️',
};

export default function AlertsPanel({ api }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 4000);
  }, []);

  const connectWs = useCallback(() => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws/alerts`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setReconnectAttempts(0);
        showToast('🔌 Conectado al stream de alertas');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const alert = {
            id: Date.now() + Math.random(),
            type: data.type || 'info',
            severity: data.severity || 'info',
            title: data.title || data.message || 'Alerta',
            message: data.message || data.detail || '',
            timestamp: data.timestamp || new Date().toISOString(),
            source: data.source || 'system',
          };
          setAlerts(prev => [alert, ...prev].slice(0, 200));
          showToast(`🔔 ${alert.title}`);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectTimer.current = setTimeout(() => {
          setReconnectAttempts(prev => prev + 1);
          connectWs();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch (e) {
      console.error('WS connect error:', e);
    }
  }, [reconnectAttempts, showToast]);

  useEffect(() => {
    api('/alerts')
      .then(r => {
        const list = Array.isArray(r) ? r : r.alerts || r.history || [];
        setAlerts(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    connectWs();

    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [api, connectWs]);

  const clearHistory = async () => {
    try {
      await api('/alerts', { method: 'DELETE' });
      setAlerts([]);
      setToast('🗑️ Historial limpiado');
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Ahora';
    if (diffMin < 60) return `Hace ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH}h`;
    return d.toLocaleDateString();
  };

  const severityCounts = alerts.reduce((acc, a) => {
    const sev = a.severity || 'info';
    acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">Cargando alertas...</span>
      </div>
    );
  }

  return (
    <div>
      {toastVisible && <div className="toast" onClick={() => setToastVisible(false)}>{toast}</div>}

      <div className="module-heading">
        <div>
          <span className="eyebrow">ALERTAS</span>
          <h2>Centro de notificaciones</h2>
          <span className="muted">Alertas en tiempo real y historial</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className={`badge ${wsConnected ? 'badge-ok' : 'badge-err'}`}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: wsConnected ? 'var(--green)' : 'var(--red)', marginRight: 6, boxShadow: `0 0 6px ${wsConnected ? 'var(--green)' : 'var(--red)'}` }} />
            {wsConnected ? 'Conectado' : 'Desconectado'}
          </span>
          {alerts.length > 0 && (
            <button className="btn btn-sm btn-outline" onClick={clearHistory}>🗑️ Limpiar</button>
          )}
        </div>
      </div>

      <div className="module-grid" style={{ marginBottom: 12 }}>
        {Object.entries(SEVERITY_LABELS).map(([sev, label]) => (
          <div key={sev} className="card" style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: SEVERITY_COLORS[sev] }}>{label}</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: SEVERITY_COLORS[sev] }}>
                {severityCounts[sev] || 0}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Historial de alertas ({alerts.length})</h3>

        {alerts.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔔</div>
            <span className="muted">Sin alertas registradas</span>
            <div style={{ fontSize: 10, color: 'var(--primary)', marginTop: 8 }}>
              {wsConnected ? 'Escuchando nuevas alertas...' : 'Conectando al stream...'}
            </div>
          </div>
        )}

        {alerts.map((alert, i) => {
          const icon = TYPE_ICONS[alert.type] || TYPE_ICONS.info;
          const sevColor = SEVERITY_COLORS[alert.severity] || 'var(--muted)';
          return (
            <div key={alert.id || i} style={{
              display: 'flex', gap: 12, padding: '12px 0',
              borderBottom: i < alerts.length - 1 ? '1px solid #16314b' : 'none',
              transition: 'background 0.2s',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                display: 'grid', placeItems: 'center', fontSize: 16,
                background: `${sevColor}18`, border: `1px solid ${sevColor}44`,
              }}>
                {icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{alert.title}</span>
                  <span className="badge" style={{
                    fontSize: 8, color: sevColor,
                    background: `${sevColor}22`, border: `1px solid ${sevColor}44`,
                  }}>
                    {SEVERITY_LABELS[alert.severity] || alert.severity}
                  </span>
                </div>
                {alert.message && (
                  <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 4 }}>
                    {alert.message}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 9, color: 'var(--muted)' }}>
                  <span>{formatTime(alert.timestamp)}</span>
                  {alert.source && <span>· {alert.source}</span>}
                  <span style={{ marginLeft: 'auto' }}>
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
