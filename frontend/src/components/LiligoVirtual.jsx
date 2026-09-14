import React, { useState } from 'react';

// ============================================================================
// LiligoVirtual.jsx — LILIGO ESP32 multi-tool hub (WiFi, BLE, LoRa, IR, RFID)
// ============================================================================

const TOOLS = [
  { id: 'wifi', icon: '📶', name: 'WiFi', desc: 'Scan, deauth, Evil Portal, packet monitor', protocols: ['WPA2', 'WPA3', 'Open', 'WEP', 'PMKID'], color: '#08b9ff' },
  { id: 'ble', icon: '🔵', name: 'Bluetooth', desc: 'BLE scan, spam, GATT, spoof', protocols: ['BLE 4.0+', 'GATT', 'iBeacon', 'Eddystone'], color: '#4a9eff' },
  { id: 'lora', icon: '📻', name: 'LoRa', desc: 'Long range radio 150-928MHz', protocols: ['LoRa', 'FSK', 'OOK', 'SX1276', 'SX1262'], color: '#b12cff' },
  { id: 'ir', icon: '📺', name: 'Infrared', desc: 'Learn/replay IR remotes', protocols: ['NEC', 'RC5', 'RC6', 'Samsung', 'Sony'], color: '#ff6b6b' },
  { id: 'rfid', icon: '📡', name: 'RFID', desc: '125kHz/13.56MHz tags', protocols: ['EM4100', 'MIFARE', 'NTAG', 'HID'], color: '#42e6a4' },
  { id: 'gps', icon: '🛰️', name: 'GPS', desc: 'NMEA, geolocation, wardriving', protocols: ['NMEA', 'U-blox', 'GPS+LoRa'], color: '#f3c75f' },
  { id: 'deauth', icon: '⚠️', name: 'Deauth', desc: 'WiFi deauthentication attacks', protocols: ['802.11', 'Probe', ' Beacon'], color: '#ff4444' },
  { id: 'gpio', icon: '🔌', name: 'GPIO', desc: 'Digital/analog I/O, PWM', protocols: ['GPIO', 'I2C', 'SPI', 'UART', 'PWM'], color: '#ff8b4a' },
];

