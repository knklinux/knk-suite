import React, { useState, useEffect } from 'react';

export default function Reportes({ api }) {
  const [reports, setReports] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ title: '', asset: '', bugType: '', cwe: '', cvss: '', severity: 'info', impact: '', steps: '', screenshotsPath: '', curl: '' });

  useEffect(() => { api('/reports').then(setReports); }, [api]);

  const save = async () => {
    const data = { ...form, steps: form.steps.split('|').map(s => s.trim()).filter(Boolean) };
    const slug = (form.title || 'draft').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const r = await api('/reports/save', { method: 'POST', body: JSON.stringify({ slug, data }) });
    if (r.ok) { setReports(await api('/reports')); setEditMode(false); }
  };

  return (
    <div>
      <h2>📝 Reportes</h2>
      <button className="btn btn-sm" onClick={() => setEditMode(!editMode)} style={{ marginBottom: 12 }}>
        {editMode ? 'Cancelar' : '+ Nuevo reporte'}
      </button>

      {editMode && (
        <div className="card">
          <h3>Editar reporte</h3>
          <input placeholder="Título (ej: CORS en api.target.com)" value={form.title} onChange={e => setForm({...form, title: e.target.value})} />
          <input placeholder="Asset vulnerable" value={form.asset} onChange={e => setForm({...form, asset: e.target.value})} />
          <input placeholder="Tipo (CORS, IDOR, XSS, SSRF)" value={form.bugType} onChange={e => setForm({...form, bugType: e.target.value})} />
          <input placeholder="CWE" value={form.cwe} onChange={e => setForm({...form, cwe: e.target.value})} />
          <input placeholder="CVSS" value={form.cvss} onChange={e => setForm({...form, cvss: e.target.value})} />
          <select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}>
            {['info','low','medium','high','critical'].map(s => <option key={s}>{s}</option>)}
          </select>
          <textarea placeholder="Impacto" rows={3} value={form.impact} onChange={e => setForm({...form, impact: e.target.value})} />
          <textarea placeholder="Pasos (separa con |)" rows={3} value={form.steps} onChange={e => setForm({...form, steps: e.target.value})} />
          <input placeholder="Ruta screenshots" value={form.screenshotsPath} onChange={e => setForm({...form, screenshotsPath: e.target.value})} />
          <textarea placeholder="Curl reproducible" rows={3} value={form.curl} onChange={e => setForm({...form, curl: e.target.value})} style={{ fontFamily: 'monospace', fontSize: 11 }} />
          <button className="btn btn-green" onClick={save}>💾 Guardar</button>
        </div>
      )}

      {reports.length === 0 && <span className="muted">Sin reportes guardados.</span>}
      {reports.map((r, i) => (
        <div className="card" key={i}>
          <h3>{r.data?.title || r.slug}</h3>
          <div className="kv"><span className="k">Asset</span><span className="v">{r.data?.asset || '—'}</span></div>
          <div className="kv"><span className="k">Tipo</span><span className="v">{r.data?.bugType || '—'}</span></div>
          <div className="kv"><span className="k">Severidad</span><span className="v"><span className="badge badge-warn">{r.data?.severity} ({r.data?.cvss})</span></span></div>
          <div className="kv"><span className="k">Estado</span><span className="v">{r.status}</span></div>
        </div>
      ))}
    </div>
  );
}