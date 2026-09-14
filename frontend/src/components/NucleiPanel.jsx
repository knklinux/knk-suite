import React, { useState, useEffect } from 'react';

const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low', 'info'];
const SEVERITY_COLORS = {
  critical: 'var(--red)',
  high: '#f97316',
  medium: 'var(--yellow)',
  low: '#3b82f6',
  info: 'var(--muted)',
};
const SEVERITY_LABELS = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo', info: 'Info' };

export default function NucleiPanel({ api }) {
  const [status, setStatus] = useState(null);
  const [target, setTarget] = useState('');
  const [severityFilter, setSeverityFilter] = useState({ critical: true, high: true, medium: true, low: false, info: false });
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/nuclei/status')
      .then(r => setStatus(r))
      .catch(e => setError(e.message))
      .finally(() => setLoadingStatus(false));
  }, [api]);

  const loadTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const r = await api('/nuclei/templates');
      setTemplates(Array.isArray(r) ? r : r.templates || []);
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
    setLoadingTemplates(false);
  };

  const updateTemplates = async () => {
    setUpdating(true);
    try {
      const r = await api('/nuclei/templates', { method: 'POST' });
      if (r.ok !== false) {
        setToast('✅ Templates actualizados');
        await loadTemplates();
      } else {
        setToast(`❌ ${r.error || 'Error actualizando'}`);
      }
    } catch (e) {
      setToast(`❌ ${e.message}`);
    }
    setUpdating(false);
  };

  const startScan = async () => {
    if (!target.trim()) return;
    setScanning(true);
    setResults(null);
    setError('');
    const severities = SEVERITY_LEVELS.filter(s => severityFilter[s]);
    try {
      const r = await api('/nuclei/scan', {
        method: 'POST',
        body: JSON.stringify({ target: target.trim(), severities }),
      });
      if (r.ok !== false) {
        setResults(r);
      } else {
        setError(r.error || 'Error en el scan');
      }
    } catch (e) {
      setError(e.message);
    }
    setScanning(false);
  };

  const toggleSeverity = (sev) => {
    setSeverityFilter(prev => ({ ...prev, [sev]: !prev[sev] }));
  };

  if (loadingStatus) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">Verificando Nuclei...</span>
      </div>
    );
  }

  return (
    <div>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div className="module-heading">
        <div>
          <span className="eyebrow">VULNERABILITY SCANNER</span>
          <h2>Nuclei Scanner</h2>
          <span className="muted">Escanea objetivos con templates de vulnerabilidades</span>
        </div>
        <span className={`badge ${status?.installed ? 'badge-ok' : 'badge-err'}`}>
          {status?.installed ? 'Nuclei Disponible' : 'Nuclei No Instalado'}
        </span>
      </div>

      {status && (
        <div className="card">
          <h3>Estado</h3>
          <div className="kv"><span className="k">Instalado</span><span className="v">{status.installed ? '✅ Sí' : '❌ No'}</span></div>
          {status.version && <div className="kv"><span className="k">Versión</span><span className="v">{status.version}</span></div>}
          {status.templateCount !== undefined && <div className="kv"><span className="k">Templates</span><span className="v">{status.templateCount}</span></div>}
        </div>
      )}

      <div className="card">
        <h3>Configurar scan</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            placeholder="Target (ej: https://example.com o 192.168.1.0/24)"
            style={{ flex: 1 }}
            onKeyDown={e => e.key === 'Enter' && startScan()}
          />
          <button className="btn btn-sm" onClick={startScan} disabled={scanning || !target.trim()}>
            {scanning ? '⏳ Escaneando...' : '🔍 Escanear'}
          </button>
        </div>

        <div style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 10, marginRight: 10 }}>Severidad:</span>
          {SEVERITY_LEVELS.map(sev => (
            <label key={sev} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 10, cursor: 'pointer', fontSize: 11 }}>
              <input
                type="checkbox"
                checked={severityFilter[sev]}
                onChange={() => toggleSeverity(sev)}
                style={{ width: 'auto' }}
              />
              <span style={{ color: SEVERITY_COLORS[sev] }}>{SEVERITY_LABELS[sev]}</span>
            </label>
          ))}
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
          <h3>Error</h3>
          <span className="muted">{error}</span>
        </div>
      )}

      {results && (
        <div className="card">
          <h3>Resultados del scan</h3>
          {results.findings?.length > 0 ? (
            <div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
                {results.findings.length} hallazgos encontrados
              </div>
              {results.findings.map((finding, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid #16314b' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--primary)' }}>{finding.templateId || finding.id}</span>
                    <span className="badge" style={{
                      color: SEVERITY_COLORS[finding.severity] || 'var(--muted)',
                      background: `${SEVERITY_COLORS[finding.severity] || 'var(--muted)'}22`,
                      border: `1px solid ${SEVERITY_COLORS[finding.severity] || 'var(--muted)'}44`,
                    }}>
                      {SEVERITY_LABELS[finding.severity] || finding.severity}
                    </span>
                  </div>
                  {finding.name && <div style={{ fontSize: 11, color: '#fff', marginBottom: 2 }}>{finding.name}</div>}
                  {finding.description && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{finding.description}</div>}
                  {finding.matchedAt && <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--green)', marginTop: 4 }}>{finding.matchedAt}</div>}
                  {finding.tags && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {finding.tags.split(',').map((tag, j) => (
                        <span key={j} className="badge" style={{ fontSize: 8, color: 'var(--primary)' }}>{tag.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <span className="muted">Sin hallazgos</span>
            </div>
          )}
          {results.stats && (
            <div style={{ display: 'flex', gap: 12, marginTop: 12, paddingTop: 8, borderTop: '1px solid #16314b', fontSize: 10, color: 'var(--muted)' }}>
              {results.stats.templates && <span>Templates: {results.stats.templates}</span>}
              {results.stats.requests && <span>Requests: {results.stats.requests}</span>}
              {results.stats.duration && <span>Duración: {results.stats.duration}</span>}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Templates</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-sm btn-outline" onClick={loadTemplates} disabled={loadingTemplates}>
              {loadingTemplates ? '⏳ Cargando...' : '📋 Cargar lista'}
            </button>
            <button className="btn btn-sm" onClick={updateTemplates} disabled={updating}>
              {updating ? '⏳ Actualizando...' : '🔄 Actualizar templates'}
            </button>
          </div>
        </div>
        {templates.length > 0 && (
          <div style={{ maxHeight: 240, overflow: 'auto' }}>
            {templates.map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #16314b', fontSize: 11 }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--primary)', minWidth: 200 }}>{t.id || t.name}</span>
                {t.severity && (
                  <span className="badge" style={{
                    fontSize: 8,
                    color: SEVERITY_COLORS[t.severity] || 'var(--muted)',
                    background: `${SEVERITY_COLORS[t.severity] || 'var(--muted)'}22`,
                  }}>
                    {t.severity}
                  </span>
                )}
                <span className="muted" style={{ fontSize: 9 }}>{t.tags || ''}</span>
              </div>
            ))}
          </div>
        )}
        {templates.length === 0 && !loadingTemplates && (
          <span className="muted" style={{ fontSize: 11 }}>Haz clic en "Cargar lista" para ver los templates disponibles</span>
        )}
      </div>
    </div>
  );
}
