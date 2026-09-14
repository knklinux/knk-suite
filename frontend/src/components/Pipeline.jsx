import React, { useState, useEffect } from 'react';

export default function Pipeline({ api }) {
  const [session, setSession] = useState({});
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [phaseOutputs, setPhaseOutputs] = useState({});
  const [paused, setPaused] = useState(null);
  const [results, setResults] = useState(null);
  const [toast, setToast] = useState('');
  const [localRunning, setLocalRunning] = useState(false);
  const [localResult, setLocalResult] = useState(null);
  const [surfaceRunning, setSurfaceRunning] = useState(false);
  const [surfaceResult, setSurfaceResult] = useState(null);

  const phases = ['plan', 'recon', 'scan', 'fuzz', 'exploit', 'reporte', 'verificar'];
  const emoji = { plan: '📋', recon: '🔍', scan: '🛡️', fuzz: '🚀', exploit: '✅', reporte: '📝', verificar: '🔎' };

  useEffect(() => { api('/session').then(setSession); }, [api]);

  const runPhase = async (phaseId) => {
    const r = await api('/pipeline/run', { method: 'POST', body: JSON.stringify({ phase: phaseId }) });
    setPhaseOutputs(prev => ({ ...prev, [phaseId]: r }));
    return r;
  };

  const runLocalPipeline = async () => {
    setLocalRunning(true);
    setLocalResult(null);
    try {
      const r = await api('/pipeline/local', { method: 'POST', body: JSON.stringify({ maxPaths: 15 }) });
      setLocalResult(r);
      setToast(r.ok ? '✅ QA local completado sin tráfico externo.' : (r.error || 'Falló el QA local.'));
    } catch (e) {
      setToast('❌ No se pudo ejecutar el QA local: ' + e.message);
    } finally {
      setLocalRunning(false);
    }
  };

  const runSurfaceMap = async () => {
    setSurfaceRunning(true);
    setSurfaceResult(null);
    try {
      const r = await api('/surface/map', { method: 'POST', body: JSON.stringify({ maxBundles: 12 }) });
      setSurfaceResult(r);
      if (!r.ok && r.error) setToast('❌ ' + r.error);
      else setToast('✅ Mapeo de superficie completado — ' + (r.endpoints?.length || 0) + ' endpoints.');
    } catch (e) {
      setToast('❌ No se pudo ejecutar el mapeo: ' + e.message);
    } finally {
      setSurfaceRunning(false);
    }
  };

  const startPipeline = async () => {
    setRunning(true); setResults(null); setPhaseOutputs({}); setPaused(null);
    for (const phaseId of phases) {
      setStatus(`${emoji[phaseId]} ${phaseId.toUpperCase()}...`);
      if (phaseId === 'fuzz') { setPaused('fuzz'); setStatus('⏸ FUZZ — ejecuta en Terminal Kali'); setRunning(false); return; }
      if (phaseId === 'exploit') { setPaused('exploit'); setStatus('⏸ EXPLOIT — prueba PoC y toma screenshots'); setRunning(false); return; }
      const r = await runPhase(phaseId);
      if (!r.ok && phaseId === 'plan') break;
    }
    setStatus('✅ Pipeline completo'); setRunning(false);
    const s = await api('/session'); setSession(s); setResults(s);
  };

  const continueAfter = async (from) => {
    setRunning(true); setPaused(null);
    await runPhase(from);
    for (const p of phases.slice(phases.indexOf(from) + 1)) {
      setStatus(`${emoji[p]} ${p.toUpperCase()}...`);
      if (p === 'fuzz') { setPaused('fuzz'); setRunning(false); return; }
      if (p === 'exploit') { setPaused('exploit'); setRunning(false); return; }
      await runPhase(p);
    }
    setStatus('✅ Pipeline completo'); setRunning(false);
    const s = await api('/session'); setSession(s); setResults(s);
  };

  const tgt = session.target || 'TARGET';

  return (
    <div>
      <h2>🚀 Pipeline</h2>
      {toast && <div className="toast">{toast}</div>}

      {phaseOutputs.plan && !phaseOutputs.plan.ok && (
        <div className="card" style={{ borderColor: 'var(--red)' }}>
          <h3 style={{ color: 'var(--red)' }}>⛔ PLAN bloqueado</h3>
          <p style={{ fontSize: 12 }}>{phaseOutputs.plan.error || 'Falta el OPPLAN'}</p>
          <p style={{ fontSize: 12 }}>Ve a la pestaña <strong>📋 OPPLAN</strong>, crea el plan, marca la autorización escrita y pulsa <strong>Aprobar</strong>.</p>
        </div>
      )}

      <div className="card">
        <h3>▶ Pipeline automático + manual</h3>
        <p className="muted">Auto: PLAN → RECON → SCAN | Manual confirmado: FUZZ → EXPLOIT | Auto: REPORTE → VERIFICAR</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={startPipeline} disabled={running || localRunning}>
            {running ? '⏳...' : paused ? '▶ Continuar' : '🚀 Pipeline externo controlado'}
          </button>
          {paused && <button className="btn btn-green" onClick={() => continueAfter(paused)}>▶ Después de {paused}</button>}
          <button className="btn btn-sm btn-outline" onClick={runLocalPipeline} disabled={running || localRunning}>
            {localRunning ? '⏳ QA local...' : '🧪 Ejecutar pipeline local sintético'}
          </button>
          <button className="btn btn-sm" onClick={runSurfaceMap} disabled={running || surfaceRunning}>
            {surfaceRunning ? '⏳ Descargando bundles...' : '🗺️ Mapear superficie (JS bundles)'}
          </button>
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          El pipeline local valida todas las fases con cuentas/recursos sintéticos y no necesita Docker, Burp ni OPPLAN externo.
        </p>
        {status && <p style={{ marginTop: 8, fontSize: 12 }}>{status}</p>}
      </div>

      <div className="card">
        <h3>Progreso</h3>
        {phases.map(p => (
          <div className="pipeline-phase" key={p}>
            <div className={`phase-num ${phaseOutputs[p]?.ok ? 'done' : paused === p ? 'active' : 'pending'}`}>
              {phaseOutputs[p]?.ok ? '✓' : paused === p ? '⏸' : phases.indexOf(p) + 1}
            </div>
            <div style={{ flex: 1 }}>
              <strong>{emoji[p]} {p.toUpperCase()}</strong>
              <span style={{ display: 'block', fontSize: 10, color: 'var(--muted)' }}>
                {phaseOutputs[p]?.ok
                  ? (p === 'recon' ? `${phaseOutputs[p].output?.totalSubs || 0} subdominios · ${phaseOutputs[p].output?.totalCadenasCname || 0} cadenas CNAME`
                    : p === 'scan' ? `${phaseOutputs[p].output?.headersAusentes?.length || 0} headers ausentes`
                    : p === 'verificar' ? `${phaseOutputs[p].output?.verdict || ''} (${phaseOutputs[p].output?.score || 0}/100)`
                    : 'completado')
                  : paused === p ? '⏸ PAUSADO — usa Terminal Kali ↓' : ''}
              </span>
            </div>
            {phaseOutputs[p]?.ok && <span className="badge badge-ok">✓</span>}
            {paused === p && <span className="badge badge-warn">⏸</span>}
          </div>
        ))}
      </div>

      {paused === 'fuzz' && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          <h3 style={{ color: 'var(--yellow)' }}>🔍 Fuzzing manual controlado</h3>
          <p style={{ fontSize: 11 }}>La suite limita a <strong>15 rutas, una petición cada vez</strong>, con el rate limit global de la sesión. No uses ffuf/nuclei ni comandos externos contra el objetivo desde esta pantalla.</p>
          <p style={{ fontSize: 11 }}>Revisa el scope, la cuenta autorizada y el Brief; después ejecuta la fase con <code>manualConfirm:true</code>. Se detiene ante 429/430/509, 503, dos respuestas 403 consecutivas o fuera de scope.</p>
          <div style={{ fontSize: 11 }}><strong>Objetivo:</strong> <code>{tgt}</code></div>
        </div>
      )}

      {localResult?.ok && (
        <div className="card" style={{ borderColor: 'var(--green)' }}>
          <h3 style={{ color: 'var(--green)' }}>🧪 Resultado del QA local</h3>
          <div className="kv"><span className="k">Veredicto</span><span className="v">{localResult.verdict}</span></div>
          <div className="kv"><span className="k">Fases</span><span className="v">{localResult.completed}/{localResult.total}</span></div>
          <div className="kv"><span className="k">Peticiones externas</span><span className="v">{localResult.externalRequests}</span></div>
          <div className="kv"><span className="k">Docker/Burp</span><span className="v">No utilizados</span></div>
          {localResult.phases?.map((p) => (
            <div className="finding" key={p.phase}>
              <span className="f-type">[{p.phase.toUpperCase()}]</span>
              <span className="f-sum">{p.ok ? 'OK' : 'FALLÓ'} {p.output?.reason || p.findings?.[0]?.summary || ''}</span>
              <span className={`badge ${p.ok ? 'badge-ok' : 'badge-err'}`}>{p.ok ? 'OK' : 'ERROR'}</span>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 11 }}>
            Este resultado sirve para probar KNK Suite; no es un hallazgo contra OpenAI ni se puede enviar a Bugcrowd.
          </p>
        </div>
      )}

      {surfaceResult?.ok && (
        <div className="card" style={{ borderColor: 'var(--green)' }}>
          <h3 style={{ color: 'var(--green)' }}>🗺️ Superficie mapeada</h3>
          <div className="kv"><span className="k">Bundles</span><span className="v">{surfaceResult.totalBundles} · {surfaceResult.indexBytes} bytes index</span></div>
          <div className="kv"><span className="k">Endpoints únicos</span><span className="v">{surfaceResult.endpoints?.length || 0}</span></div>
          <div className="kv"><span className="k">Identificadores</span><span className="v">{(surfaceResult.identifiers && Object.keys(surfaceResult.identifiers).length) || 0}</span></div>
          <div className="kv"><span className="k">Evidencia</span><span className="v">{(surfaceResult.savedEvidence || []).length} archivos</span></div>
          {surfaceResult.skippedOutOfScope?.length > 0 && <p className="muted" style={{ fontSize: 11 }}>⛔ {surfaceResult.skippedOutOfScope.length} recursos fuera de scope ignorados.</p>}
          {surfaceResult.endpoints?.length > 0 && (
            <details>
              <summary style={{ fontSize: 12 }}>Ver endpoints ({surfaceResult.endpoints.length})</summary>
              <pre style={{ maxHeight: 260, overflow: 'auto', fontSize: 11 }}>{surfaceResult.endpoints.join('\n')}</pre>
            </details>
          )}
          {surfaceResult.identifiers && Object.keys(surfaceResult.identifiers).length > 0 && (
            <details>
              <summary style={{ fontSize: 12 }}>Ver identificadores</summary>
              <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 11 }}>{Object.entries(surfaceResult.identifiers).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
            </details>
          )}
        </div>
      )}

      {paused === 'exploit' && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          <h3 style={{ color: 'var(--yellow)' }}>🔓 Validación manual con compuertas</h3>
          <p style={{ fontSize: 11 }}>No se muestran comandos genéricos de explotación. Selecciona una hipótesis concreta, usa tráfico propio y valida el impacto con la compuerta correspondiente.</p>
          <p style={{ fontSize: 11 }}>Todas las peticiones de la suite pasan por el limiter global y respetan scope. La ronda de race exige <code>manualConfirm:true</code>, máximo 3 peticiones y no completa transacciones.</p>
          <div style={{ fontSize: 11 }}><strong>Objetivo:</strong> <code>{tgt}</code></div>
        </div>
      )}

      {results && (
        <div className="card">
          <h3>📊 Resumen</h3>
          <div className="kv"><span className="k">Hallazgos</span><span className="v">{(results.findings || []).length}</span></div>
          {(results.findings || []).map((f, i) => (
            <div className="finding" key={i} style={{ cursor: 'pointer' }} onClick={() => {
              const detail = JSON.stringify(f, null, 2);
              if (navigator.clipboard) {
                navigator.clipboard.writeText(detail);
                setToast('📋 Hallazgo copiado al portapapeles');
              }
            }}>
              <span className="f-type">[{f.type}]</span>
              <span className="f-sum">{f.summary}</span>
              <span className="f-sev"><span className={`badge badge-ok`}>{f.severity}</span></span>
            </div>
          ))}
          {results.findings?.length > 0 && (
            <button className="btn btn-sm btn-outline" style={{ marginTop: 8 }} onClick={() => {
              if (confirm('¿Borrar todos los hallazgos de esta sesión?')) {
                api('/session', { method: 'DELETE' }).then(() => {
                  setResults(null);
                  setToast('✅ Hallazgos borrados');
                  api('/session').then(setSession);
                });
              }
            }}>🗑️ Borrar hallazgos</button>
          )}
        </div>
      )}
    </div>
  );
}