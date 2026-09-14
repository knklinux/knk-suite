import React, { useState, useEffect } from 'react';

const SEVERITY_COLORS = {
  critical: 'var(--red)',
  high: '#f97316',
  medium: 'var(--yellow)',
  low: '#3b82f6',
  info: 'var(--muted)',
};
const SEVERITY_LABELS = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo', info: 'Info' };

export default function ReportExport({ api }) {
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/reports')
      .then(r => {
        const list = Array.isArray(r) ? r : r.reports || [];
        setReports(list);
        if (list.length > 0) setSelected(list[0]);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [api]);

  const loadPreview = async (report, format) => {
    if (!report) return;
    setPreviewing(true);
    setPreview('');
    try {
      const ext = format === 'md' ? 'md' : 'html';
      const r = await api(`/reports/${report.slug}/export/${ext}`);
      if (typeof r === 'string') setPreview(r);
      else if (r.text) setPreview(r.text);
      else setPreview(JSON.stringify(r, null, 2));
    } catch (e) {
      setPreview(`Error: ${e.message}`);
    }
    setPreviewing(false);
  };

  const download = (report, format) => {
    if (!report) return;
    const ext = format === 'md' ? 'md' : 'html';
    window.open(`/api/reports/${report.slug}/export/${ext}`, '_blank');
  };

  const copyPreview = () => {
    if (preview && navigator.clipboard) navigator.clipboard.writeText(preview);
    setToast('📋 Copiado al portapapeles');
  };

  const countBySeverity = (data) => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    const findings = data?.findings || [];
    findings.forEach(f => { const s = (f.severity || 'info').toLowerCase(); if (counts[s] !== undefined) counts[s]++; });
    return counts;
  };

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <span className="muted">Cargando reportes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ borderLeft: '4px solid var(--red)' }}>
        <h3>Error</h3>
        <span className="muted">{error}</span>
      </div>
    );
  }

  const sevCounts = countBySeverity(selected?.data);

  return (
    <div>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div className="module-heading">
        <div>
          <span className="eyebrow">REPORTES</span>
          <h2>Exportar reportes</h2>
          <span className="muted">Genera reportes en Markdown o HTML</span>
        </div>
      </div>

      {reports.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <span className="muted">No hay reportes disponibles</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 260, flexShrink: 0 }}>
          <div className="card">
            <h3>Reportes ({reports.length})</h3>
            {reports.map((r, i) => (
              <div
                key={i}
                onClick={() => { setSelected(r); setPreview(''); }}
                style={{
                  padding: '8px 10px', marginBottom: 4, borderRadius: 5, cursor: 'pointer',
                  background: selected?.slug === r.slug ? 'rgba(8,216,255,0.1)' : 'transparent',
                  border: `1px solid ${selected?.slug === r.slug ? 'var(--primary)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 11, color: '#fff' }}>{r.data?.title || r.slug}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                  {r.data?.bugType || 'Sin tipo'} · {r.data?.severity || 'info'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {selected && (
            <>
              <div className="card">
                <h3>{selected.data?.title || selected.slug}</h3>
                <div className="kv"><span className="k">Asset</span><span className="v">{selected.data?.asset || '—'}</span></div>
                <div className="kv"><span className="k">Tipo</span><span className="v">{selected.data?.bugType || '—'}</span></div>
                <div className="kv"><span className="k">Severidad</span><span className="v"><span className="badge badge-warn">{selected.data?.severity} ({selected.data?.cvss})</span></span></div>
                <div className="kv"><span className="k">Estado</span><span className="v"><span className="badge">{selected.status || 'borrador'}</span></span></div>

                <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(sevCounts).map(([sev, count]) => (
                    count > 0 && (
                      <span key={sev} className="badge" style={{ color: SEVERITY_COLORS[sev], border: `1px solid ${SEVERITY_COLORS[sev]}`, background: `${SEVERITY_COLORS[sev]}22` }}>
                        {count} {SEVERITY_LABELS[sev]}
                      </span>
                    )
                  ))}
                </div>
              </div>

              <div className="card">
                <h3>Exportar</h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="btn btn-sm" onClick={() => loadPreview(selected, 'md')}>
                    📄 Preview Markdown
                  </button>
                  <button className="btn btn-sm" onClick={() => loadPreview(selected, 'html')}>
                    🌐 Preview HTML
                  </button>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button className="btn btn-sm btn-outline" onClick={() => download(selected, 'md')}>
                      ⬇ Markdown
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => download(selected, 'html')}>
                      ⬇ HTML
                    </button>
                  </div>
                </div>

                {previewing && (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <span className="muted">Generando preview...</span>
                  </div>
                )}

                {preview && !previewing && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span className="muted" style={{ fontSize: 10 }}>Preview</span>
                      <button className="btn btn-sm btn-outline" onClick={copyPreview}>📋 Copiar</button>
                    </div>
                    <pre className="result-box" style={{ maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {preview}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}

          {!selected && reports.length > 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 32 }}>
              <span className="muted">Selecciona un reporte para exportar</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
