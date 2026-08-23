import React, { useState, useEffect } from 'react';

export default function Dashboard({ api, status }) {
  const [session, setSession] = useState({});
  const [programUrl, setProgramUrl] = useState('');
  const [target, setTarget] = useState('');
  const [scope, setScope] = useState('');
  const [ua, setUa] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/session').then(s => {
      setSession(s);
      setTarget(s.target || '');
      setScope((s.scope || []).join(', '));
      setProgramUrl(s.program_url || '');
      setUa(s.user_agent || '');
    });
  }, [api]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const autoParse = async () => {
    if (!programUrl) return showToast('Pega la URL del programa');
    showToast('🔍 Analizando...');
    const r = await api('/parse-program', { method: 'POST', body: JSON.stringify({ url: programUrl }) });
    if (r.ok) {
      setTarget(r.parsed.target);
      setScope(r.parsed.domains.join(', '));
      setUa(r.parsed.userAgent || '');
      showToast('✅ ' + r.parsed.programName + ' — ' + r.parsed.domains.length + ' dominios');
    } else showToast('❌ ' + (r.error || 'Error'));
  };

  const fixTarget = async () => {
    if (!target) return showToast('Define el objetivo');
    const r = await api('/target', { method: 'POST', body: JSON.stringify({ target, scope, userAgent: ua, rateLimitMs: 2000, programUrl }) });
    if (r.ok) showToast('✅ Objetivo fijado — ' + r.scope.length + ' dominios');
  };

  const findings = session.findings || [];
  const phases = session.phases || {};
  const pipelinePhases = ['plan', 'recon', 'scan', 'fuzz', 'exploit', 'reporte', 'verificar'];

  return (
    <div>
      <h2>📊 Dashboard</h2>

      {toast && <div className="toast">{toast}</div>}

      <div className="card">
        <h3>⚡ Setup rápido</h3>
        <input placeholder="URL del programa (YesWeHack/HackerOne)" value={programUrl} onChange={e => setProgramUrl(e.target.value)} />
        <button className="btn btn-sm" onClick={autoParse} style={{ marginRight: 8 }}>🔍 Auto-rellenar</button>
        <span className="muted">Pega la URL y la suite extrae scope, UA, políticas</span>
        <input placeholder="Target (ej: example.com)" value={target} onChange={e => setTarget(e.target.value)} />
        <input placeholder="Scope (ej: *.example.com)" value={scope} onChange={e => setScope(e.target.value)} />
        <input placeholder="User-Agent (según política)" value={ua} onChange={e => setUa(e.target.value)} />
        <button className="btn" onClick={fixTarget}>Fijar objetivo</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="card">
          <h3>📋 OPPLAN</h3>
          {session.opplan?.nombre ? (
            <>
              <div className="kv"><span className="k">Nombre</span><span className="v">{session.opplan.nombre}</span></div>
              <div className="kv"><span className="k">Estado</span><span className="v"><span className={`badge ${session.opplan.status === 'aprobado' ? 'badge-ok' : 'badge-warn'}`}>{session.opplan.status}</span></span></div>
            </>
          ) : <span className="muted">Sin OPPLAN</span>}
        </div>
        <div className="card">
          <h3>🗂️ Sesión</h3>
          <div className="kv"><span className="k">Objetivo</span><span className="v">{session.target || '—'}</span></div>
          <div className="kv"><span className="k">Hallazgos</span><span className="v">{findings.length}</span></div>
        </div>
      </div>

      <h2>🚀 Pipeline</h2>
      <div className="card">
        {pipelinePhases.map(p => (
          <div className="pipeline-phase" key={p}>
            <div className={`phase-num ${phases[p]?.done ? 'done' : 'pending'}`}>
              {phases[p]?.done ? '✓' : pipelinePhases.indexOf(p) + 1}
            </div>
            <div style={{ flex: 1 }}>
              <strong>{p.toUpperCase()}</strong>
              {phases[p]?.done ? <span className="badge badge-ok" style={{ marginLeft: 8 }}>done</span> : <span className="muted" style={{ marginLeft: 8 }}>pendiente</span>}
            </div>
          </div>
        ))}
      </div>

      {findings.length > 0 && (
        <>
          <h2>🐞 Hallazgos</h2>
          <div className="card">
            {findings.map((f, i) => (
              <div className="finding" key={i}>
                <span className="f-type">[{f.type}]</span>
                <span className="f-sum">{f.summary}</span>
                <span className="f-sev"><span className={`badge ${f.severity === 'high' || f.severity === 'critical' ? 'badge-err' : f.severity === 'medium' ? 'badge-warn' : 'badge-ok'}`}>{f.severity}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}