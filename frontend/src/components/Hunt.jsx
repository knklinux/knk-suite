import React, { useState } from 'react';

const SAMPLE_LOG = [
  '[01/Jan/2026:00:00:01] sshd[123]: Failed password for invalid user admin from 203.0.113.9 port 51222 ssh2',
  '[01/Jan/2026:00:00:02] sshd[123]: Failed password for invalid user admin from 203.0.113.9 port 51223 ssh2',
  '[01/Jan/2026:00:00:03] sshd[123]: Failed password for invalid user admin from 203.0.113.9 port 51224 ssh2',
  '[01/Jan/2026:00:00:04] sshd[123]: Failed password for invalid user admin from 203.0.113.9 port 51225 ssh2',
  '[01/Jan/2026:00:00:05] sshd[123]: Failed password for invalid user admin from 203.0.113.9 port 51226 ssh2',
  '[01/Jan/2026:00:00:06] nginx: 198.51.100.7 - - "GET /../../etc/passwd HTTP/1.1" 404',
  '[01/Jan/2026:00:00:07] nginx: 198.51.100.7 - - "GET /phpmyadmin/index.php HTTP/1.1" 403',
  '[01/Jan/2026:00:00:08] nginx: "Mozilla/5.0 (compatible; sqlmap/1.7)" - - "GET /?id=1%20UNION%20SELECT%201,2 HTTP/1.1" 500',
].join('\n');

export default function Hunt({ api }) {
  const [logText, setLogText] = useState('');
  const [iocText, setIocText] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(action) {
    setBusy(true); setError(null);
    try {
      let r;
      if (action === 'iocs') r = await api('/hunt/parse-iocs', { method: 'POST', body: JSON.stringify({ text: iocText }) });
      else if (action === 'scan') {
        const iocs = iocText ? (await api('/hunt/parse-iocs', { method: 'POST', body: JSON.stringify({ text: iocText }) })).iocs : null;
        r = await api('/hunt/scan', { method: 'POST', body: JSON.stringify({ logText, iocs }) });
      } else if (action === 'anomalies') r = await api('/hunt/anomalies', { method: 'POST', body: JSON.stringify({ logText }) });
      setResult(r);
    } catch (e) { setError(String(e.message || e)); }
    setBusy(false);
  }

  const alerts = result?.result?.alerts || [];
  const mitre = result?.mitre || [];

  return (
    <div>
      <h2>🛡️ Threat Hunting</h2>

      <div className="card">
        <h3>📄 Logs a analizar (pega logs propios: auth, web, firewall)</h3>
        <textarea
          rows={8}
          value={logText}
          onChange={e => setLogText(e.target.value)}
          placeholder="Pega aquí el contenido de tus logs (sshd, nginx, apache, firewall...)"
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        />
        <button onClick={() => setLogText(SAMPLE_LOG)} style={{ marginTop: 6 }}>Cargar ejemplo</button>
        <button onClick={() => run('anomalies')} disabled={busy} style={{ marginTop: 6, marginLeft: 8 }}>
          {busy ? 'Analizando...' : '🔍 Detectar anomalías'}
        </button>
      </div>

      <div className="card">
        <h3>🕵️ IoCs (una por línea: IPs, dominios, hashes, emails, URLs)</h3>
        <textarea
          rows={4}
          value={iocText}
          onChange={e => setIocText(e.target.value)}
          placeholder="203.0.113.5&#10;bad.example.com&#10;d41d8cd98f00b204e9800998ecf8427e"
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
        />
        <button onClick={() => run('iocs')} disabled={busy} style={{ marginTop: 6 }}>Parsear IoCs</button>
        <button onClick={() => run('scan')} disabled={busy} style={{ marginTop: 6, marginLeft: 8 }}>🎯 Buscar IoCs en logs</button>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}><span style={{ color: 'var(--red)' }}>{error}</span></div>}

      {alerts.length > 0 && (
        <div className="card">
          <h3>🚨 Alertas ({alerts.length})</h3>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: 6 }}>Severidad</th>
                <th style={{ textAlign: 'left', padding: 6 }}>Alerta</th>
                <th style={{ textAlign: 'left', padding: 6 }}>Técnica</th>
                <th style={{ textAlign: 'left', padding: 6 }}>Línea</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 6, color: a.severity === 'high' ? 'var(--red)' : a.severity === 'medium' ? 'var(--yellow)' : 'var(--muted)' }}>{a.severity.toUpperCase()}</td>
                  <td style={{ padding: 6 }}>{a.title}</td>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{a.technique || '—'}</td>
                  <td style={{ padding: 6 }}>{a.line || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mitre.length > 0 && (
        <div className="card">
          <h3>🗺️ Mapeo MITRE ATT&CK</h3>
          {mitre.map((m, i) => (
            <div key={i} style={{ padding: '4px 0', fontSize: 12 }}>
              <code>{m.id}</code> — {m.name} <span className="muted">({m.tactic})</span> <strong>{m.hits}x</strong>
            </div>
          ))}
        </div>
      )}

      {result?.ok && !alerts.length && (
        <div className="card"><h3>✅ Sin alertas en los datos analizados</h3></div>
      )}
    </div>
  );
}
