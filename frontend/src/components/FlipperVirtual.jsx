import React, { useState, useEffect } from 'react';

// ============================================================================
// FlipperVirtual.jsx — Flipper Zero real + virtual multi-tool hub
// ============================================================================

const TOOLS = [
  { id: 'rfid', icon: '📡', name: 'RFID', desc: 'Lectura/emulación 125kHz', protocols: ['EM4100', 'HID Prox', 'Indala', 'AWID', 'Paradox'] },
  { id: 'nfc', icon: '💳', name: 'NFC', desc: 'Tags 13.56MHz, MIFARE', protocols: ['MIFARE Classic', 'MIFARE Ultralight', 'NTAG216', 'DESFire'] },
  { id: 'ir', icon: '📺', name: 'Infrared', desc: 'Control remoto universal', protocols: ['NEC', 'RC5', 'RC6', 'Samsung', 'LG', 'Sony'] },
  { id: 'subghz', icon: '📻', name: 'Sub-GHz', desc: 'Radio 300-928MHz', protocols: ['PT2260', 'HT12E', 'SC5262', 'Nice FLO'] },
  { id: 'wifi', icon: '📶', name: 'WiFi', desc: 'Scan, deauth, Evil Portal', protocols: ['WPA2', 'WPA3', 'Open', 'WEP'] },
  { id: 'ble', icon: '🔵', name: 'Bluetooth', desc: 'BLE scan, spoof, GATT', protocols: ['BLE 4.0+', 'GATT', 'iBeacon', 'Eddystone'] },
  { id: 'badusb', icon: '🔌', name: 'BadUSB', desc: 'HID injection', protocols: ['USB HID', 'Keyboard', 'Mouse'] },
  { id: 'u2f', icon: '🔑', name: 'U2F/FIDO', desc: '2FA hardware', protocols: ['FIDO2', 'U2F', 'WebAuthn'] },
];

const SCRIPTS = {
  rfid: [
    { name: 'Leer EM4100', cmd: 'rfidscan --type em4100 --duration 10' },
    { name: 'Emular HID Prox', cmd: 'lf-emulate --type hid-prox --uid 1234567890' },
    { name: 'Escribir T5577', cmd: 'lf-write --type t5577 --data 1234567890' },
  ],
  nfc: [
    { name: 'Scan NFC', cmd: 'nfc-scan --duration 10' },
    { name: 'Clonar MIFARE', cmd: 'nfc-cloning --type mifare-classic' },
    { name: 'Leer NTAG', cmd: 'nfc-scan --type ntag' },
  ],
  ir: [
    { name: 'Aprender IR', cmd: 'ir-learn --duration 30' },
    { name: 'Replay IR', cmd: 'ir-replay --file remote.nec' },
    { name: 'BD de remotes', cmd: 'ir-database --list' },
  ],
  wifi: [
    { name: 'Scan WiFi', cmd: 'wifi-scan --interface wlan0' },
    { name: 'Deauth', cmd: 'wifi-deauth --bssid AA:BB:CC:DD:EE:FF' },
    { name: 'Evil Portal', cmd: 'wifi-evilportal --ssid Free_WiFi' },
  ],
  ble: [
    { name: 'Scan BLE', cmd: 'ble-scan --duration 20' },
    { name: 'BLE Spam', cmd: 'ble-spam --type samsung --count 50' },
    { name: 'GATT Cloner', cmd: 'ble-gatt --clone' },
  ],
  badusb: [
    { name: 'Run DuckyScript', cmd: 'badusb-run --file payload.txt' },
    { name: 'Record keystrokes', cmd: 'badusb-record --duration 60' },
    { name: 'Listar scripts', cmd: 'badusb-scripts --list' },
  ],
};

