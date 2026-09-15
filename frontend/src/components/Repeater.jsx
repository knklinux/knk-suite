import React, { useEffect, useRef, useState } from 'react';

// Repeater + Intruder — cliente HTTP manual estilo Burp: editas la petición
// cruda, la reenvías cuando quieres, y comparas respuestas. El Intruder añade
// fuzzing PEQUEÑO sobre la misma petición: marcas posiciones con §...§ y
// aporta TUS payloads (uno por línea). Caps duros server-side (≤100 peticiones,
// ≤50 payloads, ≤3 en vuelo) y cada petición pasa por el limiter global
// (≥800 ms), el scope de la sesión y el anti-SSRF. Nada masivo, nada oculto.

const SAMPLE = `GET / HTTP/1.1
Host: TU-TARGET.com
Accept: */*
Accept-Language: es-ES,es;q=0.9
Connection: close`;

const SAMPLE_FUZZ = `GET /api/item?id=§1§ HTTP/1.1
Host: TU-TARGET.com
Accept: */*
Connection: close`;

function statusColor(code) {
  if (!code) return 'var(--muted)';
  if (code >= 500) return 'var(--red, #f85149)';
  if (code >= 400) return 'var(--yellow, #d29922)';
  if (code >= 300) return '#58a6ff';
  if (code >= 200) return 'var(--green, #3fb950)';
  return 'var(--muted)';
}

const monoArea = { width: '100%', fontFamily: 'monospace', fontSize: 12, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 6, padding: 10 };

