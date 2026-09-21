import React, { useCallback, useEffect, useState } from 'react';

// ============================================================================
// FindingsPanel.jsx — Hallazgos de la misión con detalle completo
//
// El Dashboard solo muestra contadores; aquí cada hallazgo es explorable:
// resumen, severidad, asset, detalle completo (JSON), evidencia descargable
// (autenticada), borrado y "→ Repeater" para verificarlo manualmente.
// ============================================================================

const SEV_COLORS = { critical: '#f85149', high: '#ff7b72', medium: '#d29922', low: '#58a6ff', info: '#8b949e' };
const SEV_LABELS = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo', info: 'Info' };
const STATUS_LABELS = { nuevo: 'Nuevo', confirmado: 'Confirmado', 'falso-positivo': 'Falso +', reportado: 'Reportado', descartado: 'Descartado' };

function typeOf(f) { return (f.details?.osint?.tool) || (f.type || '').split('.')[0] || 'manual'; }
function statusOf(f) { return f.status || f.details?.triage?.status || 'nuevo'; }

export default function FindingsPanel({ api, go, sendToRepeater }) {
  const [findings, setFindings] = useState([]);
  const [scope, setScope] = useState('all'); // 'all' = todas las sesiones (el Dashboard cuenta global)
  const [sevFilter, setSevFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [progFilter, setProgFilter] = useState('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null); // { slug, report } del borrador generado
  const [attestOpen, setAttestOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [att, setAtt] = useState({ noDuplicate: false, notDisqualifier: false, exploitable: false, evidenceScreenshots: false, evidenceRequestResponse: false, pocMinimal: false, noPII: false, reproducibleCount: 0 });
  const toggle = (k) => setAtt((p) => ({ ...p, [k]: !p[k] }));
  const ATT_ITEMS = [
    ['noDuplicate', 'rep-2', 'He buscado reports parecidos (no duplicado)'],
    ['notDisqualifier', 'rep-3', 'No es disqualifier del programa'],
    ['exploitable', 'rep-4', 'Explotable de verdad (impacto real)'],
    ['evidenceScreenshots', 'rep-5', 'Tengo captura(s) del exploit e impacto'],
    ['evidenceRequestResponse', 'rep-6', 'Tengo request/response reproducible'],
    ['pocMinimal', 'rep-7', 'PoC mínimo con pasos numerados'],
    ['noPII', 'rep-8', 'Sin PII real (redactado)'],
  ];
  const allChecked = Object.keys(att).every((k) => (k === 'reproducibleCount' ? att[k] >= 2 : att[k])) && reviewNote.trim().length >= 20;

  const generateDraft = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await api('/findings/draft-report', {
        method: 'POST',
        body: JSON.stringify({
          ids: filtered.map((f) => f.id),
          attestation: { ...att, humanReview: true, reviewNote },
        }),
      });
      if (r?.ok) { setDraft(r); setAttestOpen(false); setMsg(''); }
      else setMsg(r?.blockers || r?.error || 'No se pudo generar el borrador');
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally { setBusy(false); }
  };

  const refresh = useCallback(async () => {
    const r = await api(scope === 'all' ? '/findings?scope=all' : '/findings').catch(() => null);
    if (Array.isArray(r)) setFindings(r);
  }, [api, scope]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(refresh, 10000); return () => clearInterval(t); }, [refresh]);

  const programs = [...new Set(findings.map((f) => f.program || f.session_program || f.session_target || '').filter(Boolean))].sort();

  const types = [...new Set(findings.map((f) => typeOf(f)))].sort();

  const filtered = findings.filter((f) => {
    if (sevFilter !== 'all' && f.severity !== sevFilter) return false;
    if (typeFilter !== 'all' && typeOf(f) !== typeFilter) return false;
    if (progFilter !== 'all' && (f.program || '') !== progFilter) return false;
    if (q) {
      const needle = q.toLowerCase();
      const hay = `${f.summary} ${f.type} ${f.details?.asset || ''} ${f.details?.url || ''} ${f.program || ''} ${statusOf(f)}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const open = async (f) => {
    if (openId === f.id) { setOpenId(null); setDetail(null); return; }
    setOpenId(f.id);
    setDetail(f);
    openTriage(f);
  };

  const remove = async (f) => {
    if (!window.confirm(`¿Borrar el hallazgo #${f.id}?\n${f.summary}`)) return;
    setBusy(true);
    try {
      const r = await api(`/findings/${f.id}`, { method: 'DELETE' });
      if (r.ok) { setMsg(`hallazgo #${f.id} borrado`); await refresh(); }
      else setMsg(`❌ ${r.error || 'no se pudo borrar'}`);
    } finally { setBusy(false); }
  };

  const downloadEvidence = (path) => {
    if (!path) return;
    window.open(`/api/evidence/download?path=${encodeURIComponent(path)}`, '_blank');
  };

  const toRepeater = (f) => {
    const url = f.details?.url || f.details?.asset;
    if (!url || !sendToRepeater) { setMsg('este hallazgo no tiene URL para repetir'); return; }
    try {
      const u = new URL(url);
      const raw = `GET ${u.pathname + u.search} HTTP/1.1\nHost: ${u.host}\nAccept: */*\nConnection: close`;
      sendToRepeater(raw);
      go('repeater');
    } catch { setMsg('URL inválida para Repeater'); }
  };

  const [triStatus, setTriStatus] = useState('nuevo');
  const [triSev, setTriSev] = useState('info');
  const [triNote, setTriNote] = useState('');
  const openTriage = (f) => { setTriStatus(statusOf(f)); setTriSev(f.severity || 'info'); setTriNote(f.details?.triage?.note || ''); };
  const saveTriage = async (f) => {
    setBusy(true);
    try {
      const r = await api(`/findings/${f.id}/triage`, { method: 'POST', body: JSON.stringify({ status: triStatus, severity: triSev, note: triNote }) });
      if (r?.ok) { setMsg(`hallazgo #${f.id} → ${STATUS_LABELS[triStatus] || triStatus}`); await refresh(); }
      else setMsg(`❌ ${r?.error || 'no se pudo triar'}`);
    } catch (e) { setMsg('❌ ' + e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ color: 'var(--text)' }}>
      {msg && <div className="toast" onClick={() => setMsg('')}>{msg}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: '#fff', fontFamily: "'Courier New', monospace" }}>🐞 Hallazgos de la misión ({findings.length})</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={() => window.open('/api/findings/export/json', '_blank')}>⬇ JSON</button>
            <button className="btn btn-sm btn-outline" onClick={() => window.open('/api/findings/export/csv', '_blank')}>⬇ CSV</button>
            <button className="btn btn-sm btn-outline" onClick={refresh}>refresh</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <button className={`btn btn-sm ${scope === 'all' ? '' : 'btn-outline'}`} onClick={() => setScope(scope === 'all' ? 'session' : 'all')}
            title="El Dashboard cuenta todas las sesiones; 'todas' muestra lo mismo que los contadores">
            {scope === 'all' ? '🌍 todas las sesiones' : '📍 solo sesión actual'}
          </button>
          {['all', 'critical', 'high', 'medium', 'low', 'info'].map((s) => (
            <button key={s} className={`btn btn-sm ${sevFilter === s ? '' : 'btn-outline'}`} onClick={() => setSevFilter(s)}
              style={{ borderColor: SEV_COLORS[s], color: sevFilter === s ? '#0a0f16' : SEV_COLORS[s], background: sevFilter === s ? SEV_COLORS[s] : 'transparent' }}>
              {s === 'all' ? `todos (${findings.length})` : `${SEV_LABELS[s]} (${findings.filter((f) => f.severity === s).length})`}
            </button>
          ))}
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '4px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}>
            <option value="all">todas las fuentes</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={progFilter} onChange={(e) => setProgFilter(e.target.value)} style={{ padding: '4px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}>
            <option value="all">todos los programas</option>
            {programs.map((p) => <option key={p} value={p}>{p.slice(0, 40)}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar en resumen/asset/programa…" style={{ flex: 1, minWidth: 160, padding: '4px 10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {filtered.map((f) => (
          <div key={f.id} className="card" style={{ padding: 12, borderLeft: `3px solid ${SEV_COLORS[f.severity] || '#8b949e'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, cursor: 'pointer' }} onClick={() => open(f)}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="badge" style={{ background: SEV_COLORS[f.severity], color: '#0a0f16', fontSize: 9 }}>{SEV_LABELS[f.severity] || f.severity}</span>
                  <span className="badge" style={{ fontSize: 9, border: '1px solid var(--border)', color: 'var(--muted)' }}>📌 {STATUS_LABELS[statusOf(f)] || statusOf(f)}</span>
                  {(f.program || f.session_program) && <span className="badge" style={{ fontSize: 9, border: '1px solid var(--primary)', color: 'var(--primary)' }}>🎯 {(f.program || f.session_program || '').slice(0, 32)}</span>}
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'var(--muted)' }}>#{f.id} · {typeOf(f)} · {f.type}</span>
                </div>
                <div style={{ fontSize: 12, color: '#fff', marginTop: 4 }}>{f.summary}</div>
                {(f.details?.asset || f.details?.url) && <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--primary)', marginTop: 2 }}>{f.details.asset || f.details.url}</div>}
              </div>
              <span style={{ color: 'var(--muted)' }}>{openId === f.id ? '▾' : '▸'}</span>
            </div>

            {openId === f.id && detail && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>DETALLE COMPLETO</div>
                    <pre style={{ fontSize: 10, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 6, padding: 8, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify({ ...f, details: { ...f.details, osint: f.details?.osint ? { ...f.details.osint, key: f.details.osint.key } : undefined } }, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>EVIDENCIA</div>
                    {(f.details?.evidence || []).length === 0 && <div className="muted" style={{ fontSize: 11 }}>Sin ficheros de evidencia enlazados.</div>}
                    <div style={{ display: 'grid', gap: 4 }}>
                      {(f.details?.evidence || []).map((p, i) => (
                        <button key={i} className="btn btn-sm btn-outline" style={{ textAlign: 'left', fontFamily: 'monospace', fontSize: 10 }} onClick={() => downloadEvidence(p)} title={p}>
                          📎 {String(p).split(/[\\/]/).pop()}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {(f.details?.url || f.details?.asset) && <button className="btn btn-sm" onClick={() => toRepeater(f)}>→ Repeater</button>}
                      <button className="btn btn-sm btn-outline" style={{ color: '#f85149', borderColor: '#f85149' }} onClick={() => remove(f)} disabled={busy}>🗑 Borrar</button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                      <span className="muted" style={{ fontSize: 10 }}>TRIAJE:</span>
                      <select value={openId === f.id && detail ? triStatus : statusOf(f)} onChange={(e) => { openTriage(f); setTriStatus(e.target.value); }} onFocus={() => openTriage(f)}
                        style={{ padding: '4px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}>
                        {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                      <select value={triSev} onChange={(e) => { openTriage(f); setTriSev(e.target.value); }} onFocus={() => openTriage(f)}
                        style={{ padding: '4px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }}>
                        {Object.keys(SEV_LABELS).map((s) => <option key={s} value={s}>{SEV_LABELS[s]}</option>)}
                      </select>
                      <input value={triNote} onChange={(e) => setTriNote(e.target.value)} onFocus={() => openTriage(f)} placeholder="nota de triaje…"
                        style={{ flex: 1, minWidth: 140, padding: '4px 10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
                      <button className="btn btn-sm" onClick={() => saveTriage(f)} disabled={busy}>💾 Guardar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {filtered.length > 0 && (
        <div className="card" style={{ padding: 10, marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-sm" disabled={busy} onClick={() => setAttestOpen((v) => !v)}>
            📝 Generar borrador de reporte ({filtered.length} hallazgos)
          </button>
          <span className="muted" style={{ fontSize: 10 }}>
            usa SOLO los hallazgos visibles con los filtros actuales
          </span>
        </div>
      )}

      {attestOpen && (
        <div className="card" style={{ padding: 12, marginBottom: 12, borderColor: 'var(--warn, #d29922)' }}>
          <h3 style={{ marginTop: 0 }}>🧷 Atestación del operador (compuertas del reporte)</h3>
          <p style={{ fontSize: 11, marginTop: 4 }}>
            El borrador se genera con <code>report.generateReport</code>; estas marcas son tu declaración
            explícita — se refuerzan al enviar a triage.
          </p>
          {ATT_ITEMS.map(([key, gateId, label]) => (
            <label key={key} style={{ display: 'block', fontSize: 12, margin: '4px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={att[key]} onChange={() => toggle(key)} />{' '}
              <span className="muted">[{gateId}]</span> {label}
            </label>
          ))}
          <label style={{ display: 'block', fontSize: 12, margin: '4px 0' }}>
            <input type="checkbox" checked={att.reproducibleCount >= 2} onChange={() => setAtt((p) => ({ ...p, reproducibleCount: p.reproducibleCount >= 2 ? 0 : 2 }))} />{' '}
            <span className="muted">[rep-9]</span> PoC reproducido ≥2 veces
          </label>
          <textarea
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            placeholder="[rep-11] Nota de revisión humana (mín. 20 caracteres): qué verificaste y con qué evidencia…"
            rows={2}
            style={{ width: '100%', marginTop: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-sm" disabled={busy || !allChecked} onClick={generateDraft}>
              {busy ? 'Generando…' : '✅ Confirmo y genero borrador'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setAttestOpen(false)}>Cancelar</button>
          </div>
          {!allChecked && reviewNote.trim().length < 20 && (
            <p className="muted" style={{ fontSize: 10, marginBottom: 0 }}>Falta la nota de revisión humana (≥20 caracteres).</p>
          )}
        </div>
      )}

      {draft && (
        <div className="card" style={{ padding: 12, marginBottom: 12, borderColor: 'var(--ok, #3fb950)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>📄 Borrador {draft.id} guardado</h3>
            <span className="badge badge-ok">estado: borrador</span>
            <button className="btn btn-sm btn-outline" onClick={() => navigator.clipboard?.writeText(draft.report || '')}>📋 Copiar markdown</button>
            <button className="btn btn-sm btn-outline" onClick={() => go('reportes')}>Ver en Reportes</button>
          </div>
          <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 11, marginTop: 8 }}>{draft.report}</pre>
        </div>
      )}

      {filtered.length === 0 && (
          <div className="card" style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>🐞</div>
            <div className="muted" style={{ fontSize: 12 }}>Sin hallazgos que cumplan el filtro. Los que creen el pipeline, OSINT Tools, Nuclei o el proxy aparecerán aquí con su evidencia.</div>
          </div>
        )}
      </div>
    </div>
  );
}
