import React, { useCallback, useEffect, useState } from 'react';

// ============================================================================
// ProxyPanel.jsx — Proxy local estilo Burp (lib/proxy.js)
//
// Configura el navegador con proxy 127.0.0.1:<port> (y la CA de knkLinux para
// HTTPS) y todo el tráfico pasa por aquí: interceptor con edición, historial
// con cuerpos y replay. El botón "→ Repeater" navega al módulo Repeater con
// la petición precargada.
// ============================================================================

const monoArea = { width: '100%', fontFamily: 'monospace', fontSize: 11, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 6, padding: 8, minHeight: 120 };

function statusColor(code) {
  if (!code) return 'var(--muted)';
  if (code >= 500) return '#f85149';
  if (code >= 400) return '#d29922';
  if (code >= 300) return '#58a6ff';
  if (code >= 200) return '#3fb950';
  return 'var(--muted)';
}

export default function ProxyPanel({ api, go, sendToRepeater }) {
  const [st, setSt] = useState(null);
  const [port, setPort] = useState('8083');
  const [intercept, setIntercept] = useState(false);
const [strict, setStrict] = useState(false);
  const [pending, setPending] = useState([]);
  const [selected, setSelected] = useState(null);   // petición pendiente seleccionada
  const [editedRaw, setEditedRaw] = useState('');
  const [history, setHistory] = useState([]);
  const [q, setQ] = useState('');
  const [entry, setEntry] = useState(null);          // entrada de historial seleccionada
  const [replayRaw, setReplayRaw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(null); // scanner pasivo

  const refresh = useCallback(async () => {
    const s = await api('/proxy/status').catch(() => null);
    if (s) { setSt(s); setIntercept(Boolean(s.intercept)); setStrict(Boolean(s.strict)); }
    const sc = await api('/proxy/scanner').catch(() => null);
    if (sc) setScan(sc);
    if (s?.running) {
      const p = await api('/proxy/pending').catch(() => null);
      if (p) setPending(p.pending || []);
      const h = await api(`/proxy/history?limit=100&q=${encodeURIComponent(q)}`).catch(() => null);
      if (h) setHistory(h.entries || []);
    }
  }, [api, q]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const t = setInterval(refresh, 2000); return () => clearInterval(t); }, [refresh]);

  const action = async (verb, body) => {
    setBusy(true);
    try { const r = await api(`/proxy/${verb}`, { method: 'POST', body: JSON.stringify(body || {}) }); setMsg(r.error ? `❌ ${r.error}` : ''); await refresh(); return r; }
    finally { setBusy(false); }
  };

  const loadPending = async (id) => {
    const found = pending.find((p) => p.id === id);
    setSelected(found || null);
    setEditedRaw(found?.raw || '');
  };

  const resolve = async (action_) => {
    if (!selected) return;
    const body = action_ === 'drop' ? { action: 'drop' } : { action: 'forward', raw: editedRaw };
    const r = await api(`/proxy/pending/${selected.id}/resolve`, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) setMsg(`❌ ${r.error}`);
    setSelected(null); setEditedRaw('');
    await refresh();
  };

  const openEntry = async (id) => {
    const e = await api(`/proxy/history/${id}`).catch(() => null);
    if (e?.entry) { setEntry(e.entry); setReplayRaw(e.entry.raw || ''); }
  };

  const replay = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      const r = await api(`/proxy/replay/${entry.id}`, { method: 'POST', body: JSON.stringify({ raw: replayRaw }) });
      if (r.ok) { setMsg('✅ reenviada'); await refresh(); } else setMsg(`❌ ${r.error}`);
    } finally { setBusy(false); }
  };

  const toRepeater = () => {
    const raw = entry?.raw || editedRaw;
    if (raw && sendToRepeater) { sendToRepeater(raw); go('repeater'); }
  };

  // → Intruder: pide al backend la petición con posiciones §…§ ya marcadas
  // (primer parámetro de query y de cuerpo) y la carga en el Repeater, cuyo
  // Intruder de abajo queda listo para elegir payload set y lanzar.
  const toIntruder = async () => {
    if (!entry) return;
    try {
      const r = await api(`/intruder/from-proxy/${entry.id}`);
      if (r?.ok && sendToRepeater) { sendToRepeater(r.raw); go('repeater'); }
      else setMsg(r?.error || 'no se pudo preparar la petición para el Intruder');
    } catch { setMsg('error de red'); }
  };

  return (
    <div style={{ color: 'var(--text)' }}>
      {msg && <div className="toast" onClick={() => setMsg('')}>{msg}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#fff', fontFamily: "'Courier New', monospace" }}>🛰️ Proxy local (estilo Burp)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!st?.running ? (
              <>
                <input value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 80, padding: '4px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
                <button className="btn btn-sm" onClick={() => action('start', { port: Number(port) })} disabled={busy}>▶ Arrancar</button>
              </>
            ) : (
              <button className="btn btn-sm btn-outline" onClick={() => action('stop')} disabled={busy}>■ Parar</button>
            )}
            <button className="btn btn-sm btn-outline" onClick={() => window.open('/api/proxy/ca.crt', '_blank')} title="Instala esta CA en tu navegador/SO para descifrar HTTPS">⬇ CA</button>
          </div>
        </div>
        {st && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 11 }}>
            <span className={`badge ${st.running ? 'badge-ok' : 'badge-warn'}`}>{st.running ? `activo · 127.0.0.1:${st.port}` : 'parado'}</span>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={intercept} onChange={(e) => action('intercept', { on: e.target.checked })} /> interceptor
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }} title="Modo Burp estricto: las peticiones fuera de scope se dropean (403) en vez de reenviarse. Se registran como dropped.">
              <input type="checkbox" checked={strict} onChange={(e) => action('strict', { enabled: e.target.checked })} /> 🛡️ estricto
            </label>
            <span className="muted">pendientes: {st.pending}</span>
            <span className="muted">historial: {st.historySize}</span>
            <span className="muted" title={st.caFingerprint || ''}>CA: ~/.knk-suite/mitm/knk-mitm-ca.crt</span>
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, fontFamily: 'monospace' }}>
          Configura tu navegador con proxy HTTP 127.0.0.1:{st?.port || '<puerto>'}. Descarga la CA e instálala como autoridad raíz para ver HTTPS descifrado. Los WebSockets pasan como túnel ciego. Los hosts privados/loopback están bloqueados salvo KNK_PROXY_ALLOW_PRIVATE=1.
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>🔍 Scanner pasivo {scan?.enabled === false && <span className="badge badge-warn" style={{ fontSize: 9 }}>OFF</span>}</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-outline" onClick={async () => { await api('/proxy/scanner', { method: 'POST', body: JSON.stringify({ enabled: !(scan?.enabled !== false) }) }); refresh(); }}>
              {scan?.enabled === false ? 'activar' : 'pausar'}
            </button>
            <button className="btn btn-sm" onClick={async () => { const r = await api('/proxy/scanner/flush', { method: 'POST', body: '{}' }).catch(() => null); setMsg(r ? `hallazgos creados/actualizados: ${r.created}` : 'no se pudo vaciar'); refresh(); }} title="vaciar candidatos acumulados como hallazgos de la misión">
              → hallazgos {scan && (scan.secretsFound + scan.hostsMissingHeaders + scan.hostsWithCookieIssues) > 0 ? `(${scan.secretsFound + scan.hostsMissingHeaders + scan.hostsWithCookieIssues})` : ''}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
          <span className="muted">respuestas analizadas: {scan?.scanned ?? 0}</span>
          <span className="muted">hosts sin cabeceras de seguridad: {scan?.hostsMissingHeaders ?? 0}</span>
          <span className="muted">hosts con cookies sin flags: {scan?.hostsWithCookieIssues ?? 0}</span>
          <span className="muted">secretos detectados: {scan?.secretsFound ?? 0}</span>
        </div>
        {scan?.secrets?.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {scan.secrets.map((s, i) => (
              <div key={i} style={{ fontSize: 10, padding: '3px 0', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                <span className={`badge ${s.severity === 'critical' || s.severity === 'high' ? 'badge-err' : 'badge-warn'}`} style={{ fontSize: 9 }}>{s.severity}</span>{' '}
                <code>{s.label}</code> <span className="muted">{s.redacted}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6 }}>
          Analiza las respuestas que ya atraviesan el proxy (sin tráfico extra): cabeceras de seguridad ausentes, cookies sin HttpOnly/Secure/SameSite y secretos expuestos (AWS/GCP/JWT/Slack/GitHub…). Los hallazgos se crean con el botón "→ hallazgos" o automáticamente al Parar el proxy; los secretos se guardan SIEMPRE redactados.
        </div>
      </div>

      {st?.running && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>⏸️ Interceptor {intercept === false && <span className="muted" style={{ fontSize: 10 }}>(interceptor OFF — mostrando peticiones retenidas si las hay)</span>}</h3>
            {pending.length === 0 && <p className="muted" style={{ fontSize: 11 }}>Sin peticiones retenidas. Activa el interceptor y navega por el objetivo.</p>}
            <div style={{ display: 'grid', gap: 6 }}>
              {pending.map((p) => (
                <div key={p.id} onClick={() => loadPending(p.id)} style={{ cursor: 'pointer', border: `1px solid ${selected?.id === p.id ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6, padding: 8, background: selected?.id === p.id ? 'rgba(8,216,255,0.08)' : 'var(--panel)' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#fff' }}>{p.method} {p.url}</span>
                </div>
              ))}
            </div>
            {selected && (
              <div style={{ marginTop: 10 }}>
                <textarea value={editedRaw} onChange={(e) => setEditedRaw(e.target.value)} style={{ ...monoArea, minHeight: 160 }} spellCheck={false} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => resolve('forward')}>▶ Reenviar</button>
                  <button className="btn btn-sm btn-outline" onClick={() => resolve('drop')}>✖ Descartar</button>
                  <button className="btn btn-sm btn-outline" onClick={toRepeater}>→ Repeater</button>
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 13 }}>📜 HTTP History</h3>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="filtrar por host, método o status…" style={{ flex: 1, padding: '4px 10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 11 }} />
            </div>
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'monospace' }}>
                <thead><tr style={{ position: 'sticky', top: 0, background: 'var(--panel)' }}><th style={{ textAlign: 'left', padding: 6 }}>Método</th><th style={{ textAlign: 'left', padding: 6 }}>URL</th><th style={{ textAlign: 'left', padding: 6 }}>Status</th><th style={{ textAlign: 'left', padding: 6 }}>ms</th></tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} onClick={() => openEntry(h.id)} style={{ cursor: 'pointer', background: entry?.id === h.id ? 'rgba(8,216,255,0.08)' : 'transparent' }}>
                      <td style={{ padding: '4px 6px', color: '#fff' }}>{h.method}</td>
                      <td style={{ padding: '4px 6px', color: 'var(--muted)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</td>
                      <td style={{ padding: '4px 6px', color: statusColor(h.status) }}>{h.status || '—'}</td>
                      <td style={{ padding: '4px 6px', color: 'var(--muted)' }}>{h.durationMs ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {history.length === 0 && <div style={{ padding: 12, fontSize: 11 }} className="muted">Historial vacío.</div>}
            </div>
            {entry && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, marginBottom: 6, color: '#fff' }}>{entry.method} {entry.url} → <span style={{ color: statusColor(entry.status) }}>{entry.status || '—'}</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <textarea value={replayRaw} onChange={(e) => setReplayRaw(e.target.value)} style={{ ...monoArea, minHeight: 200 }} spellCheck={false} />
                  <textarea readOnly value={entry.resBodyPreview || '(sin cuerpo)'} style={{ ...monoArea, minHeight: 200 }} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={replay} disabled={busy}>🔁 Replay</button>
                  <button className="btn btn-sm btn-outline" onClick={toRepeater}>→ Repeater</button>
                  <button className="btn btn-sm btn-outline" onClick={toIntruder} title="marca posiciones §…§ y abre el Intruder con payload sets del servidor">🎯 → Intruder</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
