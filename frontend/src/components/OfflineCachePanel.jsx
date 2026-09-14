import React, { useState, useEffect } from 'react';

export default function OfflineCachePanel({ api }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState('');

  const loadStats = async () => {
    setLoading(true);
    try {
      const r = await api('/cache/stats');
      if (r) setStats(r);
    } catch (e) {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadStats(); }, [api]);

  const clearCache = async () => {
    if (!confirm('¿Borrar todo el caché offline?')) return;
    setClearing(true);
    try {
      const r = await api('/cache', { method: 'DELETE' });
      if (r?.ok) {
        setToast('Caché borrado');
        loadStats();
      } else {
        setToast(r?.error || 'Error al borrar caché');
      }
    } catch (e) {
      setToast('Error: ' + e.message);
    } finally {
      setClearing(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
  };

  const isOnline = stats?.online !== false;

  return (
    <div>
      <div className="module-heading">
        <div>
          <span className="eyebrow">ALMACENAMIENTO</span>
          <h2>Offline Cache</h2>
        </div>
        <span className={`badge ${isOnline ? 'badge-ok' : 'badge-warn'}`}>
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <span className="muted">Cargando estadísticas...</span>
        </div>
      ) : !stats ? (
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <span className="muted">No se pudieron cargar las estadísticas</span>
        </div>
      ) : (
        <>
          <div className="module-grid" style={{ marginBottom: 12 }}>
            <div className="card">
              <h3>Entradas totales</h3>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>
                {stats.totalEntries ?? stats.entries ?? 0}
              </div>
              <span className="muted">registros en caché</span>
            </div>
            <div className="card">
              <h3>Tamaño total</h3>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--violet)' }}>
                {formatBytes(stats.totalSize ?? stats.size ?? 0)}
              </div>
              <span className="muted">espacio utilizado</span>
            </div>
            <div className="card">
              <h3>Estado</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <div className={`st-dot ${isOnline ? 'on' : 'off'}`} />
                <span style={{ fontSize: 28, fontWeight: 700, color: isOnline ? 'var(--green)' : 'var(--red)' }}>
                  {isOnline ? 'Activo' : 'Inactivo'}
                </span>
              </div>
              <span className="muted">{isOnline ? 'conexión disponible' : 'modo sin conexión'}</span>
            </div>
          </div>

          <div className="card">
            <h3>Detalles del caché</h3>
            {stats.lastUpdated && (
              <div className="kv">
                <span className="k">Última actualización</span>
                <span className="v">{new Date(stats.lastUpdated).toLocaleString()}</span>
              </div>
            )}
            {stats.expiry && (
              <div className="kv">
                <span className="k">Expiración</span>
                <span className="v">{stats.expiry}</span>
              </div>
            )}
            {stats.maxEntries && (
              <div className="kv">
                <span className="k">Máximo entradas</span>
                <span className="v">{stats.maxEntries}</span>
              </div>
            )}
            {stats.maxSize && (
              <div className="kv">
                <span className="k">Tamaño máximo</span>
                <span className="v">{formatBytes(stats.maxSize)}</span>
              </div>
            )}
          </div>

          <button className="btn btn-sm btn-outline" onClick={clearCache} disabled={clearing}>
            {clearing ? 'Borrando...' : 'Borrar caché'}
          </button>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
