import React, { useState, useEffect } from 'react';

export default function LiligoPanel({ api }) {
  const [connected, setConnected] = useState(false);
  const [detecting, setDetecting] = useState(true);
  const [boardInfo, setBoardInfo] = useState(null);
  const [port, setPort] = useState('');
  const [baudRate, setBaudRate] = useState('115200');
  const [connecting, setConnecting] = useState(false);
  const [command, setCommand] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState([]);
  const [toast, setToast] = useState('');

  useEffect(() => {
    api('/liligo/detect')
      .then(r => {
        if (r?.board) {
          setBoardInfo(r);
          setToast('Board detectada: ' + (r.board || r.model || 'ESP32'));
        }
      })
      .catch(() => {})
      .finally(() => setDetecting(false));
  }, [api]);

  const handleConnect = async () => {
    if (!port.trim()) return;
    setConnecting(true);
    try {
      const r = await api('/liligo/connect', {
        method: 'POST',
        body: JSON.stringify({ port: port.trim(), baudRate: parseInt(baudRate, 10) }),
      });
      if (r?.ok) {
        setConnected(true);
        setResults(prev => [...prev, { type: 'system', text: `Conectado a ${port} @ ${baudRate} baudios` }]);
        setToast('Conexión establecida');
      } else {
        setResults(prev => [...prev, { type: 'error', text: r?.error || 'Error al conectar' }]);
      }
    } catch (e) {
      setResults(prev => [...prev, { type: 'error', text: 'Error de conexión: ' + e.message }]);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api('/liligo/disconnect', { method: 'POST' });
      setConnected(false);
      setResults(prev => [...prev, { type: 'system', text: 'Desconectado' }]);
      setToast('Desconectado');
    } catch (e) {
      setResults(prev => [...prev, { type: 'error', text: 'Error al desconectar: ' + e.message }]);
    }
  };

  const sendCommand = async (cmd) => {
    const c = cmd || command;
    if (!c.trim()) return;
    setSending(true);
    setResults(prev => [...prev, { type: 'cmd', text: '> ' + c }]);
    try {
      const r = await api('/liligo/command', {
        method: 'POST',
        body: JSON.stringify({ command: c }),
      });
      const output = r?.output || r?.result || JSON.stringify(r);
      setResults(prev => [...prev, { type: 'response', text: output }]);
    } catch (e) {
      setResults(prev => [...prev, { type: 'error', text: 'Error: ' + e.message }]);
    } finally {
      setSending(false);
      setCommand('');
    }
  };

  const quickActions = [
    { label: 'WiFi Scan', cmd: 'WIFI_SCAN' },
    { label: 'BLE Scan', cmd: 'BLE_SCAN' },
    { label: 'Get Info', cmd: 'GET_INFO' },
  ];

  return (
    <div>
      <div className="module-heading">
        <div>
          <span className="eyebrow">HARDWARE</span>
          <h2>LILIGO ESP32</h2>
        </div>
        <span className={`badge ${connected ? 'badge-ok' : 'badge-warn'}`}>
          {connected ? 'CONECTADO' : 'DESCONECTADO'}
        </span>
      </div>

      {detecting && (
        <div className="card" style={{ textAlign: 'center', padding: 20 }}>
          <span className="muted">Detectando board...</span>
        </div>
      )}

      {boardInfo && (
        <div className="card">
          <h3>Board Detectada</h3>
          {Object.entries(boardInfo).map(([k, v]) => (
            <div className="kv" key={k}>
              <span className="k">{k}</span>
              <span className="v">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {!connected ? (
        <div className="card">
          <h3>Conectar</h3>
          <div className="form-grid">
            <label>
              Puerto COM
              <input
                placeholder="COM3"
                value={port}
                onChange={e => setPort(e.target.value)}
              />
            </label>
            <label>
              Baud Rate
              <select value={baudRate} onChange={e => setBaudRate(e.target.value)}>
                <option value="9600">9600</option>
                <option value="19200">19200</option>
                <option value="38400">38400</option>
                <option value="57600">57600</option>
                <option value="115200">115200</option>
                <option value="230400">230400</option>
                <option value="460800">460800</option>
                <option value="921600">921600</option>
              </select>
            </label>
          </div>
          <button className="btn" onClick={handleConnect} disabled={connecting || !port.trim()}>
            {connecting ? 'Conectando...' : 'Conectar'}
          </button>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>Comando</h3>
            <div className="inline-form">
              <input
                placeholder="Escribe un comando..."
                value={command}
                onChange={e => setCommand(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendCommand()}
              />
              <button className="btn btn-sm" onClick={() => sendCommand()} disabled={sending || !command.trim()}>
                {sending ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>

          <div className="card">
            <h3>Acciones rápidas</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {quickActions.map(a => (
                <button
                  key={a.cmd}
                  className="btn btn-sm"
                  onClick={() => sendCommand(a.cmd)}
                  disabled={sending}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <button className="btn btn-sm btn-outline" onClick={handleDisconnect} style={{ marginBottom: 12 }}>
            Desconectar
          </button>
        </>
      )}

      {results.length > 0 && (
        <div className="card">
          <h3>Resultados</h3>
          <div className="result-box">
            {results.map((r, i) => (
              <div key={i} style={{
                color: r.type === 'cmd' ? 'var(--primary)' : r.type === 'error' ? 'var(--red)' : r.type === 'system' ? 'var(--yellow)' : '#a8dfff',
                marginBottom: 4,
              }}>
                {r.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
