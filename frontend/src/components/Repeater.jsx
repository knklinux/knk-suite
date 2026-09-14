import React, { useRef, useState } from 'react';

// Repeater — cliente HTTP manual estilo Burp: editas la petición cruda, la
// reenvías cuando quieres, y comparas respuestas. Cada envío pasa por el
// limiter global de la suite (>=800 ms), el scope de la sesión y el anti-SSRF.

const SAMPLE = `GET / HTTP/1.1
Host: TU-TARGET.com
Accept: */*
Accept-Language: es-ES,es;q=0.9
Connection: close`;

function statusColor(code) {
  if (!code) return 'var(--muted)';
  if (code >= 500) return 'var(--red, #f85149)';
  if (code >= 400) return 'var(--yellow, #d29922)';
  if (code >= 300) return '#58a6ff';
  if (code >= 200) return 'var(--green, #3fb950)';
  return 'var(--muted)';
}

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

  async function send() {
    setBusy(true); setError(null); setCreated(null);
    try {
      const r = await api('/repeater/send', {
        method: 'POST',
        body: JSON.stringify({ raw, maxRedirects: Number(maxRedirects) || 0 }),
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

  return (
    <div>
      <h2>🔁 Repeater</h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, maxWidth: 900 }}>
        Petición cruda → <b>reenvío manual</b> → compara respuestas. Todo envío pasa por el limiter global
        (≥800 ms), el scope de la sesión y el anti-SSRF. <b>maxRedirects = 0</b> te deja ver los 30x en crudo
        (lo que un navegador nunca muestra).
      </p>

      <div className="card">
        <h3>✏️ Petición cruda</h3>
        <textarea
          rows={10}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
          <button className="btn" onClick={send} disabled={busy}>▶ Enviar</button>
          <label style={{ fontSize: 11, color: 'var(--muted)' }}>
            maxRedirects:
            <select value={maxRedirects} onChange={(e) => setMaxRedirects(e.target.value)} style={{ marginLeft: 6, background: '#0a0f16', color: '#c9d1d9', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
              <option value={0}>0 (ver 30x crudo)</option>
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </label>
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
    </div>
  );
}
