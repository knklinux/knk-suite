import React, { useState, useEffect } from 'react';

// Param Hunter — caza de parámetros reflejados con canario inofensivo.
// Flujo de la hoja de trucos (descubrir → entender → trazar → codificación →
// validar autorizado) integrado en la suite. Sin payloads: solo señala
// candidatos; la validación manual se hace en el Repeater.
const BEHAVIOR_BADGE = {
  reflected: ['badge-err', 'reflejado'],
  encoded: ['badge-ok', 'codificado'],
  param_exists: ['badge-warn', 'existe'],
  sqli_error: ['badge-err', 'error BD'],
  redirect_param: ['badge-warn', 'redirige 30x'],
  not_found: ['', 'sin efecto'],
  error: ['', 'error'],
};

const PRIORITY_COLOR = { P1: 'var(--red)', P2: '#f97316', P3: 'var(--yellow)', P4: 'var(--muted)', '—': 'var(--muted)' };

export default function ParamHunter({ api, go, sendToRepeater }) {
  const [wordlists, setWordlists] = useState([]);
  const [url, setUrl] = useState('');
  const [wl, setWl] = useState('all');
  const [limit, setLimit] = useState(25);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [saved, setSaved] = useState({});
  const [useHistory, setUseHistory] = useState(true);
  const [mode, setMode] = useState('query');

  useEffect(() => { api('/params/wordlists').then((r) => r && setWordlists(r.wordlists || [])).catch(() => {}); }, [api]);

  const hunt = async () => {
    if (!url.trim()) { setMsg('introduce la URL objetivo (con scope de la sesión)'); return; }
    setBusy(true); setMsg(''); setResult(null); setSaved({});
    try {
      const r = await api('/params/hunt', { method: 'POST', body: JSON.stringify({ url, wordlist: wl, limit: Number(limit) || 25, useHistory, mode }) });
      if (r && r.ok) setResult(r); else setMsg((r && r.error) || 'la caza falló');
    } catch { setMsg('error de red'); }
    setBusy(false);
  };

  const toRepeater = (row) => {
    if (!sendToRepeater) return;
    try {
      const u = new URL(result.url);
      u.searchParams.set(row.param, 'CANARIO');
      const raw = `GET ${u.pathname + u.search} HTTP/1.1\nHost: ${u.hostname}\nAccept: */*\nConnection: close`;
      sendToRepeater(raw);
      go('repeater');
    } catch { setMsg('URL inválida para Repeater'); }
  };

  const saveFinding = async (row) => {
    try {
      const r = await api('/params/finding', { method: 'POST', body: JSON.stringify({ url: result.url, param: row.param, behavior: row.behavior, context: row.context, priority: row.priority, detail: row.detail }) });
      if (r && r.ok) setSaved((p) => ({ ...p, [row.param]: r.id }));
      else setMsg((r && r.error) || 'no se pudo guardar');
    } catch { setMsg('error de red'); }
  };

  return (
    <div>
      <div className="card">
        <span className="eyebrow">PARAM HUNTER</span>
        <h2>Caza de parámetros reflejados</h2>
        <p className="muted" style={{ fontSize: 11 }}>
          Flujo de la hoja de trucos: <b>descubrir</b> parámetros → <b>entender</b> su propósito →
          <b> trazar</b> dónde se refleja la entrada → comprobar la <b>codificación de salida</b> →
          <b> validar</b> de forma segura en un entorno autorizado. Sin payloads: manda un canario
          alfanumérico único y clasifica la respuesta. Requiere el host en el <b>scope de la sesión</b> (Targets).
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://objetivo.com/buscar?q=test"
            style={{ flex: 1, minWidth: 260, background: '#0a101d', color: 'var(--text)', border: '1px solid #16314b', borderRadius: 6, padding: '6px 8px', fontSize: 12 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) hunt(); }} />
          <select value={wl} onChange={(e) => setWl(e.target.value)} style={{ fontSize: 11, background: '#0a101d', color: 'var(--text)', border: '1px solid #16314b', borderRadius: 6, padding: '4px 6px' }}>
            {wordlists.map((w) => <option key={w.id} value={w.id}>{w.label} ({w.count})</option>)}
          </select>
          <select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} style={{ fontSize: 11, background: '#0a101d', color: 'var(--text)', border: '1px solid #16314b', borderRadius: 6, padding: '4px 6px' }}>
            {[15, 25, 40, 60].map((n) => <option key={n} value={n}>máx {n}</option>)}
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)} title="GET: parámetros en la query · POST: campos en el cuerpo de un formulario urlencoded (usa los campos capturados por el proxy)" style={{ fontSize: 11, background: '#0a101d', color: 'var(--text)', border: '1px solid #16314b', borderRadius: 6, padding: '4px 6px' }}>
            <option value="query">GET · query</option>
            <option value="form">POST · formulario</option>
            <option value="hpp">GET · HPP (duplicado)</option>
          </select>
          <button className="btn" onClick={hunt} disabled={busy}>{busy ? 'cazando…' : '🎯 cazar parámetros'}</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }} title="Los parámetros que la app ya usa en tráfico real (capturados por el proxy) se prueban antes que las wordlists">
          <input type="checkbox" checked={useHistory} onChange={(e) => setUseHistory(e.target.checked)} />
          priorizar parámetros vistos en el historial del proxy (por frecuencia)
        </label>
        {mode === 'form' && (
          <p className="muted" style={{ fontSize: 10, margin: '4px 0 0' }}>
            Modo POST: cada sonda envía un formulario urlencoded con UN campo al canario — nunca se
            reenvían valores capturados (contraseñas, tokens, carritos). Se prueban primero los campos
            vistos en cuerpos capturados por el proxy (urlencoded y JSON).
          </p>
        )}
        {msg && <span style={{ fontSize: 11, color: 'var(--yellow)' }}>{msg}</span>}
      </div>

      {result && (
        <div className="card">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Resultados — {result.probed} parámetros probados</h3>
            <span className="badge badge-err">reflejados: {result.reflected}</span>
            <span className="badge badge-ok">codificados: {result.encoded}</span>
            <span className="badge badge-warn">existentes: {result.exists}</span>
            {result.sqliErrors > 0 && <span className="badge badge-err" title="respuestas con firma de error de base de datos">errores BD: {result.sqliErrors}</span>}
            {result.redirects > 0 && <span className="badge badge-warn" title="30x hacia el probe del mismo host">redirige: {result.redirects}</span>}
            <span className="muted" style={{ fontSize: 10 }}>canario: <code>{result.canary}</code></span>
          </div>
          <span className="muted" style={{ fontSize: 10 }}>wordlist: {result.wordlistLabel} · modo {result.mode === 'form' ? 'POST (formulario)' : 'GET (query)'}{result.mode === 'form' ? ` · ${result.paramsFromBody} del cuerpo capturado` : ` · ${result.paramsFromUrl} de la URL (van primero)`}{result.paramsFromHistory > 0 ? ` · ${result.paramsFromHistory} del historial del proxy` : ''}</span>
          {(result.results || []).map((row) => {
            const [badge, label] = BEHAVIOR_BADGE[row.behavior] || ['', row.behavior];
            return (
              <div key={row.param} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #16314b', fontSize: 11, flexWrap: 'wrap' }}>
                <span style={{ color: PRIORITY_COLOR[row.priority] || 'var(--muted)', fontWeight: 700, minWidth: 24 }}>{row.priority}</span>
                <code style={{ minWidth: 100 }}>{row.param}</code>
                <span className={`badge ${badge}`} style={{ minWidth: 72, textAlign: 'center', fontSize: 9 }}>{label}</span>
                <span className="muted" style={{ fontSize: 10, flex: 1, minWidth: 200 }}>{row.detail}</span>
                {['reflected', 'param_exists', 'sqli_error', 'redirect_param'].includes(row.behavior) && (
                  <>
                    <button className="btn btn-sm" onClick={() => toRepeater(row)} title="abrir en el Repeater con el parámetro precargado">→ Repeater</button>
                    {!saved[row.param]
                      ? <button className="btn btn-sm" onClick={() => saveFinding(row)} title="guardar como hallazgo de la misión">hallazgo</button>
                      : <span className="badge badge-ok" style={{ fontSize: 9 }}>guardado #{saved[row.param]}</span>}
                  </>
                )}
              </div>
            );
          })}
          <p className="muted" style={{ fontSize: 10, marginTop: 8 }}>⚡ {result.reminder}</p>
        </div>
      )}
    </div>
  );
}