const SCRIPTS = {
  wifi: [
    { name: '📡 Scan Networks', cmd: 'wifi_scan' },
    { name: '🔍 Probe Monitor', cmd: 'wifi_monitor --mode probe' },
    { name: '💀 Deauth Target', cmd: 'wifi_deauth --bssid AA:BB:CC:DD:EE:FF --channel 6' },
    { name: '🏴 Evil Portal', cmd: 'wifi_portal --ssid Free_WiFi --channel 6' },
    { name: '📊 Packet Capture', cmd: 'wifi_capture --duration 60 --output capture.pcap' },
    { name: '🎯 PMKID Attack', cmd: 'wifi_pmkid --bssid AA:BB:CC:DD:EE:FF' },
  ],
  ble: [
    { name: '🔍 Scan BLE', cmd: 'ble_scan --duration 20' },
    { name: '📢 BLE Spam', cmd: 'ble_spam --type samsung --count 100' },
    { name: '📋 GATT Clone', cmd: 'ble_gatt --clone' },
    { name: '🎭 MAC Spoof', cmd: 'ble_spoof --mac AA:BB:CC:DD:EE:FF' },
    { name: '📡 iBeacon Flood', cmd: 'ble_beacon --type ibeacon --count 50' },
  ],
  lora: [
    { name: '📡 Scan 868MHz', cmd: 'lora_scan --freq 868 --duration 30' },
    { name: '📡 Scan 433MHz', cmd: 'lora_scan --freq 433 --duration 30' },
    { name: '📡 Scan 915MHz', cmd: 'lora_scan --freq 915 --duration 30' },
    { name: '📤 Send Packet', cmd: 'lora_send --freq 868 --data "48454c4c4f"' },
    { name: '📋 Replay Packet', cmd: 'lora_replay --file captured.lora' },
    { name: '🎯 Jammer', cmd: 'lora_jam --freq 868 --duration 5' },
  ],
  ir: [
    { name: '🎓 Learn IR', cmd: 'ir_learn --duration 30' },
    { name: '📤 Replay IR', cmd: 'ir_replay --file remote.nec' },
    { name: '📚 IR Database', cmd: 'ir_database --list' },
    { name: '🎯 Raw Signal', cmd: 'ir_raw --protocol nec --data 0x00FF00FF' },
  ],
  rfid: [
    { name: '🔍 Scan 125kHz', cmd: 'rfid_scan --freq 125 --duration 10' },
    { name: '🔍 Scan 13.56MHz', cmd: 'rfid_scan --freq 1356 --duration 10' },
    { name: '📤 Clone MIFARE', cmd: 'rfid_clone --type mifare_classic' },
    { name: '📤 Write T5577', cmd: 'rfid_write --type t5577 --data 1234567890' },
    { name: '🎯 HID Prox', cmd: 'rfid_emulate --type hid_prox --uid 1234567890' },
  ],
  gps: [
    { name: '📡 GPS Lock', cmd: 'gps_lock --timeout 60' },
    { name: '🗺️ Wardriving', cmd: 'gps_wardrive --output wardrive.kml' },
    { name: '📍 Waypoint', cmd: 'gps_waypoint --name "checkpoint"' },
    { name: '📡 LoRa GPS', cmd: 'gps_lora_send --freq 868 --interval 10' },
  ],
  deauth: [
    { name: '💀 Target Deauth', cmd: 'wifi_deauth --bssid TARGET --client ALL' },
    { name: '💀 Client Deauth', cmd: 'wifi_deauth --client CLIENT_MAC' },
    { name: '💀 Beacon Flood', cmd: 'wifi_beacon --count 100 --ssid "FREE_WIFI"' },
    { name: '💀 Probe Flood', cmd: 'wifi_probe --bssid TARGET --count 50' },
  ],
  gpio: [
    { name: '📊 Read Digital', cmd: 'gpio_read --pin 4' },
    { name: '📊 Read Analog', cmd: 'gpio_analog --pin 34' },
    { name: '📤 Write Digital', cmd: 'gpio_write --pin 4 --value 1' },
    { name: '📊 PWM Output', cmd: 'gpio_pwm --pin 5 --freq 1000 --duty 50' },
    { name: '📡 I2C Scan', cmd: 'i2c_scan --sda 21 --scl 22' },
  ],
};

