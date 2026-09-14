import React, { useEffect, useState } from 'react';

const empty = {
  nombre: '', objetivo: '', scope: '', autorizado: false,
  rateLimit: '1 req / 2s', ventana: '09:00–18:00 CET',
  noTocar: '', limites: '', tecnicas: '',
};

function listValue(value) {
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

export default function Opplan({ api }) {
  const [session, setSession] = useState({});
  const [form, setForm] = useState(empty);
  const [confirmedReview, setConfirmedReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    const s = await api('/session');
    setSession(s);
    const p = s.opplan || {};
    setForm({
      nombre: p.nombre || '',
      objetivo: p.objetivo || '',
      scope: (p.scope || s.scope || []).join(', '),
      autorizado: p.autorizado === true,
      rateLimit: p.rateLimit || '1 req / 2s',
      ventana: p.ventana || '09:00–18:00 CET',
      noTocar: (p.noTocar || []).join(', '),
      limites: (p.limites || []).join(', '),
      tecnicas: (p.tecnicas || []).join(', '),
    });
  };

  useEffect(() => { load().catch(() => setMessage('No se pudo cargar la sesión')); }, [api]);

  const setField = (name, value) => setForm(prev => ({ ...prev, [name]: value }));
  const payload = () => ({
    ...form,
    scope: listValue(form.scope),
    noTocar: listValue(form.noTocar),
    limites: listValue(form.limites),
    tecnicas: listValue(form.tecnicas),
  });

  const saveDraft = async () => {
    if (!form.nombre.trim() || !form.objetivo.trim()) {
      setMessage('Completa el nombre y el objetivo antes de guardar.');
      return;
    }
    setLoading(true);
    try {
      const r = await api('/opplan', { method: 'POST', body: JSON.stringify(payload()) });
      setMessage(r.ok ? 'OPPLAN guardado como borrador.' : (r.error || 'No se pudo guardar el OPPLAN.'));
      if (r.ok) await load();
    } finally { setLoading(false); }
  };

  const approve = async () => {
    if (!form.autorizado || !confirmedReview) {
      setMessage('Debes confirmar la autorización escrita y la revisión manual del Brief.');
      return;
    }
    setLoading(true);
    try {
      const saved = await api('/opplan', { method: 'POST', body: JSON.stringify(payload()) });
      if (!saved.ok) { setMessage(saved.error || 'No se pudo guardar el OPPLAN.'); return; }
      const r = await api('/opplan/approve', { method: 'POST', body: '{}' });
      setMessage(r.ok ? 'OPPLAN aprobado por el backend.' : (r.error || 'El backend rechazó la aprobación.'));
      if (r.ok) { setConfirmedReview(false); await load(); }
    } finally { setLoading(false); }
  };

  const storedStatus = session.opplan?.status || 'borrador';
  const scopeMatches = JSON.stringify([...(session.opplan?.scope || [])].slice().sort()) === JSON.stringify([...(session.scope || [])].slice().sort());
  const targetHost = String(session.target || '').replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  const targetInScope = targetHost && (session.scope || []).some(entry => {
    const e = String(entry || '').toLowerCase();
    return e.startsWith('*.') ? targetHost === e.slice(2) || targetHost.endsWith('.' + e.slice(2)) : targetHost === e;
  });
  const effectiveApproved = storedStatus === 'aprobado' && session.opplan?.autorizado === true
    && !!targetHost && scopeMatches && targetInScope;
  const status = effectiveApproved ? 'aprobado' : 'borrador';

  return (
    <div>
      <h2>📋 OPPLAN</h2>
      <p className="muted">Define el alcance, las reglas de trabajo y la autorización antes de iniciar cualquier fase activa.</p>
      {message && <div className="toast">{message}</div>}

      <div className="card">
        <div className="kv"><span className="k">Estado</span><span className="v"><span className={`badge ${status === 'aprobado' ? 'badge-ok' : 'badge-warn'}`}>{status}</span></span></div>
        <div className="kv"><span className="k">Target de sesión</span><span className="v">{session.target || '—'}</span></div>
        <div className="kv"><span className="k">Scope de sesión</span><span className="v">{(session.scope || []).join(', ') || '—'}</span></div>
        <div className="kv"><span className="k">Rate limit efectivo</span><span className="v">{session.rate_limit_ms || '—'} ms</span></div>
      </div>

      <div className="card">
        <h3>Datos del plan</h3>
        <input placeholder="Nombre del OPPLAN" value={form.nombre} onChange={e => setField('nombre', e.target.value)} />
        <textarea placeholder="Objetivo concreto" rows={3} value={form.objetivo} onChange={e => setField('objetivo', e.target.value)} />
        <input placeholder="Scope exacto, separado por comas" value={form.scope} onChange={e => setField('scope', e.target.value)} />
        <input placeholder="Rate limit declarado" value={form.rateLimit} onChange={e => setField('rateLimit', e.target.value)} />
        <input placeholder="Ventana de trabajo" value={form.ventana} onChange={e => setField('ventana', e.target.value)} />
        <input placeholder="No tocar, separado por comas" value={form.noTocar} onChange={e => setField('noTocar', e.target.value)} />
        <textarea placeholder="Límites y condiciones" rows={3} value={form.limites} onChange={e => setField('limites', e.target.value)} />
        <textarea placeholder="Técnicas autorizadas, separado por comas" rows={2} value={form.tecnicas} onChange={e => setField('tecnicas', e.target.value)} />
      </div>

      <div className="card" style={{ borderColor: 'var(--yellow)' }}>
        <h3 style={{ color: 'var(--yellow)' }}>Atestación manual obligatoria</h3>
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0' }}>
          <input type="checkbox" checked={form.autorizado} onChange={e => { setField('autorizado', e.target.checked); setConfirmedReview(false); }} />{' '}
          Confirmo que dispongo de autorización escrita vigente para este programa, asset, cuentas y técnicas.
        </label>
        <label style={{ display: 'block', fontSize: 12, margin: '10px 0' }}>
          <input type="checkbox" checked={confirmedReview} onChange={e => setConfirmedReview(e.target.checked)} />{' '}
          He revisado manualmente el Brief actual, el scope, los límites y las condiciones de parada.
        </label>
        <button className="btn btn-sm" onClick={saveDraft} disabled={loading}>💾 Guardar borrador</button>{' '}
        <button className="btn btn-sm" onClick={approve} disabled={loading || !form.autorizado || !confirmedReview}>✅ Aprobar OPPLAN</button>
        {!effectiveApproved && storedStatus === 'aprobado' && <p className="muted" style={{ color: 'var(--yellow)', fontSize: 11, marginTop: 10 }}>
          ⚠️ La aprobación persistida no está vinculada a un target y scope activos; se muestra como borrador y el pipeline debe permanecer bloqueado.
        </p>}
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          La aplicación no marca la autorización automáticamente. Si cambias target, scope, programa o exclusiones, el backend devuelve el plan a borrador.
        </p>
      </div>
    </div>
  );
}