export default function Repeater({ api }) {
  const [raw, setRaw] = useState(SAMPLE);
  const [history, setHistory] = useState([]);   // {send, diff, id}
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [created, setCreated] = useState(null);
  const [maxRedirects, setMaxRedirects] = useState(0);
  const idRef = useRef(0);

  // ── Intruder ──────────────────────────────────────────────────────────────
  const [caps, setCaps] = useState(null);
  const [payloadText, setPayloadText] = useState('');
  const [run, setRun] = useState(null);        // run pública del backend
  const [fuzzBusy, setFuzzBusy] = useState(false);
  const [fuzzError, setFuzzError] = useState(null);
  const [fuzzNote, setFuzzNote] = useState('');
  const [fuzzCreated, setFuzzCreated] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => { api('/intruder/config').then((r) => r?.caps && setCaps(r.caps)).catch(() => {}); }, [api]);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const positions = (raw.match(/§[^§]*§/g) || []).length;
  const payloadCount = payloadText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;
  const projected = positions <= 1 ? payloadCount : payloadCount; // pairwise: 1 req por payload
  const overCaps = caps && (projected > caps.maxTotalRequests || payloadCount > caps.maxPayloads);

  function startFuzz() {
    setFuzzBusy(true); setFuzzError(null); setFuzzCreated(null);
    api('/intruder/start', {
      method: 'POST',
      body: JSON.stringify({ raw, payloadText, maxRedirects: Number(maxRedirects) || 0 }),
    }).then((r) => {
      if (!r.ok) { setFuzzError(r.error || 'no se pudo iniciar'); setFuzzBusy(false); return; }
      setRun(r.run);
      pollRef.current = setInterval(async () => {
        try {
          const cur = await api(`/intruder/run/${r.run.id}`);
          if (cur?.run) {
            setRun(cur.run);
            if (cur.run.status !== 'running') { clearInterval(pollRef.current); pollRef.current = null; setFuzzBusy(false); }
          }
        } catch { /* siguiente tick lo reintenta */ }
      }, 1200);
    }).catch((e) => { setFuzzError(String(e.message || e)); setFuzzBusy(false); });
  }

  function abortFuzz() {
    if (!run) return;
    api(`/intruder/abort/${run.id}`, { method: 'POST' }).then((r) => {
      if (r?.run) setRun(r.run);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setFuzzBusy(false);
    }).catch(() => {});
  }

  async function exportFinding(index) {
    if (!run) return;
    setFuzzError(null);
    try {
      const r = await api(`/intruder/finding/${run.id}/${index}`, {
        method: 'POST',
        body: JSON.stringify({ note: fuzzNote || undefined }),
      });
      if (r.ok) setFuzzCreated(r.finding); else setFuzzError(r.error || 'no se pudo crear el hallazgo');
    } catch (e) { setFuzzError(String(e.message || e)); }
  }

  async function send() {
    setBusy(true); setError(null); setCreated(null);
    try {
      const r = await api('/repeater/send', {
        method: 'POST',
        body: JSON.stringify({ raw: raw.replace(/§/g, ''), maxRedirects: Number(maxRedirects) || 0 }),
      });
      if (!r.ok) { setError(r.error || 'fallo el envío'); }
      else {
        const prev = history.length ? history[0].send.diffable : null;
        const diff = prev
          ? (prev.status !== r.send.status || prev.length !== r.send.length
            ? `status ${prev.status} → ${r.send.status} · longitud ${prev.length} → ${r.send.length}`
            : 'respuesta idéntica a la anterior')
          : 'primer envío — sin referencia';
        idRef.current += 1;
        const entry = { id: idRef.current, send: r.send, diff };
        setHistory([entry, ...history].slice(0, 50));
        setSelected(entry);
      }
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  async function createFinding() {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      const r = await api('/repeater/finding', {
        method: 'POST',
        body: JSON.stringify({ send: { ...selected.send, diff: { summary: selected.diff } }, note: note || undefined }),
      });
      if (r.ok) setCreated(r.finding); else setError(r.error || 'no se pudo crear el hallazgo');
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  const running = run && run.status === 'running';

  return (
    <div>
      <h2>🔁 Repeater</h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 900 }}>
        Petición cruda → <b>reenvío manual</b> → compara respuestas. Todo envío pasa por el limiter global
        (≥800 ms), el scope de la sesión y el anti-SSRF. <b>maxRedirects = 0</b> te deja ver los 30x en crudo
        (lo que un navegador nunca muestra). Marca posiciones con <b>§…§</b> para el Intruder de abajo.
      </p>

      <div className="card">
        <h3>✏️ Petición cruda</h3>
        <textarea
          rows={10}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          style={monoArea}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={send} disabled={busy}>▶ Enviar (sin §)</button>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>
            maxRedirects:
            <select value={maxRedirects} onChange={(e) => setMaxRedirects(e.target.value)} style={{ marginLeft: 6, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
              <option value={0}>0 (ver 30x crudo)</option>
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </label>
          <span style={{ fontSize: 11, color: positions ? '#58a6ff' : 'var(--muted)' }}>
            {positions ? `${positions} posición(es) §marcada(s)` : 'sin posiciones § (solo Repeater)'}
          </span>
          <button className="btn btn-sm btn-outline" onClick={() => setRaw(SAMPLE)} disabled={busy}>restaurar ejemplo</button>
          {busy && <span style={{ fontSize: 11, color: 'var(--muted)' }}>enviando…</span>}
        </div>
        {error && <p style={{ color: 'var(--yellow)', fontSize: 12, marginTop: 8 }}>⚠ {error}</p>}
      </div>

      {history.length > 0 && (
        <div className="card">
          <h3>🧾 Historial ({history.length}) — clic para inspeccionar</h3>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: 4 }}>#</th><th style={{ padding: 4 }}>Método</th>
                <th style={{ padding: 4 }}>URL</th><th style={{ padding: 4 }}>Status</th>
                <th style={{ padding: 4 }}>Long.</th><th style={{ padding: 4 }}>Diff vs anterior</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}
                  onClick={() => setSelected(h)}
                  style={{ cursor: 'pointer', background: selected?.id === h.id ? '#08b9ff14' : 'transparent', borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 4 }}>{h.id}</td>
                  <td style={{ padding: 4 }}>{h.send.method}</td>
                  <td style={{ padding: 4, fontFamily: 'monospace', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.send.url}</td>
                  <td style={{ padding: 4, color: statusColor(h.send.status), fontWeight: 700 }}>{h.send.status}{h.send.statusText ? ` (${h.send.statusText})` : ''}</td>
                  <td style={{ padding: 4 }}>{h.send.length}</td>
                  <td style={{ padding: 4, color: 'var(--muted)' }}>{h.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="card">
          <h3>🔍 Respuesta #{selected.id} — {selected.send.method} {selected.send.url}</h3>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>
            status <b style={{ color: statusColor(selected.send.status) }}>{selected.send.status}</b> · longitud {selected.send.length} · redirecciones seguidas: {selected.send.maxRedirects}
          </p>
          <details open>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Body de respuesta ({selected.send.responseBody?.length || 0} bytes)</summary>
            <pre style={{ maxHeight: 260, overflow: 'auto', background: '#0a0f16', padding: 10, borderRadius: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid var(--border)' }}>
              {selected.send.responseBody || '(vacío)'}
            </pre>
          </details>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Cabeceras de respuesta</summary>
            <pre style={{ maxHeight: 180, overflow: 'auto', background: '#0a0f16', padding: 10, borderRadius: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid var(--border)' }}>
              {JSON.stringify(selected.send.headers, null, 2)}
            </pre>
          </details>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12 }}>Cabeceras enviadas (Host/Content-Length recalculados)</summary>
            <pre style={{ maxHeight: 180, overflow: 'auto', background: '#0a0f16', padding: 10, borderRadius: 6, fontSize: 11, fontFamily: 'monospace', border: '1px solid var(--border)' }}>
              {JSON.stringify(selected.send.requestHeaders, null, 2)}
            </pre>
          </details>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="nota para el hallazgo (opcional): qué probaste y qué viste"
              style={{ flex: 1, fontSize: 11, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}
            />
            <button className="btn btn-green btn-sm" onClick={createFinding} disabled={busy}>➕ Crear hallazgo</button>
          </div>
          {created && <p style={{ color: 'var(--green)', fontSize: 12, marginTop: 6 }}>✔ hallazgo #{created.id || 'nuevo'} creado — visible en Reportes</p>}
        </div>
      )}

      {/* ═══════════════════ INTRUDER ═══════════════════ */}
      <h2 style={{ marginTop: 28 }}>🎯 Intruder <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>(fuzzing pequeño, tus payloads, caps duros)</span></h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 900 }}>
        El FUZZ masivo no va aquí: esto es el ataque <b>quirúrgico</b>. Marca posiciones en la petición de arriba
        con <b>§…§</b>, escribe TUS payloads (uno por línea) y lanza. Cada petición pasa por el mismo limiter
        (≥800 ms) y el scope; con 3 en vuelo y el limiter, 20 payloads tardan ~6 s — <b>ves el progreso y puedes
        abortar</b>. {caps && <>Caps del servidor: ≤{caps.maxTotalRequests} peticiones/run · ≤{caps.maxPayloads} payloads · ≤{caps.maxConcurrent} en vuelo · ≤{caps.maxRunsConcurrent} runs.</>}
      </p>

      <div className="card">
        <h3>🧰 Payloads <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>(uno por línea — se deduplican)</span></h3>
        <textarea
          rows={6}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          spellCheck={false}
          placeholder={'1\n2\n3\n" OR 1=1 --\n../../../etc/passwd'}
          style={monoArea}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={startFuzz} disabled={fuzzBusy || !positions || !payloadCount}>
            ▶ Lanzar ({payloadCount} payload{payloadCount === 1 ? '' : 's'} × {positions || 0} pos)
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => { setRaw(SAMPLE_FUZZ); setPayloadText('1\n2\n3\n999999\nabc'); }}>ejemplo de fuzz</button>
          {running && <button className="btn btn-sm" style={{ borderColor: 'var(--red, #f85149)', color: 'var(--red, #f85149)' }} onClick={abortFuzz}>■ Abortar</button>}
          {overCaps && <span style={{ fontSize: 11, color: 'var(--yellow)' }}>⚠ supera los caps del servidor — recorta payloads</span>}
          {!positions && <span style={{ fontSize: 11, color: 'var(--muted)' }}>marca una posición §…§ arriba primero</span>}
        </div>
        {fuzzError && <p style={{ color: 'var(--yellow)', fontSize: 12, marginTop: 8 }}>⚠ {fuzzError}</p>}
        {fuzzCreated && <p style={{ color: 'var(--green)', fontSize: 12, marginTop: 6 }}>✔ hallazgo del resultado creado — visible en Reportes</p>}
      </div>

      {run && (
        <div className="card">
          <h3>
            Run {run.id} —{' '}
            <span style={{ color: run.status === 'completed' ? 'var(--green, #3fb950)' : run.status === 'running' ? '#58a6ff' : 'var(--yellow)' }}>
              {run.status}
            </span>
            {run.status === 'running' && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}> (polling cada 1,2 s)</span>}
          </h3>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>
            {run.completedRequests}/{run.totalRequests} peticiones · {run.payloadCount} payloads × {run.positionCount} pos · ≤{run.maxConcurrent} en vuelo
            {run.abortedByUser ? ' · abortada por el usuario' : ''}
          </p>
          <div style={{ height: 6, background: '#0a0f16', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <div style={{ height: '100%', width: `${run.totalRequests ? Math.round((run.completedRequests / run.totalRequests) * 100) : 0}%`, background: 'linear-gradient(90deg,#08b9ff,#3fb950)', transition: 'width .4s' }} />
          </div>

          {run.anomalies && (run.anomalies.minorityStatus?.length > 0 || run.anomalies.lengthOutliers?.length > 0) && (
            <p style={{ fontSize: 11, marginTop: 8, color: 'var(--yellow)' }}>
              ⚠ anomalías: status inusual {run.anomalies.minorityStatus.join(', ')}
              {run.anomalies.lengthOutliers?.length > 0 && <> · {run.anomalies.lengthOutliers.length} longitud(es) atípica(s) vs mediana</>}
            </p>
          )}

          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 10 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: 4 }}>#</th><th style={{ padding: 4 }}>Payload</th>
                <th style={{ padding: 4 }}>Pos</th><th style={{ padding: 4 }}>Status</th>
                <th style={{ padding: 4 }}>Long.</th><th style={{ padding: 4 }}>ms</th>
                <th style={{ padding: 4 }}>Diff vs baseline</th><th style={{ padding: 4 }}></th>
              </tr>
            </thead>
            <tbody>
              {run.results.map((r) => {
                const outlier = run.anomalies?.lengthOutliers?.some((o) => o.index === r.index);
                const minority = run.anomalies?.minorityStatus?.includes(r.status);
                return (
                  <tr key={r.index} style={{ borderTop: '1px solid var(--border)', background: (outlier || minority) ? '#d2992214' : 'transparent' }}>
                    <td style={{ padding: 4 }}>{r.index}</td>
                    <td style={{ padding: 4, fontFamily: 'monospace', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.error ? <span style={{ color: 'var(--red, #f85149)' }}>✗ {r.error}</span> : r.payload}</td>
                    <td style={{ padding: 4 }}>{r.positionIndex}</td>
                    <td style={{ padding: 4, color: statusColor(r.status), fontWeight: minority ? 800 : 500 }}>{r.status ?? '—'}</td>
                    <td style={{ padding: 4, fontWeight: outlier ? 800 : 500 }}>{r.length ?? '—'}</td>
                    <td style={{ padding: 4, color: 'var(--muted)' }}>{r.ms ?? '—'}</td>
                    <td style={{ padding: 4, color: 'var(--muted)' }}>{r.diff?.summary || ''}</td>
                    <td style={{ padding: 4 }}>
                      {run.status !== 'running' && r.status != null && (
                        <button className="btn btn-sm btn-green" onClick={() => exportFinding(r.index)}>➕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {run.status !== 'running' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <input
                value={fuzzNote}
                onChange={(e) => setFuzzNote(e.target.value)}
                placeholder="nota para el próximo hallazgo exportado (opcional)"
                style={{ flex: 1, fontSize: 11, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 8px' }}
              />
            </div>
          )}
          {run.error && <p style={{ color: 'var(--red, #f85149)', fontSize: 12, marginTop: 8 }}>✗ error de la run: {run.error}</p>}
        </div>
      )}
    </div>
  );
}
