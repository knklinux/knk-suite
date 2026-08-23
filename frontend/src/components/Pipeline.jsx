import React, { useState, useEffect } from 'react';

export default function Pipeline({ api }) {
  const [session, setSession] = useState({});
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [phaseOutputs, setPhaseOutputs] = useState({});
  const [paused, setPaused] = useState(null);
  const [results, setResults] = useState(null);
  const [toast, setToast] = useState('');

  const phases = ['plan', 'recon', 'scan', 'fuzz', 'exploit', 'reporte', 'verificar'];
  const emoji = { plan: '📋', recon: '🔍', scan: '🛡️', fuzz: '🚀', exploit: '✅', reporte: '📝', verificar: '🔎' };

  useEffect(() => { api('/session').then(setSession); }, [api]);

  const runPhase = async (phaseId) => {
    const r = await api('/pipeline/run', { method: 'POST', body: JSON.stringify({ phase: phaseId }) });
    setPhaseOutputs(prev => ({ ...prev, [phaseId]: r }));
    return r;
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

      <div className="card">
        <h3>▶ Pipeline automático + manual</h3>
        <p className="muted">Auto: PLAN → RECON → SCAN | Manual: FUZZ → EXPLOIT | Auto: REPORTE → VERIFICAR</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={startPipeline} disabled={running}>
            {running ? '⏳...' : paused ? '▶ Continuar' : '🚀 Ejecutar pipeline'}
          </button>
          {paused && <button className="btn btn-green" onClick={() => continueAfter(paused)}>▶ Después de {paused}</button>}
        </div>
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
                  ? (p === 'recon' ? `${phaseOutputs[p].output?.totalSubs || 0} subdominios`
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
          <h3 style={{ color: 'var(--yellow)' }}>🔍 Comandos de fuzzing — copia en Terminal Kali</h3>
          {[
            ['ffuf', `ffuf -u https://${tgt}/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302,403 -t 1`],
            ['nmap', `nmap -sV -p 80,443,8080 ${tgt}`],
            ['nuclei', `nuclei -u https://${tgt} -t http/misconfiguration -silent -timeout 5`],
            ['subfinder', `subfinder -d ${tgt} -silent`],
            ['whatweb', `whatweb https://${tgt}`],
          ].map(([name, cmd]) => (
            <div key={name} style={{ fontSize: 11, marginBottom: 4 }}>
              <strong>{name}:</strong> <code style={{ fontSize: 10 }}>{cmd}</code>
            </div>
          ))}
        </div>
      )}

      {paused === 'exploit' && (
        <div className="card" style={{ borderColor: 'var(--yellow)' }}>
          <h3 style={{ color: 'var(--yellow)' }}>🔓 Comandos de explotación — copia en Terminal Kali</h3>
          {[
            ['CORS', `curl -sI -H "Origin: https://evil.example" https://${tgt}`],
            ['IDOR', `curl -s https://${tgt}/api/users/OTHER_ID`],
            ['XSS', `curl -s "https://${tgt}/search?q=<script>alert(1)</script>"`],
            ['SSRF', `curl -s "https://${tgt}/fetch?url=http://127.0.0.1"`],
            ['SQLi', `sqlmap -u "https://${tgt}/page?id=1" --batch --level=1`],
          ].map(([name, cmd]) => (
            <div key={name} style={{ fontSize: 11, marginBottom: 4 }}>
              <strong>{name}:</strong> <code style={{ fontSize: 10 }}>{cmd}</code>
            </div>
          ))}
        </div>
      )}

      {results && (
        <div className="card">
          <h3>📊 Resumen</h3>
          <div className="kv"><span className="k">Hallazgos</span><span className="v">{(results.findings || []).length}</span></div>
          {(results.findings || []).map((f, i) => (
            <div className="finding" key={i}>
              <span className="f-type">[{f.type}]</span>
              <span className="f-sum">{f.summary}</span>
              <span className="f-sev"><span className={`badge badge-ok`}>{f.severity}</span></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}