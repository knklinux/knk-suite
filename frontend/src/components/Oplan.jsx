import React, { useState, useEffect } from 'react';

export default function Oplan({ api }) {
  const [form, setForm] = useState(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/opplan').then(o => {
      setForm(o || { nombre: '', objetivo: '', scope: [], autorizado: false, rateLimit: '1 req / 2s', ventana: '09:00–18:00 CET', noTocar: [], limites: [], status: 'borrador' });
      setLoading(false);
    });
  }, [api]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setList = (k, v) => set(k, String(v).split(',').map(x => x.trim()).filter(Boolean));

  const save = async () => {
    const r = await api('/opplan', { method: 'POST', body: JSON.stringify(form) });
    showToast(r.ok ? '✅ OPPLAN guardado' : '❌ Error');
  };

  const approve = async () => {
    // Aprobar = confirmar autorización escrita: la suite bloquea el pipeline si no
    if (!form?.nombre) return showToast('❌ Guarda antes de aprobar');
    const saved = await api('/opplan', { method: 'POST', body: JSON.stringify({ ...form, autorizado: true }) });
    const r = await api('/opplan/approve', { method: 'POST', body: JSON.stringify({}) });
    showToast(r.ok ? '✅ OPPLAN APROBADO — pipeline desbloqueado (revisa scope en la página del programa)' : '❌ Error al aprobar');
    const fresh = await api('/opplan');
    if (fresh?.status) setForm(fresh);
  };

  if (loading) return <div className="card"><span className="muted">Cargando...</span></div>;

  return (
    <div>
      <h2>📋 OPPLAN (Operation Plan)</h2>
      {toast && <div className="toast">{toast}</div>}

      <div className="card">
        <h3>Plan de operaciones — obligatorio para el pipeline</h3>
        <p style={{ fontSize: 12, marginBottom: 8 }}>
          Sin OPPLAN válido y aprobado, la suite <strong>bloquea toda ejecución</strong> (fail-closed).
          El scope de esta sesión: <code>{form.scope?.join(', ') || '(vacío)'}</code>
        </p>
        <input placeholder="Nombre del programa (ej: Banco Plata)" value={form.nombre || ''} onChange={e => set('nombre', e.target.value)} />
        <input placeholder="Objetivo (ej: Validación autorizada de bancoplata.mx)" value={form.objetivo || ''} onChange={e => set('objetivo', e.target.value)} />
        <textarea
          rows={2}
          placeholder="Scope (separado por comas, ej: *.example.com, api.example.org)"
          value={(form.scope || []).join(', ')}
          onChange={e => setList('scope', e.target.value)}
          style={{ width: '100%', fontSize: 12 }}
        />
        <input placeholder="Rate limit (ej: 1 req / 2s)" value={form.rateLimit || ''} onChange={e => set('rateLimit', e.target.value)} />
        <input placeholder="Ventana horaria (ej: 09:00–18:00 CET)" value={form.ventana || ''} onChange={e => set('ventana', e.target.value)} />
        <textarea rows={1} placeholder="No tocar (separado por comas)" value={(form.noTocar || []).join(', ')} onChange={e => setList('noTocar', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
        <textarea rows={1} placeholder="Límites (separado por comas, ej: No DoS)" value={(form.limites || []).join(', ')} onChange={e => setList('limites', e.target.value)} style={{ width: '100%', fontSize: 12 }} />
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <label>
            <input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.autorizado === true} onChange={e => set('autorizado', e.target.checked)} />
            <strong>Autorización escrita confirmada</strong> — marca SOLO tras leer la política del programa
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={save}>💾 Guardar borrador</button>
          <button className="btn btn-green" onClick={approve} disabled={form.status === 'aprobado'}>
            {form.status === 'aprobado' ? '✅ Aprobado' : '🔓 Aprobar (desbloquear pipeline)'}
          </button>
        </div>
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          Estado: <span className={`badge ${form.status === 'aprobado' ? 'badge-ok' : 'badge-warn'}`}>{form.status || 'borrador'}</span>
          {' '}· Autorizado: {form.autorizado ? 'SÍ' : 'NO'}
        </p>
      </div>

      <div className="card" style={{ borderColor: 'var(--yellow)' }}>
        <h3 style={{ color: 'var(--yellow)' }}>⚠️ Antes de aprobar</h3>
        <ul style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>
          <li>Verifica que el scope coincide EXACTO con la pestaña Scope del programa</li>
          <li>Lee las reglas (RoE): ¿prohíbe automatización, DoS, cuentas de prueba?</li>
          <li>Confirma el rango de rate limit y la ventana horaria permitida</li>
          <li>Aprobar es tu confirmación formal de autorización escrita</li>
        </ul>
      </div>
    </div>
  );
}
