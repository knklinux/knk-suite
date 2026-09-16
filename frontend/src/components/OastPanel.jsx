import React, { useCallback, useEffect, useState } from 'react';

// ============================================================================
// OastPanel.jsx — OAST integrado (protocolo interactsh)
//
// Flujo: Conectar (registro RSA contra el servidor) → Generar payload →
// inyectarlo donde sospechas SSRF/XXE/RCE ciego → si el objetivo llama a
// casa, el golpe aparece correlacionado y se convierte en hallazgo con
// evidencia en disco (o lo conviertes a mano con el botón).
// ============================================================================

const BTN = { fontSize: 11, padding: '6px 12px', fontFamily: 'monospace' };

const PROTO_COLOR = {
  dns: 'var(--primary)', http: 'var(--green)', https: 'var(--green)',
  smtp: 'var(--yellow)', ldap: '#ff7ac6', smb: 'var(--red)',
};

function Card({ children, style }) {
  return <div className="card" style={{ marginBottom: 12, ...style }}>{children}</div>;
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-sm btn-outline"
      style={{ fontSize: 9, padding: '2px 6px' }}
      onClick={async () => { try { await navigator.clipboard.writeText(text); } catch { /* sin permiso */ } setDone(true); setTimeout(() => setDone(false), 1200); }}
      title={`Copiar: ${text}`}
    >
      {done ? '✓' : '⧉'}
    </button>
  );
}