export default function FlipperVirtual({ api, sendToTerminal }) {
  const [selectedTool, setSelectedTool] = useState(null);
  const [history, setHistory] = useState([]);
  const [flipperState, setFlipperState] = useState({ connected: false, device: null, info: null });
  const [detecting, setDetecting] = useState(false);
  const [toast, setToast] = useState('');

  const detectFlipper = async () => {
    setDetecting(true);
    try {
      const r = await api('/flipper/detect');
      if (r.ok && r.device) {
        setFlipperState(prev => ({ ...prev, device: r.device }));
        setToast(`✅ Flipper detectado: ${r.device.path}`);
      } else {
        setToast('❌ No se detectó Flipper Zero');
      }
    } catch (e) {
      setToast('❌ Error detectando: ' + e.message);
    }
    setDetecting(false);
  };

  const connectFlipper = async () => {
    if (!flipperState.device) return;
    try {
      const r = await api('/flipper/connect', { method: 'POST', body: JSON.stringify({ path: flipperState.device.path }) });
      if (r.ok) {
        setFlipperState(prev => ({ ...prev, connected: true, info: r.info }));
        setToast('✅ Flipper conectado');
      } else {
        setToast('❌ ' + r.error);
      }
    } catch (e) {
      setToast('❌ Error: ' + e.message);
    }
  };

  const disconnectFlipper = async () => {
    await api('/flipper/disconnect', { method: 'POST' });
    setFlipperState({ connected: false, device: null, info: null });
    setToast('🔌 Flipper desconectado');
  };

  const runFlipperCommand = async (cmd) => {
    if (!flipperState.connected) {
      setToast('⚠️ Conecta el Flipper primero');
      return;
    }
    try {
      const r = await api('/flipper/command', { method: 'POST', body: JSON.stringify({ command: cmd }) });
      if (r.ok) {
        setHistory(h => [{ cmd, result: r.result, ts: Date.now(), real: true }, ...h].slice(0, 30));
        setToast('✅ ' + r.result);
      } else {
        setToast('❌ ' + r.error);
      }
    } catch (e) {
      setToast('❌ Error: ' + e.message);
    }
  };

  const runCommand = (cmd) => {
    setHistory(h => [{ cmd, ts: Date.now(), real: false }, ...h].slice(0, 30));
    if (sendToTerminal) sendToTerminal({ cmd, ts: Date.now() });
  };

  const exportHistory = () => {
    const data = JSON.stringify(history, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'flipper-history.json'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ color: 'var(--text)' }}>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>🐬</span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontFamily: "'Courier New', monospace" }}>
            FLIPPER VIRTUAL
          </h2>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {flipperState.connected ? `🟢 ${flipperState.info?.name || 'Conectado'}` : 'root@knklinux:~# flipper --mode=virtual'}
          </div>
        </div>
      </div>

      {/* Flipper Connection Panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>🔌 Flipper Zero</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!flipperState.connected ? (
            <>
              <button className="btn btn-sm" onClick={detectFlipper} disabled={detecting}>
                {detecting ? '⏳ Buscando...' : '🔍 Detectar USB'}
              </button>
              {flipperState.device && (
                <button className="btn btn-sm btn-green" onClick={connectFlipper}>
                  ✅ Conectar ({flipperState.device.path})
                </button>
              )}
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                Requiere: `npm install serialport` en backend/
              </span>
            </>
          ) : (
            <>
              <span style={{ color: 'var(--green)', fontSize: 12 }}>● Conectado</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                {flipperState.info?.firmware || 'Firmware unknown'}
              </span>
              <button className="btn btn-sm btn-outline" onClick={disconnectFlipper}>
                🔌 Desconectar
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tool Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
        {TOOLS.map(tool => (
          <div key={tool.id}
            onClick={() => setSelectedTool(selectedTool?.id === tool.id ? null : tool)}
            style={{
              background: selectedTool?.id === tool.id ? 'rgba(0,255,136,0.08)' : 'var(--panel)',
              border: `1px solid ${selectedTool?.id === tool.id ? 'var(--teal)' : 'var(--border)'}`,
              borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{tool.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace' }}>{tool.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{tool.desc}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
              {tool.protocols.slice(0, 2).map(p => (
                <span key={p} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4,
                  background: 'rgba(88,166,255,0.15)', color: 'var(--blue)', fontFamily: 'monospace' }}>{p}</span>
              ))}
              {tool.protocols.length > 2 && <span style={{ fontSize: 9, color: 'var(--muted)' }}>+{tool.protocols.length - 2}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Tool Detail */}
      {selectedTool && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, fontFamily: 'monospace', marginBottom: 12 }}>
            {selectedTool.icon} {selectedTool.name}
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'monospace' }}>PROTOCOLOS:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {selectedTool.protocols.map(p => (
                <span key={p} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6,
                  background: 'rgba(88,166,255,0.15)', color: 'var(--blue)', fontFamily: 'monospace' }}>{p}</span>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'monospace' }}>ACCIONES:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(SCRIPTS[selectedTool.id] || []).map((script, i) => (
              <button key={i} onClick={() => flipperState.connected ? runFlipperCommand(script.cmd) : runCommand(script.cmd)} style={{
                padding: '6px 12px', background: flipperState.connected ? 'var(--teal)' : 'var(--bg)',
                color: flipperState.connected ? '#000' : 'var(--teal)',
                border: '1px solid var(--border)', borderRadius: 6, fontSize: 11,
                cursor: 'pointer', fontFamily: 'monospace',
              }}>
                {flipperState.connected ? '⚡' : '▶'} {script.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>HISTORIAL:</span>
            <button onClick={exportHistory} style={{ fontSize: 9, padding: '2px 8px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}>
              📥 Export
            </button>
          </div>
          {history.map((entry, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'monospace', padding: '4px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--muted)' }}>{new Date(entry.ts).toLocaleTimeString()}</span>
              <span style={{ color: entry.real ? 'var(--green)' : 'var(--muted)' }}>{entry.real ? '⚡' : '📡'}</span>
              <span style={{ flex: 1 }}>$ {entry.cmd}</span>
              {entry.result && <span style={{ color: 'var(--teal)' }}>→ {entry.result}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
