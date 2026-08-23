import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export default function Terminal() {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new XTerm({
      theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff' },
      fontFamily: 'ui-monospace, Cascadia Code, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    // Connect WebSocket
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.writeln('\x1b[32m🐉 Conectado a Kali Docker\x1b[0m');
      term.writeln('');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'output') term.write(msg.data);
      } catch {}
    };

    ws.onclose = () => { setConnected(false); term.writeln('\x1b[31m❌ Desconectado\x1b[0m'); };

    term.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data }));
    });

    const handleResize = () => { fitAddon.fit(); ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const quickCommands = [
    { label: 'nmap -sV', cmd: 'nmap -sV TARGET' },
    { label: 'ffuf fuzz', cmd: 'ffuf -u https://TARGET/FUZZ -w /usr/share/wordlists/dirb/common.txt -mc 200,301,302,403 -t 1' },
    { label: 'nuclei', cmd: 'nuclei -u https://TARGET -t http/misconfiguration -silent -timeout 5' },
    { label: 'subfinder', cmd: 'subfinder -d TARGET -silent' },
    { label: 'sqlmap', cmd: "sqlmap -u 'https://TARGET/PATH' --batch --level=1" },
    { label: 'whatweb', cmd: 'whatweb https://TARGET' },
    { label: 'dirb', cmd: 'dirb https://TARGET /usr/share/wordlists/dirb/common.txt' },
    { label: 'curl CORS', cmd: 'curl -sI -H "Origin: https://evil.example" https://TARGET' },
  ];

  const insertCmd = (cmd) => {
    if (termRef.current && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
    }
  };

  return (
    <div>
      <h2>🐳 Terminal Kali</h2>

      <div className="card">
        <h3>
          <span style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>●</span>
          {' '}Terminal Docker Kali — {connected ? 'Conectado' : 'Desconectado'}
        </h3>
        <p className="muted" style={{ marginBottom: 8 }}>Ejecuta comandos manualmente. Copia los comandos de abajo y pega en la terminal.</p>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {quickCommands.map(c => (
            <button key={c.label} className="btn btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}
              onClick={() => insertCmd(c.cmd)}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="terminal-container" ref={containerRef} style={{ height: 400 }} />
      </div>
    </div>
  );
}