export default function OastPanel({ api }) {
  const [status, setStatus] = useState(null);
  const [payloads, setPayloads] = useState([]);
  const [hits, setHits] = useState([]);
  const [server, setServer] = useState('');
  const [token, setToken] = useState('');
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const [st, pl, ht] = await Promise.all([api('/oast/status'), api('/oast/payloads'), api('/oast/hits?limit=60')]);
      setStatus(st);
      if (pl?.payloads) setPayloads(pl.payloads);
      if (ht?.hits) setHits(ht.hits);
      setError((st && st.lastError) || '');
    } catch (e) { setError(e?.message || 'no se pudo leer el estado OAST'); }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, status?.polling ? 5000 : 15000);
    return () => clearInterval(t);
  }, [load, status?.polling]);

  const run = async (key, fn, okMsg) => {
    setBusy((b) => ({ ...b, [key]: true }));
    setError(''); setInfo('');
    try {
      const res = await fn();
      if (res && res.ok === false) setError(res.error || 'fallo la operación');
      else if (okMsg) setInfo(typeof okMsg === 'function' ? okMsg(res) : okMsg);
      await load();
      return res;
    } catch (e) { setError(e?.message || 'fallo la operación'); return null; }
    finally { setBusy((b) => ({ ...b, [key]: false })); }
  };

  const connect = () => run('start',
    () => api('/oast/start', { method: 'POST', body: JSON.stringify({ server: server.trim() || undefined, token: token.trim() || undefined, autoCreateFindings: auto }) }),
    (r) => `Conectado a ${r.server} · CID ${r.correlationId}`);

  const disconnect = () => run('stop', () => api('/oast/stop', { method: 'POST', body: JSON.stringify({}) }), 'Desconectado.');

  const genPayloads = (count) => run(`gen${count}`,
    () => api('/oast/payloads', { method: 'POST', body: JSON.stringify({ count }) }),
    (r) => `${r.payloads.length} payload(s) nuevo(s)`);

  const pollNow = () => run('poll', () => api('/oast/poll', { method: 'POST', body: JSON.stringify({}) }),
    (r) => (r.new ? `${r.new} interacción(es) nueva(s)` : 'sin interacciones nuevas'));

  const convert = (hit) => run(`conv${hit.id}`, () => api(`/oast/hits/${hit.id}/convert`, { method: 'POST', body: JSON.stringify({}) }),
    (r) => `Hallazgo #${r.findingId} creado con evidencia`);

  const reset = () => run('reset', () => api('/oast/reset', { method: 'POST', body: JSON.stringify({}) }), 'Payloads y golpes borrados.');

  const registered = status?.registered;
  const st = status || {};

  return (
    <div style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22 }}>📡</span>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: '#fff', fontFamily: "'Courier New', monospace" }}>OAST · OUT-OF-BAND</h3>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            protocolo interactsh · SSRF/XXE/RCE ciego · cada golpe → hallazgo con evidencia
          </div>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {st.server && <span className="chip" style={{ fontSize: 10, fontFamily: 'monospace' }}>{st.server}</span>}
          {st.polling && <span className="chip" style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--green)' }}>● polling {Math.round((st.intervalMs || 5000) / 1000)}s</span>}
        </span>
      </div>

      {(error || info) && (
        <Card style={{ borderColor: error ? 'rgba(255,80,80,0.4)' : 'rgba(0,255,136,0.3)', background: error ? 'rgba(255,80,80,0.08)' : 'rgba(0,255,136,0.06)' }}>
          <div style={{ fontSize: 11, color: error ? 'var(--red)' : 'var(--green)', fontFamily: 'monospace' }}>
            {error ? `⚠️ ${error}` : `ℹ️ ${info}`}
          </div>
        </Card>
      )}

      {!registered ? (
        <Card>
          <div style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 700, marginBottom: 6 }}>Sin conexión a un servidor OAST</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 10 }}>
            Por defecto usa los servidores públicos de projectdiscovery (oast.pro, oast.live, …). Si lo prefieres,
            apunta a tu servidor self-hosted (recomendado para bounty serio: dominio propio, sin colas ajenas).
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input className="input" style={{ fontSize: 11, flex: '1 1 220px', fontFamily: 'monospace' }}
              placeholder="servidor (vacío = oast.pro,oast.live,…) "
              value={server} onChange={(e) => setServer(e.target.value)} />
            <input className="input" style={{ fontSize: 11, width: 180, fontFamily: 'monospace' }}
              placeholder="token (self-hosted)" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <label style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            convertir cada golpe en hallazgo automáticamente
          </label>
          <button className="btn btn-sm" style={{ ...BTN, marginTop: 10 }} onClick={connect} disabled={busy.start}>
            {busy.start ? '⏳ Registrando (RSA)…' : '⚡ Conectar'}
          </button>
        </Card>
      ) : (
        <>
          <Card style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {[
              ['payloads', st.payloads, 'var(--primary)'],
              ['golpes', st.hits, st.hits ? 'var(--green)' : 'var(--muted)'],
              ['CID', st.correlationId || '—', 'var(--text)'],
              ['auto→hallazgo', st.autoCreateFindings ? 'sí' : 'no', st.autoCreateFindings ? 'var(--green)' : 'var(--muted)'],
              ['último poll', st.lastPollAt ? new Date(st.lastPollAt).toLocaleTimeString() : '—', 'var(--muted)'],
            ].map(([label, value, color]) => (
              <div key={label}>
                <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>{label}</div>
              </div>
            ))}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-outline" style={BTN} onClick={pollNow} disabled={busy.poll}>⚡ Poll ahora</button>
              <button className="btn btn-sm btn-outline" style={BTN} onClick={disconnect} disabled={busy.stop}>✕ Desconectar</button>
            </div>
          </Card>

          <Card>
            <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, marginBottom: 6, fontFamily: 'monospace' }}>PAYLOADS OOB</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 8 }}>
              Inyecta el dominio (URL, host de XXE, LDAP…) donde sospechas la vulnerabilidad. Cada subdominio es único:
              el golpe que llegue se correlaciona con este payload exacto.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button className="btn btn-sm" style={BTN} onClick={() => genPayloads(1)} disabled={busy.gen1}>+ 1 payload</button>
              <button className="btn btn-sm btn-outline" style={BTN} onClick={() => genPayloads(5)} disabled={busy.gen5}>+ 5</button>
              <button className="btn btn-sm btn-outline" style={{ ...BTN, marginLeft: 'auto', color: 'var(--red)' }} onClick={reset} disabled={busy.reset}>Limpiar</button>
            </div>
            {payloads.length === 0 ? (
              <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>Sin payloads todavía.</div>
            ) : (
              <div style={{ maxHeight: 180, overflow: 'auto' }}>
                {payloads.map((p) => (
                  <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: p.hits ? 'var(--green)' : 'var(--text)' }}>{p.domain}</span>
                    <CopyBtn text={p.domain} />
                    <CopyBtn text={p.httpUrl} />
                    <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'monospace', color: p.hits ? 'var(--green)' : 'var(--muted)' }}>
                      {p.hits ? `${p.hits} golpe(s)${p.findingId ? ` · hallazgo #${p.findingId}` : ''}` : 'sin golpes'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, fontFamily: 'monospace' }}>GOLPES ({hits.length})</span>
              <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px' }} onClick={load}>↺</button>
            </div>
            {hits.length === 0 ? (
              <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                Sin interacciones. Cuando el objetivo resuelva o llame a un payload, aparecerá aquí (poll cada {Math.round((st.intervalMs || 5000) / 1000)}s).
              </div>
            ) : (
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {hits.map((h) => (
                  <div key={h.id} style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: PROTO_COLOR[h.protocol] || 'var(--text)', fontWeight: 700 }}>
                        {h.protocol.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 10, fontFamily: 'monospace' }}>{h.payload}</span>
                      <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>desde {h.remoteAddress || '—'}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                      {h.unknown && <span style={{ fontSize: 9, color: 'var(--yellow)', fontFamily: 'monospace' }}>sesión anterior</span>}
                      {h.findingId ? (
                        <span style={{ fontSize: 9, color: 'var(--green)', fontFamily: 'monospace' }}>→ hallazgo #{h.findingId}</span>
                      ) : (
                        <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 8px' }} onClick={() => convert(h)} disabled={busy[`conv${h.id}`]}>
                          {busy[`conv${h.id}`] ? '⏳' : '＋ crear hallazgo'}
                        </button>
                      )}
                      {h.rawRequest && (
                        <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 8px' }} onClick={() => setExpanded(expanded === h.id ? null : h.id)}>
                          {expanded === h.id ? '− request' : '+ request'}
                        </button>
                      )}
                    </div>
                    {expanded === h.id && (
                      <pre style={{ background: '#010409', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 9, fontFamily: 'monospace', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', marginTop: 6 }}>
                        {h.rawRequest}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <Card style={{ opacity: 0.8 }}>
        <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>
          Protocolo interactsh (projectdiscovery). Los servidores públicos son compartidos: para bounty
          profesional considera un servidor self-hosted con tu dominio. Los payloads de sesiones anteriores
          siguen resolviendo, pero sus golpes llegan marcados como «sesión anterior» y no se convierten solos.
        </div>
      </Card>
    </div>
  );
}
