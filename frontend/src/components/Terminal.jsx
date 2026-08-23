import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const TOOL_CATEGORIES = {
  '🔍 Recon': [
    { label: 'nmap scan', cmd: 'nmap -sV -sC TARGET' },
    { label: 'nmap all ports', cmd: 'nmap -p- --min-rate=1000 TARGET' },
    { label: 'subfinder', cmd: 'subfinder -d TARGET -silent' },
    { label: 'amass enum', cmd: 'amass enum -passive -d TARGET' },
    { label: 'httpx probe', cmd: 'echo "TARGET" | httpx -silent' },
    { label: 'whois', cmd: 'whois TARGET' },
    { label: 'dig', cmd: 'dig TARGET ANY' },
    { label: 'host', cmd: 'host TARGET' },
  ],
  '🌐 Web': [
    { label: 'nikto', cmd: 'nikto -h https://TARGET' },
    { label: 'ffuf fuzz', cmd: 'ffuf -u https://TARGET/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302,403 -t 1' },
    { label: 'ffuf vhost', cmd: 'ffuf -u https://TARGET -H "Host: FUZZ.TARGET" -w /usr/share/wordlists/dirb/common.txt -mc 200' },
    { label: 'sqlmap', cmd: "sqlmap -u 'https://TARGET/PATH' --batch --level=1" },
    { label: 'curl headers', cmd: 'curl -sI https://TARGET' },
    { label: 'curl CORS', cmd: 'curl -sI -H "Origin: https://evil.example" https://TARGET' },
    { label: 'whatweb', cmd: 'whatweb https://TARGET' },
  ],
  '🔑 Auth': [
    { label: 'hydra ssh', cmd: 'hydra -l USER -P /usr/share/wordlists/rockyou.txt TARGET ssh' },
    { label: 'hydra ftp', cmd: 'hydra -l USER -P /usr/share/wordlists/rockyou.txt TARGET ftp' },
    { label: 'hydra http', cmd: 'hydra -l USER -P /usr/share/wordlists/rockyou.txt TARGET http-post-form "/login:user=^USER^&pass=^PASS^:F=incorrect"' },
    { label: 'john hash', cmd: 'john --wordlist=/usr/share/wordlists/rockyou.txt hash.txt' },
  ],
  '📡 Network': [
    { label: 'netcat listen', cmd: 'nc -lvnp 4444' },
    { label: 'netcat connect', cmd: 'nc TARGET PORT' },
    { label: 'socat relay', cmd: 'socat TCP-LISTEN:8080,fork TCP:TARGET:80' },
    { label: 'ping sweep', cmd: 'nmap -sn 192.168.1.0/24' },
    { label: 'traceroute', cmd: 'traceroute TARGET' },
    { label: 'arp scan', cmd: 'arp-scan -l' },
  ],
  '🔒 SSL/TLS': [
    { label: 'ssl cert', cmd: 'openssl s_client -connect TARGET:443 </dev/null 2>/dev/null | openssl x509 -text -noout' },
    { label: 'ssl scan', cmd: 'nmap --script ssl-enum-ciphers -p 443 TARGET' },
    { label: 'ssl labs', cmd: 'echo "Check https://www.ssllabs.com/ssltest/analyze.html?d=TARGET"' },
  ],
  '📦 Forensics': [
    { label: 'binwalk', cmd: 'binwalk FILE' },
    { label: 'steghide info', cmd: 'steghide info FILE' },
    { label: 'steghide extract', cmd: 'steghide extract -sf FILE -p ""' },
    { label: 'exiftool', cmd: 'exiftool FILE' },
    { label: 'strings', cmd: 'strings FILE | head -50' },
    { label: 'file type', cmd: 'file FILE' },
  ],
};

export default function Terminal() {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [activeCategory, setActiveCategory] = useState('🔍 Recon');
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0a0e14',
        foreground: '#b3b1ad',
        cursor: '#e6b450',
        cursorAccent: '#0a0e14',
        selectionBackground: '#273747',
        black: '#01060e',
        red: '#ea6c73',
        green: '#91b362',
        yellow: '#f9af4f',
        blue: '#53bdfa',
        magenta: '#fae994',
        cyan: '#90e1c6',
        white: '#c7c7c7',
        brightBlack: '#686868',
        brightRed: '#f07178',
        brightGreen: '#c2d94c',
        brightYellow: '#ffb454',
        brightBlue: '#59c2ff',
        brightMagenta: '#ffee99',
        brightCyan: '#95e6cb',
        brightWhite: '#ffffff',
      },
      fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", ui-monospace, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // Welcome message
    term.writeln('\x1b[38;2;230;180;80m╔══════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[38;2;230;180;80m║      🐉 KNK Suite — Kali Docker Terminal     ║\x1b[0m');
    term.writeln('\x1b[38;2;230;180;80m╚══════════════════════════════════════════════╝\x1b[0m');
    term.writeln('');

    // Connect WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.writeln('\x1b[32m✓ Conectado a Kali Docker\x1b[0m');
      term.writeln('');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      term.writeln('\x1b[31m✗ Desconectado — recarga la página\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data }));
      // Track history
      if (data === '\r') {
        const line = term.buffer.active.getLine(term.buffer.active.cursorY);
        if (line) setHistory(prev => [...prev.slice(-20), line.translateToString(true)]);
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const insertCmd = (cmd) => {
    if (termRef.current && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
      termRef.current.focus();
    }
  };

  const tools = TOOL_CATEGORIES[activeCategory] || [];

  return (
    <div>
      <h2>🐳 Terminal Kali</h2>

      <div style={{ display: 'flex', gap: 12 }}>
        {/* Sidebar de herramientas */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div className="card">
            <h3>🛠️ Herramientas</h3>
            {Object.keys(TOOL_CATEGORIES).map(cat => (
              <button
                key={cat}
                className={`btn btn-sm ${activeCategory === cat ? '' : 'btn-outline'}`}
                style={{ width: '100%', marginBottom: 4, fontSize: 11, textAlign: 'left' }}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <h3 style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>
              {connected ? '●' : '○'} Estado
            </h3>
            <span className="muted">{connected ? 'Kali Docker activo' : 'Desconectado'}</span>
          </div>

          <div className="card" style={{ marginTop: 8 }}>
            <h3>📋 Comandos ({tools.length})</h3>
            {tools.map((t, i) => (
              <button
                key={i}
                className="btn btn-sm btn-outline"
                style={{ width: '100%', marginBottom: 3, fontSize: 10, textAlign: 'left', padding: '4px 8px' }}
                onClick={() => insertCmd(t.cmd)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Terminal principal */}
        <div style={{ flex: 1 }}>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              background: '#1a1f2e',
              padding: '6px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                🐉 kali@knk-suite — bash
              </span>
              <span style={{ fontSize: 10, color: connected ? 'var(--green)' : 'var(--red)' }}>
                {connected ? '● Connected' : '○ Disconnected'}
              </span>
            </div>
            <div
              ref={containerRef}
              style={{
                background: '#0a0e14',
                minHeight: 450,
                padding: 4,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}