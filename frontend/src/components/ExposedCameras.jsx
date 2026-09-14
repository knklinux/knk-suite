import React, { useEffect, useMemo, useState } from 'react';

// ============================================================================
// ExposedCameras.jsx — «Cámaras Expuestas» (índices públicos)
//
// Filtros que se traducen a consultas concretas por buscador (Shodan, FOFA,
// ZoomEye, Netlas, Censys, GreyNoise) + análisis de una lista de objetivos con
// Shodan InternetDB, que devuelve metadatos de un escaneo ya hecho.
//
// Servicio y puerto son filtros distintos a propósito:
//   · servicio → acota la CONSULTA que se pega en el buscador;
//   · puerto   → filtra TUS objetivos analizados.
// El módulo NO contacta con los objetivos: no abre streams, no prueba
// credenciales y no explota nada.
//
// Los objetivos analizados se pueden convertir en HALLAZGOS de la misión con su
// evidencia. La severidad y el descarte los decide el servidor (no este
// componente): aquí solo se manda lo que el usuario vio y se pinta el plan.
// ============================================================================

const SCORE_BANDS = [
  { min: 80, color: 'var(--red)', label: 'muy probable' },
  { min: 55, color: 'var(--yellow)', label: 'probable' },
  { min: 40, color: 'var(--primary)', label: 'posible' },
  { min: 0, color: 'var(--muted)', label: 'dudoso' },
];

const SEVERITY_COLORS = {
  critical: 'var(--red)', high: 'var(--red)', medium: 'var(--yellow)',
  low: 'var(--primary)', info: 'var(--muted)',
};

function band(score) {
  return SCORE_BANDS.find((b) => score >= b.min) || SCORE_BANDS.at(-1);
}

const EMPTY_FILTERS = {
  targets: '',
  q: '',
  country: 'all',
  service: 'all',
  brand: 'all',
  preset: 'all',
  port: '',
  hasScreenshot: false,
  vulnsOnly: false,
  minScore: 0,
  sort: 'score',
  limit: 50,
};

const EMPTY_SAVE_OPTS = { severityFloor: '', includeInfo: false, onlyVulns: false, minScore: 20 };

function Copy({ text, label = '📋', title = 'Copiar' }) {
  const [done, setDone] = useState(false);
  return (
    <button title={title} onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }, () => {});
    }} style={{
      fontSize: 9, padding: '2px 6px', background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: 4, cursor: 'pointer', color: done ? 'var(--green)' : 'var(--muted)', whiteSpace: 'nowrap',
    }}>{done ? '✓ copiado' : label}</button>
  );
}

const SELECT_STYLE = {
  padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 11, fontFamily: 'monospace',
};

const CHIP_STYLE = (active, color = 'var(--primary)') => ({
  padding: '4px 9px', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer', borderRadius: 6,
  background: active ? 'rgba(8,216,255,0.14)' : 'var(--panel)',
  border: `1px solid ${active ? color : 'var(--border)'}`,
  color: active ? color : 'var(--muted)',
});

