import React, { useState, useEffect } from 'react';

const POLL_MS = 8000;

export default function Targets({ api }) {
  const [targets, setTargets] = useState({});
  const [running, setRunning] = useState(null);
  const [log, setLog] = useState('');
  const [canary, setCanary] = useState(null);
  const [bidi, setBidi] = useState(null);

  const refresh = async () => {
    try {
      const r = await api('/targets/status');
      setTargets(r);
    } catch {}
    try {
      const c = await api('/canary/status');
      setCanary(c);
    } catch {}
    try {
      const b = await api('/bidi/status');
      setBidi(b);
    } catch {}
  };

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [api]);

  const run = async (endpoint, label) => {
    if (running) return;
    setRunning(label);
    setLog(`[${new Date().toLocaleTimeString()}] Arrancando ${label}...\n`);
    try {
      const r = await api(`/targets/${endpoint}`, { method: 'POST', body: '{}' });
      setLog(prev => prev + `[${new Date().toLocaleTimeString()}] ${r.output || r.error || JSON.stringify(r)}\n`);
    } catch (e) {
      setLog(prev => prev + `[${new Date().toLocaleTimeString()}] Error: ${e.message}\n`);
    }
    setRunning(null);
    refresh();
  };

  const StatusDot = ({ ok }) => (
    <span style={{ color: ok ? 'var(--green)' : 'var(--red)', marginRight: 6 }}>●</span>
  );

  return (
    <div>
      <h2>🎯 Targets</h2>

      {/* Infrastructure */}
      <div className="card">
        <h3>Infraestructura</h3>
        <div className="kv"><span className="k"><StatusDot ok={canary?.alive} />Canary :8210</span><span className="v">{canary?.alive ? 'Activo' : 'Inactivo'}</span></div>
        <div className="kv"><span className="k"><StatusDot ok={bidi?.alive} />BiDi :9344</span><span className="v">{bidi?.alive ? 'Activo' : 'Inactivo'}</span></div>
        <div className="kv"><span className="k"><StatusDot ok={targets?.firefox} />Firefox</span><span className="v">{targets?.firefox ? 'Abierto' : 'Cerrado'}</span></div>
      </div>

      {/* OpenAI */}
      <div className="card" style={{ borderLeft: '3px solid var(--yellow)' }}>
        <h3>🤖 OpenAI — Safety Bug Bounty</h3>
        <div className="kv"><span className="k">Programa</span><span className="v">bugcrowd.com/engagements/openai-safety</span></div>
        <div className="kv"><span className="k">Flag anti-abuso</span><span className="v" style={{ color: targets?.openaiFlag ? 'var(--red)' : 'var(--green)' }}>{targets?.openaiFlag ? '🔴 ACTIVO (403)' : '🟢 Libre'}</span></div>
        <div className="kv"><span className="k">Confirmaciones</span><span className="v">{targets?.openaiConfirmations || 0}×</span></div>
        <div className="kv"><span className="k">Próxima ventana</span><span className="v">{targets?.openaiNextWindow || '10-sep'}</span></div>
        <div className="kv"><span className="k">E13 (Bugcrowd)</span><span className="v" style={{ color: 'var(--primary)' }}>{targets?.e13Status || 'In progress'}</span></div>
        <div style={{ marginTop: 10 }}>
          <button
            className="btn"
            disabled={!!running || targets?.openaiFlag}
            onClick={() => run('v6-openai', 'V6 OpenAI')}
            style={{ opacity: running || targets?.openaiFlag ? 0.5 : 1 }}
          >
            {targets?.openaiFlag ? '🚩 Flag activo — esperar' : running === 'V6 OpenAI' ? '⏳ Ejecutando...' : '🚀 Lanzar V6 OpenAI'}
          </button>
        </div>
      </div>

      {/* Cloudflare */}
      <div className="card" style={{ borderLeft: '3px solid var(--primary)' }}>
        <h3>☁️ Cloudflare — AI Playground</h3>
        <div className="kv"><span className="k">Programa</span><span className="v">HackerOne — Cloudflare</span></div>
        <div className="kv"><span className="k">Bounty</span><span className="v">Hasta $20,000+</span></div>
        <div className="kv"><span className="k">Scope IA</span><span className="v">AI Agent, MCP, Prompt Injection</span></div>
        <div className="kv"><span className="k">Login</span><span className="v" style={{ color: targets?.cfLogin ? 'var(--green)' : 'var(--muted)' }}>{targets?.cfLogin ? '✅ Logueado' : '⚠️ No logueado'}</span></div>
        <div className="kv"><span className="k">Account ID</span><span className="v">{targets?.cfAccountId || '—'}</span></div>
        <div className="kv"><span className="k">Workers AI</span><span className="v" style={{ color: targets?.cfWorkersAI ? 'var(--green)' : 'var(--muted)' }}>{targets?.cfWorkersAI ? '✅ Activo' : '⚠️ No activado'}</span></div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn"
            disabled={!!running}
            onClick={() => run('recon-cloudflare', 'Recon Cloudflare')}
          >
            {running === 'Recon Cloudflare' ? '⏳ Recon...' : '🔍 Recon Cloudflare'}
          </button>
          <button
            className="btn"
            disabled={!!running || !targets?.cfLogin}
            onClick={() => run('e16-cloudflare', 'E16 Cloudflare')}
            style={{ opacity: running || !targets?.cfLogin ? 0.5 : 1 }}
          >
            {!targets?.cfLogin ? '⚠️ Login requerido' : running === 'E16 Cloudflare' ? '⏳ E16...' : '🎯 E16 Playground'}
          </button>
        </div>
      </div>

      {/* Zendesk */}
      <div className="card" style={{ borderLeft: '3px solid var(--muted)', opacity: 0.6 }}>
        <h3>🎫 Zendesk — En pausa</h3>
        <div className="kv"><span className="k">Razón</span><span className="v">Trial sin AI agent funcional</span></div>
        <div className="kv"><span className="k">Decisión</span><span className="v">Cloudflare es mejor target</span></div>
      </div>

      {/* Execution log */}
      {log && (
        <div className="card">
          <h3>📟 Log de ejecución</h3>
          <pre style={{ fontSize: 11, color: 'var(--green)', whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{log}</pre>
        </div>
      )}
    </div>
  );
}