export default function LiligoVirtual({ api, sendToTerminal }) {
  const [selectedTool, setSelectedTool] = useState(null);
  const [history, setHistory] = useState([]);
  const [liligoState, setLiligoState] = useState({ connected: false, device: null, info: null });
  const [detecting, setDetecting] = useState(false);
  const [toast, setToast] = useState('');
  const [scanResults, setScanResults] = useState(null);

  const detectLiligo = async () => {
    setDetecting(true);
    try {
      const r = await api('/liligo/detect');
      if (r.ok && r.device) {
        setLiligoState(prev => ({ ...prev, device: r.device }));
        setToast(`✅ LILIGO detectado: ${r.device.path}`);
      } else {
        setToast('❌ No se detectó LILIGO ESP32');
      }
    } catch (e) {
      setToast('❌ Error: ' + e.message);
    }
    setDetecting(false);
  };

  const connectLiligo = async () => {
    if (!liligoState.device) return;
    try {
      const r = await api('/liligo/connect', { method: 'POST', body: JSON.stringify({ path: liligoState.device.path, baud: 115200 }) });
      if (r.ok) {
        setLiligoState(prev => ({ ...prev, connected: true, info: r.info }));
        setToast('✅ LILIGO conectado');
      } else {
        setToast('❌ ' + r.error);
      }
    } catch (e) {
      setToast('❌ Error: ' + e.message);
    }
  };

  const disconnectLiligo = async () => {
    await api('/liligo/disconnect', { method: 'POST' });
    setLiligoState({ connected: false, device: null, info: null });
    setToast('🔌 LILIGO desconectado');
  };

  const runLiligoCommand = async (cmd) => {
    if (!liligoState.connected) {
      setToast('⚠️ Conecta LILIGO primero');
      return;
    }
    try {
      const r = await api('/liligo/command', { method: 'POST', body: JSON.stringify({ command: cmd }) });
      if (r.ok) {
        setHistory(h => [{ cmd, result: r.result, ts: Date.now(), real: true }, ...h].slice(0, 50));
        setToast('✅ ' + (r.result || 'OK'));
      } else {
        setToast('❌ ' + r.error);
      }
    } catch (e) {
      setToast('❌ Error: ' + e.message);
    }
  };

  const runCommand = (cmd) => {
    setHistory(h => [{ cmd, ts: Date.now(), real: false }, ...h].slice(0, 50));
    if (sendToTerminal) sendToTerminal({ cmd, ts: Date.now() });
  };

  const exportHistory = () => {
    const data = JSON.stringify(history, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'liligo-history.json'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ color: 'var(--text)' }}>
      {toast && <div className="toast" onClick={() => setToast('')}>{toast}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28 }}>⚡</span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 20, color: '#fff', fontFamily: "'Courier New', monospace" }}>
            LILIGO ESP32
          </h2>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {liligoState.connected ? `🟢 ${liligoState.info?.chip || 'Conectado'}` : 'root@knklinux:~# liligo --mode=multi-tool'}
          </div>
        </div>
      </div>

      {/* Connection Panel */}
      <div className="card" style={{ marginBottom: 16 }}>
        <h3>🔌 LILIGO ESP32</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {!liligoState.connected ? (
            <>
              <button className="btn btn-sm" onClick={detectLiligo} disabled={detecting}>
                {detecting ? '⏳ Buscando...' : '🔍 Detectar USB'}
              </button>
              {liligoState.device && (
                <button className="btn btn-sm btn-green" onClick={connectLiligo}>
                  ✅ Conectar ({liligoState.device.path})
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
                {liligoState.info?.firmware || 'ESP32'}
              </span>
              <button className="btn btn-sm btn-outline" onClick={disconnectLiligo}>
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
              background: selectedTool?.id === tool.id ? `${tool.color}15` : 'var(--panel)',
              border: `1px solid ${selectedTool?.id === tool.id ? tool.color : 'var(--border)'}`,
              borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'all 0.15s',
            }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{tool.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace', color: tool.color }}>{tool.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{tool.desc}</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
              {tool.protocols.slice(0, 2).map(p => (
                <span key={p} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4,
                  background: `${tool.color}20`, color: tool.color, fontFamily: 'monospace' }}>{p}</span>
              ))}
              {tool.protocols.length > 2 && <span style={{ fontSize: 9, color: 'var(--muted)' }}>+{tool.protocols.length - 2}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Tool Detail */}
      {selectedTool && (
        <div style={{ background: 'var(--panel)', border: `1px solid ${selectedTool.color}`, borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, fontFamily: 'monospace', marginBottom: 12, color: selectedTool.color }}>
            {selectedTool.icon} {selectedTool.name}
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'monospace' }}>PROTOCOLOS:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {selectedTool.protocols.map(p => (
                <span key={p} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6,
                  background: `${selectedTool.color}20`, color: selectedTool.color, fontFamily: 'monospace' }}>{p}</span>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'monospace' }}>ACCIONES:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(SCRIPTS[selectedTool.id] || []).map((script, i) => (
              <button key={i} onClick={() => liligoState.connected ? runLiligoCommand(script.cmd) : runCommand(script.cmd)} style={{
                padding: '6px 12px', background: liligoState.connected ? selectedTool.color : 'var(--bg)',
                color: liligoState.connected ? '#000' : selectedTool.color,
                border: `1px solid ${selectedTool.color}40`, borderRadius: 6, fontSize: 11,
                cursor: 'pointer', fontFamily: 'monospace', transition: 'all 0.15s',
              }}>
                {liligoState.connected ? '⚡' : '▶'} {script.name}
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
              📥 Export JSON
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