export default function ExposedCameras({ api }) {
  const [options, setOptions] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [openTarget, setOpenTarget] = useState(null);

  // selección + conversión a hallazgos de la misión
  const [selected, setSelected] = useState(new Set());
  const [saveOpts, setSaveOpts] = useState(EMPTY_SAVE_OPTS);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [registered, setRegistered] = useState({});

  useEffect(() => {
    api('/cameras/exposed/options')
      .then((r) => { if (r.ok) setOptions(r); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshFindings = () => {
    api('/findings')
      .then((r) => {
        const list = Array.isArray(r) ? r : [];
        const map = {};
        list.forEach((f) => {
          const asset = f?.details?.asset || f?.details?.ip;
          if (asset && !map[asset]) map[asset] = f;
        });
        setRegistered(map);
      })
      .catch(() => {});
  };

  useEffect(() => { refreshFindings(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const set = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  const run = async () => {
    setLoading(true);
    setError('');
    setSaveResult(null);
    setPreview(null);
    try {
      const r = await api('/cameras/exposed/search', {
        method: 'POST',
        body: JSON.stringify(filters),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!r.ok) { setError(r.error || 'búsqueda no disponible'); setResult(null); return; }
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const services = options?.services || [];
  const brands = options?.brands || [];
  const countries = options?.countries || [];
  const presets = options?.presets || [];
  const sorts = options?.sorts || [];
  const limits = options?.limits || [25, 50, 100, 200];
  const cameraPorts = options?.cameraPorts || [];

  const activePreset = presets.find((p) => p.id === filters.preset) || null;
  const activeService = services.find((s) => s.id === filters.service) || null;

  const targets = result?.targets || [];
  const summary = result?.summary;
  const notes = result?.notes || [];
  const allDorks = useMemo(() => (result?.queryPlan?.dorks || []).map((d) => d.dork).join('\n'), [result]);

  // Lo que se va a registrar: los que parecen cámara o traen CVEs, marcados por
  // defecto (nunca los «dudosos» sin señal).
  const selectedTargets = useMemo(() => targets.filter((t) => selected.has(t.ip)), [targets, selected]);

  useEffect(() => {
    const list = result?.targets || [];
    setSelected(new Set(list.filter((t) => t.isLikelyCamera || t.vulns.length > 0).map((t) => t.ip)));
  }, [result]);

  // El plan lo calcula el servidor (misma deduplicación y severidad que al
  // guardar), así que la previsualización no puede mentir.
  useEffect(() => {
    if (!selectedTargets.length) { setPreview(null); return; }
    const timer = setTimeout(() => {
      api('/cameras/exposed/findings/preview', {
        method: 'POST',
        body: JSON.stringify({ targets: selectedTargets, ...saveOpts }),
        headers: { 'Content-Type': 'application/json' },
      }).then((r) => setPreview(r.ok ? r : null)).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [selectedTargets, saveOpts, api, registered]);

  const toggle = (ip) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(ip)) next.delete(ip); else next.add(ip);
    return next;
  });

  const selectAll = () => setSelected(new Set(targets.map((t) => t.ip)));
  const selectNone = () => setSelected(new Set());

  const convert = async () => {
    if (!selectedTargets.length) return;
    setSaving(true);
    setSaveError('');
    try {
      const r = await api('/cameras/exposed/findings', {
        method: 'POST',
        body: JSON.stringify({ targets: selectedTargets, ...saveOpts }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!r.ok) { setSaveError(r.error || 'no se pudieron registrar los hallazgos'); setSaveResult(null); return; }
      setSaveResult(r);
      refreshFindings();
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const openReport = (format) => {
    const sessionId = saveResult?.sessionId;
    const url = sessionId ? `/api/reports/${sessionId}/export/${format}` : `/api/reports/latest/export/${format}`;
    window.open(url, '_blank');
  };

  const downloadFindings = (format) => window.open(`/api/findings/export/${format}`, '_blank');

  const removeFinding = async (id) => {
    const r = await api(`/findings/${id}`, { method: 'DELETE' }).catch(() => null);
    if (r?.ok) { refreshFindings(); if (saveResult) setSaveResult({ ...saveResult, removed: [...(saveResult.removed || []), id] }); }
  };

  const selectedBySeverity = preview?.bySeverity || {};

  return (
    <div style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>🛰️</span>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: '#fff', fontFamily: "'Courier New', monospace" }}>CÁMARAS EXPUESTAS</h3>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            Índices públicos + InternetDB · metadatos, sin tocar los objetivos · los candidatos se registran como hallazgos con evidencia
          </div>
        </div>
      </div>

      {/* ── filtros ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={filters.targets} onChange={(e) => set({ targets: e.target.value })}
            placeholder="Tus objetivos: 1.2.3.4, 5.6.7.8 o 93.184.216.0/24 (máx. 32)"
            onKeyDown={(e) => e.key === 'Enter' && run()}
            style={{ flex: 1, minWidth: 260, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11, fontFamily: 'monospace' }} />
          <button className="btn btn-sm" onClick={run} disabled={loading}>
            {loading ? '⏳ Analizando…' : '🔍 Analizar'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <select value={filters.country} onChange={(e) => set({ country: e.target.value })} style={SELECT_STYLE} title="País de la búsqueda">
            <option value="all">🌍 Todos los países</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
          </select>
          <select value={filters.service} onChange={(e) => set({ service: e.target.value })} style={SELECT_STYLE} title="Acota la consulta al buscador">
            <option value="all">🧩 Todos los servicios</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={filters.brand} onChange={(e) => set({ brand: e.target.value })} style={SELECT_STYLE} title="Marca">
            <option value="all">🏷️ Todas las marcas</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <select value={filters.port} onChange={(e) => set({ port: e.target.value })} style={SELECT_STYLE} title="Filtra tus objetivos por puerto abierto">
            <option value="">🔌 cualquier puerto</option>
            {cameraPorts.map((p) => <option key={p} value={p}>puerto {p}</option>)}
          </select>
          <input value={filters.q} onChange={(e) => set({ q: e.target.value })}
            placeholder="palabra clave (org, ciudad, cabecera…)"
            onKeyDown={(e) => e.key === 'Enter' && run()}
            style={{ minWidth: 190, padding: '6px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>presets:</span>
          <button style={CHIP_STYLE(filters.preset === 'all')} onClick={() => set({ preset: 'all' })}>ninguno</button>
          {presets.map((p) => (
            <button key={p.id} style={CHIP_STYLE(filters.preset === p.id, 'var(--green)')}
              title={p.hint} onClick={() => set({ preset: filters.preset === p.id ? 'all' : p.id })}>
              {p.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <button style={CHIP_STYLE(filters.hasScreenshot)} onClick={() => set({ hasScreenshot: !filters.hasScreenshot })}
            title="Filtra en el buscador los hosts con captura guardada">📸 con captura disponible</button>
          <button style={CHIP_STYLE(filters.vulnsOnly, 'var(--red)')} onClick={() => set({ vulnsOnly: !filters.vulnsOnly })}
            title="Solo hosts con CVEs asociados en el índice">🔓 solo con CVEs</button>
          <span style={{ width: 1, height: 18, background: 'var(--border)' }} />
          <select value={filters.minScore} onChange={(e) => set({ minScore: Number(e.target.value) })} style={SELECT_STYLE} title="Puntuación mínima de «parece una cámara»">
            {[0, 20, 40, 55, 80].map((s) => <option key={s} value={s}>puntuación ≥ {s}</option>)}
          </select>
          <select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} style={SELECT_STYLE}>
            {sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={filters.limit} onChange={(e) => set({ limit: Number(e.target.value) })} style={SELECT_STYLE}>
            {limits.map((l) => <option key={l} value={l}>mostrar {l}</option>)}
          </select>
          <button className="btn btn-sm btn-outline" onClick={() => setFilters(EMPTY_FILTERS)}>✕ limpiar filtros</button>
        </div>

        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {activePreset && (
            <div style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'monospace' }}>
              preset «{activePreset.label}» — {activePreset.hint}
            </div>
          )}
          {activeService && (
            <div style={{ fontSize: 10, color: 'var(--primary)', fontFamily: 'monospace' }}>
              servicio «{activeService.label}» acota la consulta al buscador
              {filters.port ? ` · el puerto ${filters.port} filtra además tus objetivos` : ' (tus objetivos se listan completos)'}
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            Los filtros se traducen a la sintaxis de cada buscador y salen en el plan de consultas. InternetDB
            analiza como mucho 32 objetivos por tanda y nunca consulta redes privadas.
          </div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(255,199,0,0.4)', background: 'rgba(255,199,0,0.08)' }}>
          <div style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 700 }}>⚠️ {error}</div>
        </div>
      )}

      {summary && (
        <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {[
            ['objetivos pedidos', summary.requested, 'var(--text)'],
            ['analizados', summary.analyzed, 'var(--primary)'],
            ['cámaras probables', summary.likelyCameras, 'var(--red)'],
            ['con CVEs', summary.withVulns, 'var(--yellow)'],
            ['mostrados', `${summary.shown}/${summary.analyzed}`, 'var(--green)'],
            ['filtrados fuera', summary.filteredOut, 'var(--muted)'],
            ['sin datos', summary.failed, 'var(--muted)'],
            ['ya en la misión', Object.keys(registered).filter((ip) => targets.some((t) => t.ip === ip)).length, 'var(--primary)'],
          ].map(([label, value, color]) => (
            <div key={label}>
              <div style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>{label}</div>
            </div>
          ))}
          {summary.byPort && Object.keys(summary.byPort).length > 0 && (
            <div style={{ flexBasis: '100%', fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
              puertos de cámara vistos: {Object.entries(summary.byPort).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}×${n}`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {result?.queryPlan && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, marginBottom: 8, fontFamily: 'monospace' }}>
            PLAN DE CONSULTAS — filtros ya traducidos
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
            {result.queryPlan.platforms.map((p) => (
              <div key={p.platform} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{p.platform}</span>
                  <span style={{ display: 'flex', gap: 4 }}>
                    <Copy text={p.syntax} label="📋 consulta" title="Copiar la consulta" />
                    <a href={p.url} target="_blank" rel="noopener" className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px', textDecoration: 'none' }}>↗ abrir</a>
                  </span>
                </div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--green)', wordBreak: 'break-all' }}>{p.syntax}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>{p.note}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--primary)', fontFamily: 'monospace' }}>DORKS ({result.queryPlan.dorks.length})</span>
            <Copy text={allDorks} label="📋 copiar todas" />
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, maxHeight: 150, overflow: 'auto' }}>
            {result.queryPlan.dorks.map((d) => (
              <div key={d.dork} style={{ fontSize: 9, fontFamily: 'monospace', marginBottom: 2 }}>
                <a href={d.url} target="_blank" rel="noopener" style={{ color: 'var(--green)', textDecoration: 'none' }}>{d.dork}</a>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>
            {result.queryPlan.cli.map((c) => (
              <div key={c.command} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 6px', borderLeft: '2px solid var(--border)', marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--primary)', fontFamily: 'monospace', minWidth: 76 }}>{c.tool}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ fontSize: 10 }}>{c.label}</span>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)', wordBreak: 'break-all' }}>{c.command}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{c.note}</div>
                </span>
                <Copy text={c.command} />
              </div>
            ))}
          </div>
        </div>
      )}

      {targets.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          {/* ── barra de selección y conversión ─────────────────── */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, fontFamily: 'monospace' }}>
              OBJETIVOS ({targets.length})
            </span>
            <button className="btn btn-sm btn-outline" onClick={selectAll} style={{ fontSize: 9, padding: '2px 6px' }}>✔ todos</button>
            <button className="btn btn-sm btn-outline" onClick={selectNone} style={{ fontSize: 9, padding: '2px 6px' }}>✕ ninguno</button>
            <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
              {selected.size} seleccionado(s)
            </span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
              <select value={saveOpts.severityFloor} onChange={(e) => setSaveOpts({ ...saveOpts, severityFloor: e.target.value })}
                style={SELECT_STYLE} title="Severidad mínima con la que se registran los hallazgos">
                <option value="">severidad automática</option>
                <option value="low">severidad ≥ low</option>
                <option value="medium">severidad ≥ medium</option>
                <option value="high">severidad ≥ high</option>
              </select>
              <button style={CHIP_STYLE(saveOpts.includeInfo)} onClick={() => setSaveOpts({ ...saveOpts, includeInfo: !saveOpts.includeInfo })}
                title="Registrar también los objetivos sin señales suficientes (nivel info)">ℹ️ incluir dudosos</button>
              <button style={CHIP_STYLE(saveOpts.onlyVulns, 'var(--red)')} onClick={() => setSaveOpts({ ...saveOpts, onlyVulns: !saveOpts.onlyVulns })}
                title="Registrar solo los que traen CVEs en el índice">🔓 solo con CVEs</button>
              <button className="btn btn-sm" onClick={convert} disabled={saving || !selectedTargets.length}>
                {saving ? '⏳ Registrando…' : `➕ Convertir en hallazgos${preview?.wouldCreate ? ` (${preview.wouldCreate.length})` : ''}`}
              </button>
            </span>
          </div>

          {preview && (preview.wouldCreate.length > 0 || preview.duplicates.length > 0 || (preview.filtered.length + preview.invalid.length) > 0) && (
            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 8 }}>
              se crearían <b style={{ color: 'var(--green)' }}>{preview.wouldCreate.length}</b>
              {Object.entries(selectedBySeverity).map(([sev, n]) => (
                <span key={sev} style={{ color: SEVERITY_COLORS[sev] }}> · {n} {sev}</span>
              ))}
              {preview.duplicates.length > 0 && <span> · {preview.duplicates.length} ya en la misión</span>}
              {(preview.filtered.length + preview.invalid.length) > 0 && <span> · {preview.filtered.length + preview.invalid.length} descartados</span>}
              <span> · evidencia en ~/.knk-suite/evidencia</span>
            </div>
          )}

          {targets.map((t) => {
            const info = band(t.score);
            const open = openTarget === t.ip;
            const already = registered[t.ip];
            const checked = selected.has(t.ip);
            return (
              <div key={t.ip} style={{ background: 'var(--bg)', border: `1px solid ${t.isLikelyCamera ? info.color : 'var(--border)'}`, borderRadius: 6, padding: 8, marginBottom: 6, opacity: already ? 0.75 : 1 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(t.ip)} disabled={!!already}
                    title={already ? `Ya registrado como hallazgo #${already.id}` : 'Seleccionar para convertir en hallazgo'} />
                  <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{t.ip}</span>
                  <span title={t.reasons.join('\n')} style={{
                    fontSize: 9, fontFamily: 'monospace', padding: '1px 6px', borderRadius: 3,
                    background: 'rgba(255,255,255,0.05)', color: info.color,
                  }}>{t.score} · {info.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                    puertos: {t.ports.length ? t.ports.join(', ') : '—'}
                  </span>
                  {t.vulns.length > 0 && (
                    <span style={{ fontSize: 9, color: 'var(--red)', fontFamily: 'monospace' }}>🔓 {t.vulns.length} CVE</span>
                  )}
                  {already && (
                    <span style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'monospace' }} title={already.summary}>
                      ✅ hallazgo #{already.id} ({already.severity})
                    </span>
                  )}
                  <span style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                    <Copy text={t.ip} title="Copiar IP" />
                    {already && <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px' }} title="Quitar el hallazgo y borrar su evidencia" onClick={() => removeFinding(already.id)}>🗑 quitar</button>}
                    <a href={t.internetDb} target="_blank" rel="noopener" className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px', textDecoration: 'none' }}>InternetDB</a>
                    <a href={t.shodan} target="_blank" rel="noopener" className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px', textDecoration: 'none' }}>Shodan</a>
                    <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px' }}
                      onClick={() => setOpenTarget(open ? null : t.ip)}>{open ? '▲ menos' : '▼ por qué'}</button>
                  </span>
                </div>

                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 6 }}>
                  <div style={{ width: `${t.score}%`, height: '100%', background: info.color, borderRadius: 2 }} />
                </div>

                {open && (
                  <div style={{ marginTop: 8, fontSize: 10 }}>
                    {t.reasons.length === 0 && <div style={{ color: 'var(--muted)' }}>sin señales de cámara en el índice</div>}
                    <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)' }}>
                      {t.reasons.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                    {t.hostnames.length > 0 && (
                      <div style={{ fontFamily: 'monospace', color: 'var(--primary)', marginTop: 4 }}>
                        hostnames: {t.hostnames.join(', ')}
                      </div>
                    )}
                    {t.cpes.length > 0 && (
                      <div style={{ fontFamily: 'monospace', color: 'var(--muted)', marginTop: 2, wordBreak: 'break-all' }}>
                        cpes: {t.cpes.join(', ')}
                      </div>
                    )}
                    {t.tags.length > 0 && (
                      <div style={{ fontFamily: 'monospace', color: 'var(--muted)', marginTop: 2 }}>tags: {t.tags.join(', ')}</div>
                    )}
                    {t.vulns.length > 0 && (
                      <div style={{ fontFamily: 'monospace', color: 'var(--red)', marginTop: 2 }}>CVEs: {t.vulns.join(', ')}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {saveError && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(255,80,80,0.4)', background: 'rgba(255,80,80,0.08)' }}>
          <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>⚠️ {saveError}</div>
        </div>
      )}

      {saveResult && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(0,255,136,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700, fontFamily: 'monospace' }}>
              ✅ {saveResult.summary.created} hallazgo(s) registrado(s)
            </span>
            {saveResult.summary.duplicates > 0 && <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>· {saveResult.summary.duplicates} ya estaban</span>}
            {saveResult.summary.withVulns > 0 && <span style={{ fontSize: 10, color: 'var(--yellow)', fontFamily: 'monospace' }}>· {saveResult.summary.withVulns} con CVEs</span>}
            <span style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline" onClick={() => openReport('md')}>⬇ informe MD</button>
              <button className="btn btn-sm btn-outline" onClick={() => openReport('html')}>⬇ informe HTML</button>
              <button className="btn btn-sm btn-outline" onClick={() => downloadFindings('json')}>⬇ findings.json</button>
              <button className="btn btn-sm btn-outline" onClick={() => downloadFindings('csv')}>⬇ findings.csv</button>
            </span>
          </div>

          <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 6 }}>
            {saveResult.note}
          </div>

          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {saveResult.created.map((c) => (
              <div key={`${c.id}-${c.ip}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: SEVERITY_COLORS[c.severity], fontFamily: 'monospace', minWidth: 54 }}>{c.severity}</span>
                <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}>{c.ip}</span>
                <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>#{c.id} · puntuación {c.score}</span>
                {c.cves.length > 0 && <span style={{ fontSize: 9, color: 'var(--red)', fontFamily: 'monospace' }}>{c.cves.join(' ')}</span>}
                {c.evidence && (
                  <span style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
                    <span style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'monospace' }} title={c.evidence}>📄 evidencia</span>
                    <Copy text={c.evidence} label="ruta" title="Copiar la ruta de la evidencia" />
                    <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px' }} title="Quitar este hallazgo y su evidencia" onClick={() => removeFinding(c.id)}>🗑</button>
                  </span>
                )}
              </div>
            ))}
          </div>

          {(saveResult.duplicates.length > 0 || saveResult.filtered.length > 0 || saveResult.invalid.length > 0) && (
            <details style={{ marginTop: 8, fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--primary)' }}>qué se descartó y por qué</summary>
              {saveResult.duplicates.map((d) => <div key={`dup-${d.ip}`}>· {d.ip}: ya era el hallazgo #{d.findingId}</div>)}
              {saveResult.filtered.map((d) => <div key={`flt-${d.ip}`}>· {d.ip}: {d.reason}</div>)}
              {saveResult.invalid.map((d) => <div key={`inv-${d.ip}`}>· {d.ip}: {d.reason}</div>)}
              {saveResult.skipped.map((d) => <div key={`skp-${d.ip}`}>· {d.ip}: {d.reason}</div>)}
            </details>
          )}
        </div>
      )}

      {result && targets.length === 0 && !loading && (
        <div className="card" style={{ padding: 18, textAlign: 'center' }}>
          <div style={{ fontSize: 26, marginBottom: 6 }}>🛰️</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {result.summary.requested === 0
              ? 'Añade objetivos (IPs o CIDR) o ajusta los filtros: el plan de consultas ya está listo arriba.'
              : 'Ningún objetivo pasó los filtros. Baja la puntuación mínima, quita el filtro de CVEs o el de puerto.'}
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 10 }}>
          {notes.map((n) => <div key={n}>· {n}</div>)}
        </div>
      )}

      {result?.warning && (
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 10, padding: 8, background: 'rgba(255,139,74,0.1)', borderRadius: 6, fontFamily: 'monospace' }}>
          ⚖️ {result.warning}
        </div>
      )}
    </div>
  );
}
