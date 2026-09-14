import React, { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// TorPanel.jsx — módulo «Red Tor»
//
// QUÉ ESTABA MAL
//   * llamaba a la API al revés: `api('GET', '/api/tor/status')` cuando el resto
//     de la suite usa `api(url, opts)`. El wrapper hace `fetch('/api' + url)`, así
//     que esas llamadas pedían `/apiGET` y recibían el index.html con un 200: el
//     panel se pintaba «desconectado» para siempre, sin un solo error.
//   * no había botón ni ruta de instalación, así que en una máquina sin Tor no
//     había forma de arrancarlo.
//   * el log que se veía no era de Tor: lo fabricaba el cliente a partir del
//     estado. Ahora se lee `/api/tor/log` (salida real del proceso).
//   * los `catch {}` se comían cualquier fallo; ahora se muestra el motivo.
// ============================================================================

const FLAGS = {
  es: '🇪🇸', de: '🇩🇪', fr: '🇫🇷', nl: '🇳🇱', se: '🇸🇪', ch: '🇨🇭', no: '🇳🇴', fi: '🇫🇮',
  pt: '🇵🇹', it: '🇮🇹', at: '🇦🇹', be: '🇧🇪', dk: '🇩🇰', ie: '🇮🇪', jp: '🇯🇵', au: '🇦🇺',
  br: '🇧🇷', ca: '🇨🇦', mx: '🇲🇽', ar: '🇦🇷', us: '🇺🇸', gb: '🇬🇧',
};

const CHIP = (active, color = 'var(--primary)') => ({
  padding: '3px 8px', fontSize: 10, fontFamily: 'monospace', borderRadius: 5,
  background: active ? 'rgba(8,216,255,0.14)' : 'var(--panel)',
  border: `1px solid ${active ? color : 'var(--border)'}`,
  color: active ? color : 'var(--muted)',
});

const BTN = { fontSize: 11, padding: '6px 12px', fontFamily: 'monospace' };

const CARD = { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: 10 };

function line(entry) {
  const text = typeof entry === 'string' ? entry : entry.text;
  if (/\[err\]/.test(text)) return 'var(--red)';
  if (/\[warn\]/.test(text)) return 'var(--yellow)';
  if (/Bootstrapped 100%/.test(text)) return 'var(--green)';
  if (/\[notice\]/.test(text)) return 'var(--primary)';
  return 'var(--muted)';
}

export default function TorPanel({ api }) {
  const [status, setStatus] = useState({ running: false, installed: false });
  const [test, setTest] = useState(null);
  const [circuits, setCircuits] = useState([]);
  const [logs, setLogs] = useState([]);
  const [logNote, setLogNote] = useState("");
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const logRef = useRef(null);
  const firstIpRef = useRef(null);

  const fail = (e, fallback = 'la llamada falló') => setError(e?.message || fallback);

  const mark = (key, value) => setBusy((prev) => ({ ...prev, [key]: value }));

  const refreshStatus = useCallback(async () => {
    try {
      const res = await api('/tor/status');
      if (!res?.ok) { setError(res?.error || 'no se pudo leer el estado de Tor'); return; }
      setStatus(res);
      setError(res.lastError || '');
      if (res.ip && firstIpRef.current !== res.ip) {
        firstIpRef.current = res.ip;
        setCircuits((prev) => (prev.some((c) => c.ip === res.ip)
          ? prev
          : [...prev, { ip: res.ip, country: res.country, timestamp: res.ipCheckedAt || Date.now() }].slice(-50)));
      }
    } catch (e) { fail(e, 'no se pudo leer el estado de Tor'); }
  }, [api]);

  const refreshLog = useCallback(async () => {
    try {
      const res = await api('/tor/log?tail=250');
      if (res?.ok) { setLogs(res.lines || []); setLogNote(res.note || ""); }
    } catch { /* el log no es crítico */ }
  }, [api]);

  const refreshCircuits = useCallback(async () => {
    try {
      const res = await api('/tor/circuits');
      if (Array.isArray(res) && res.length) setCircuits(res);
    } catch { /* histórico opcional */ }
  }, [api]);

  useEffect(() => {
    refreshStatus().then(refreshLog).then(refreshCircuits);
    const timer = setInterval(() => { refreshStatus(); refreshLog(); }, 5000);
    return () => clearInterval(timer);
  }, [refreshStatus, refreshLog, refreshCircuits]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  /** Acción genérica: marca ocupado, limpia mensajes y traduce el resultado. */
  const run = async (key, path, opts, onOk) => {
    mark(key, true);
    setError('');
    setInfo('');
    try {
      const res = await api(path, opts);
      if (!res || res.ok === false) {
        setError(res?.error || `${path} no está disponible`);
      } else {
        if (res.note) setInfo(res.note);
        else if (res.warning) setInfo(res.warning);
        if (onOk) onOk(res);
      }
      await refreshStatus();
      await refreshLog();
      return res;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      mark(key, false);
    }
  };

  const install = () => run('install', '/tor/install', { method: 'POST', body: JSON.stringify({}) },
    (res) => {
      setError('');
      setInfo(`Tor ${res.version || ''} instalado en ${res.path || res.bundleDir || '~/.knk-suite/tor'}`.trim());
    });

  const start = () => run('start', '/tor/start', { method: 'POST', body: JSON.stringify({}) },
    (res) => setInfo(res.note || (res.external ? 'Usando el Tor que ya estaba abierto.' : 'Tor arrancado y bootstrapeado.')));

  const stop = () => run('stop', '/tor/stop', { method: 'POST', body: JSON.stringify({}) },
    () => setInfo('Tor detenido.'));

  const newIdentity = () => run('identity', '/tor/new-identity', { method: 'POST', body: JSON.stringify({}) },
    (res) => setInfo(`Identidad nueva: ${res.newIP || 'sin IP confirmada'}${res.country ? ` (${res.country.toUpperCase()})` : ''}`));

  const testConnection = async () => {
    mark('test', true);
    setError('');
    setTest(null);
    try {
      const res = await api('/tor/test');
      setTest(res);
      if (res?.error) setError(res.error);
    } catch (e) { fail(e); } finally { mark('test', false); }
  };

  const routeAll = () => run('route', '/tor/route-all', { method: 'POST', body: JSON.stringify({}) },
    (res) => setInfo(`${res.note || 'Proxy del sistema apuntando a Tor.'}${res.proxy ? ` (${res.proxy})` : ''}`));

  const clearProxy = () => run('clear', '/tor/clear-proxy', { method: 'POST', body: JSON.stringify({}) },
    (res) => setInfo(res.note || 'Proxy del sistema limpiado.'));

  const flag = (country) => FLAGS[String(country || '').toLowerCase()] || '🌐';

  const uptime = (ms) => {
    if (!ms) return '—';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h) return `${h}h ${m % 60}m`;
    if (m) return `${m}m ${s % 60}s`;
    return `${s}s`;
  };

  const running = !!status.running;
  const badge = !running ? ['Disconnected', 'var(--muted)'] : status.bootstrapped ? ['Connected', 'var(--green)'] : ['Connecting…', 'var(--yellow)'];

  return (
    <div style={{ color: 'var(--text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 22 }}>🧅</span>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: '#fff', fontFamily: "'Courier New', monospace" }}>RED TOR</h3>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            SOCKS5 en 127.0.0.1 · control por cookie · reutiliza un Tor ya abierto (Tor Browser usa 9150)
          </div>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={CHIP(status.managed, 'var(--green)')}>{status.managed ? 'gestionado por KNK' : status.external ? 'Tor externo' : 'sin Tor'}</span>
          {status.version && <span style={CHIP(false)}>v{status.version}</span>}
          <span style={badge[1] === 'var(--green)' ? CHIP(true, 'var(--green)') : badge[1] === 'var(--yellow)' ? CHIP(true, 'var(--yellow)') : CHIP(false)}>
            {badge[0]}
          </span>
        </span>
      </div>

      {!status.installed && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'rgba(255,199,0,0.4)' }}>
          <div style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 700, marginBottom: 4 }}>⚠️ Tor no está instalado</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', marginBottom: 8 }}>
            Se descarga el <b>tor expert bundle oficial</b> (dist.torproject.org, ~25 MB) en
            ~/.knk-suite/tor/bundle y se usa su tor.exe. No toca el Tor del sistema.
          </div>
          <button className="btn btn-sm" style={BTN} onClick={install} disabled={busy.install}>
            {busy.install ? '⏳ Descargando e instalando…' : '⬇ Instalar Tor'}
          </button>
        </div>
      )}

      {(error || info) && (
        <div className="card" style={{
          marginBottom: 12,
          borderColor: error ? 'rgba(255,80,80,0.4)' : 'rgba(0,255,136,0.3)',
          background: error ? 'rgba(255,80,80,0.08)' : 'rgba(0,255,136,0.06)',
        }}>
          <div style={{ fontSize: 11, color: error ? 'var(--red)' : 'var(--green)', fontFamily: 'monospace' }}>
            {error ? `⚠️ ${error}` : `ℹ️ ${info}`}
          </div>
          {status.note && !error && (
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 4 }}>{status.note}</div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {[
          ['IP de salida', status.ip ? `${flag(status.country)} ${status.ip}` : '—', status.ip ? 'var(--green)' : 'var(--muted)'],
          ['país', status.country ? String(status.country).toUpperCase() : '—', 'var(--text)'],
          ['SOCKS', status.socksPort ? `127.0.0.1:${status.socksPort}` : '—', 'var(--primary)'],
          ['control', status.controlPort ? `127.0.0.1:${status.controlPort}` : '—', 'var(--primary)'],
          ['uptime', uptime(status.uptime), 'var(--text)'],
          ['PID', status.pid || '—', 'var(--muted)'],
          ['bootstrap', status.bootstrapped ? '100%' : running ? 'en curso' : '—', status.bootstrapped ? 'var(--green)' : 'var(--muted)'],
        ].map(([label, value, color]) => (
          <div key={label}>
            <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</div>
            <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace' }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {running ? (
          <button className="btn btn-sm btn-outline" style={BTN} onClick={stop} disabled={busy.stop || status.external}
            title={status.external ? 'Lo lanzó otra aplicación: no se toca' : 'Detener el Tor de KNK'}>
            {busy.stop ? '⏳' : '■ Detener'}
          </button>
        ) : (
          <button className="btn btn-sm" style={BTN} onClick={start} disabled={busy.start || !status.installed}>
            {busy.start ? '⏳ Arrancando…' : '▶ Arrancar Tor'}
          </button>
        )}
        <button className="btn btn-sm btn-outline" style={BTN} onClick={newIdentity} disabled={busy.identity || !running}>
          {busy.identity ? '⏳' : '↻ Nueva identidad'}
        </button>
        <button className="btn btn-sm btn-outline" style={BTN} onClick={testConnection} disabled={busy.test}>
          {busy.test ? '⏳ Probando…' : '⚡ Probar conexión'}
        </button>
        <button className="btn btn-sm btn-outline" style={BTN} onClick={() => refreshStatus()} disabled={busy.refresh}>
          ↺ Refrescar
        </button>
        <span style={{ width: 1, height: 20, background: 'var(--border)' }} />
        <button className="btn btn-sm btn-outline" style={BTN} onClick={routeAll} disabled={busy.route || !running}
          title="Cambia el proxy del sistema (HKCU) a socks=127.0.0.1:<puerto>">
          {busy.route ? '⏳' : '🌐 Todo por Tor'}
        </button>
        <button className="btn btn-sm btn-outline" style={BTN} onClick={clearProxy} disabled={busy.clear}
          title="Quita el proxy del sistema y borra la copia de seguridad">
          {busy.clear ? '⏳' : '✕ Quitar proxy del sistema'}
        </button>
      </div>

      {test && (
        <div className="card" style={{ marginBottom: 12, borderColor: test.different ? 'rgba(0,255,136,0.3)' : 'rgba(255,199,0,0.4)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: test.different ? 'var(--green)' : 'var(--yellow)', marginBottom: 4, fontFamily: 'monospace' }}>
            {test.different ? '✅ Sale por Tor: la IP directa y la de Tor son distintas' : test.ok ? '⚠️ Tor responde, pero las IP coinciden o son desconocidas' : '❌ La conexión por Tor no funciona'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            directa: {test.directIP || '—'} → por Tor: {test.torIP || '—'} {test.country ? `(${String(test.country).toUpperCase()})` : ''} · SOCKS 127.0.0.1:{test.socksPort}
          </div>
          {test.error && <div style={{ fontSize: 10, color: 'var(--red)', fontFamily: 'monospace', marginTop: 4 }}>{test.error}</div>}
          {test.warning && <div style={{ fontSize: 10, color: 'var(--yellow)', fontFamily: 'monospace', marginTop: 4 }}>{test.warning}</div>}
          {test.source && <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginTop: 2 }}>comprobado en {test.source}</div>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, marginBottom: 6, fontFamily: 'monospace' }}>
          HISTORIAL DE IDENTIDADES ({circuits.length})
        </div>
        {circuits.length === 0 ? (
          <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
            Sin historial todavía. Arranca Tor o pide una identidad nueva.
          </div>
        ) : (
          <div style={{ maxHeight: 140, overflow: 'auto' }}>
            {circuits.slice().reverse().map((c) => (
              <div key={`${c.ip}-${c.timestamp}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{flag(c.country)} {c.ip}</span>
                <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>
                  {new Date(c.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, fontFamily: 'monospace' }}>
            LOG DE TOR ({logs.length})
          </span>
          <button className="btn btn-sm btn-outline" style={{ fontSize: 9, padding: '2px 6px' }} onClick={refreshLog}>↺</button>
          <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'monospace', marginLeft: 'auto' }}>{status.logPath || ''}</span>
        </div>
        <div ref={logRef} style={{
          background: '#010409', border: '1px solid var(--border)', borderRadius: 6, padding: 8,
          maxHeight: 220, overflowY: 'auto', fontFamily: 'monospace', fontSize: 10, lineHeight: 1.5,
        }}>
          {logs.length === 0 ? (
            <div style={{ color: 'var(--muted)' }}>{logNote || 'Sin líneas todavía: arranca Tor para ver el bootstrap.'}</div>
          ) : (
            logs.map((entry, i) => (
              <div key={i} style={{ color: line(entry), whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {typeof entry === 'string' ? entry : entry.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
