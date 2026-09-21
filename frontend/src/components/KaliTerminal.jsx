import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// ============================================================================
// KaliTerminal.jsx — Terminal real: WebSocket + node-pty (xterm.js)
// El backend elige runtime: Kali real (WSL2/VBox SSH) si está, shell local con
// aviso honesto si no. Incluye inventario real de herramientas del runtime.
// Acepta comandos inyectados (inject) desde otros módulos: se ESCRIBEN en la
// PTY sin ejecutarlos — el usuario revisa y pulsa ↵ (así la contraseña, si la
// pide, la teclea él). Si la PTY aún no está abierta, quedan en cola.
//
// Encender Kali: si el runtime está apagado (vbox), el botón ⏻ arranca la VM
// en headless vía POST /api/kali/start, sondea el estado con ?fresh=1 (bypass
// de la caché de 30s) y, al ver SSH vivo, reconecta term+WS: la PTY se crea en
// el momento de la conexión WS, así que la reconexión es lo que aterriza en
// Kali real y no en el shell local del arranque anterior.
// ============================================================================

const BOOT_TIMEOUT_MS = 120000; // VM boot + sshd: margen generoso
// El backend de inventario manda `available` (fallback `present` por compat)
const hasTool = (t) => (t.available ?? t.present) === true;
const BOOT_POLL_MS = 3000;

export default function KaliTerminal({ api, inject }) {
  const boxRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const pendingRef = useRef(null);
  const [kali, setKali] = useState(null);
  const [tools, setTools] = useState(null);
  const [connected, setConnected] = useState(false);
  const [booting, setBooting] = useState(false);
  const [connNonce, setConnNonce] = useState(0); // bump → reconecta term+WS
  const [dockerBusy, setDockerBusy] = useState(false);
  const [dockerHelp, setDockerHelp] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState('');

  const copyCmd = (text) => {
    try { navigator.clipboard?.writeText(text).then(() => { setCopiedCmd(text); setTimeout(() => setCopiedCmd(''), 1500); }).catch(() => {}); } catch {}
  };

  const dockerClick = () => {
    // Sin Docker Desktop el botón no puede funcionar: guiar antes de fallar.
    if (rts && !rts.dockerCli) { setDockerHelp((v) => !v); return; }
    ensureDocker();
  };

  const ensureDocker = async () => {
    if (dockerBusy) return;
    setDockerBusy(true);
    const term = termRef.current;
    try {
      term?.writeln('\x1b[36m[knkLinux] preparando contenedor knk-kali…\x1b[0m');
      const r = await api('/kali/docker-ensure', { method: 'POST', body: '{}' });
      if (!r?.ok) {
        term?.writeln(`\x1b[31m[knkLinux] Docker: ${r?.error || 'falló'}\x1b[0m`);
      } else {
        term?.writeln('\x1b[32m[knkLinux] knk-kali listo ✓ — reconectando…\x1b[0m');
        await api('/kali/status?fresh=1').then(setKali).catch(() => {});
        loadRuntimes();
        setChoice('docker');
        setConnNonce((n) => n + 1);
      }
    } catch (e) {
      term?.writeln(`\x1b[31m[knkLinux] error docker: ${e.message}\x1b[0m`);
    }
    setDockerBusy(false);
  };
  // Selector de terminal: qué runtime abrir en esta conexión
  const [choice, setChoice] = useState('auto');
  // Pestañas (?tab=): cada una es una PTY persistente en el backend.
  const [tabs, setTabs] = useState(['main']);
  const [tab, setTab] = useState('main');
  const tabRef = useRef('main');
  useEffect(() => { tabRef.current = tab; }, [tab]);
  const newTab = () => {
    const id = 't' + Math.random().toString(36).slice(2, 6);
    setTabs((p) => [...p, id]); setTab(id);
  };
  const [rts, setRts] = useState(null); // {auto, runtimes:[{id,label,available,reason}]}
  const loadRuntimes = useCallback(() => {
    api('/kali/runtimes').then(setRts).catch(() => {});
  }, []);
  useEffect(() => { loadRuntimes(); }, [loadRuntimes]);
  // refs espejo para el intervalo de auto-sanado (deps vacías, sin churn)
  const kaliRef = useRef(null);
  const toolsRef = useRef(null);
  const choiceRef = useRef('auto');
  useEffect(() => { kaliRef.current = kali; }, [kali]);
  useEffect(() => { toolsRef.current = tools; }, [tools]);
  useEffect(() => { choiceRef.current = choice; }, [choice]);

  useEffect(() => {
    api('/kali/status').then(setKali).catch(() => {});
    api('/kali/tools').then(r => setTools(r.ok ? r : null)).catch(() => {});
  }, [connNonce]);

  useEffect(() => {
    const term = new Terminal({
      theme: {
        background: '#0a0d12', foreground: '#dbe2ef',
        cursor: '#2dd4bf', selectionBackground: '#bc8cff44',
        black: '#0d1117', red: '#f85149', green: '#3fb950', yellow: '#e3b341',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#2dd4bf', white: '#dbe2ef',
      },
      fontSize: 13, fontFamily: '"Cascadia Code", Consolas, monospace',
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(boxRef.current);
    fit.fit();
    termRef.current = term;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?runtime=${choiceRef.current}&tab=${tabRef.current}`);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      term.writeln('\x1b[36m── knkLinux terminal ──\x1b[0m');
      // La PTY se creó AHORA: re-consulta el estado para que la cabecera
      // refleje el runtime real de esta sesión (si el mount fue con caché
      // vieja, aquí se autocorrige — p.ej. la WS aterrizó ya dentro de Kali).
      api('/kali/status').then(setKali).catch(() => {});
      loadRuntimes(); // refresca disponibilidad del selector
      // comando en cola (llegó antes de que la PTY abriera)
      if (pendingRef.current) {
        ws.send(JSON.stringify({ type: 'input', data: pendingRef.current }));
        pendingRef.current = null;
      }
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'output') term.write(m.data);
        else if (m.type === 'exit') term.write(`\r\n\x1b[33m[proceso terminado: ${m.code}]\x1b[0m\r\n`);
        else if (m.type === 'error') term.write(`\r\n\x1b[31m${m.data}\x1b[0m\r\n`);
      } catch {}
    };
    ws.onclose = () => { setConnected(false); term.writeln('\x1b[31m── desconectado ──\x1b[0m'); };
    term.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data: d })); });
    const onResize = () => { try { fit.fit(); ws.readyState === 1 && ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch {} };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      ws.onclose = null; // la term se dispone ya: no escribir en ella al cerrar
      try { ws.close(); } catch {}
      term.dispose();
    };
  }, [connNonce, tab]);

  // Inyección desde otros módulos (asistente de desbloqueo del job 🧰)
  useEffect(() => {
    if (!inject?.cmd) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data: inject.cmd }));
    else pendingRef.current = inject.cmd;
  }, [inject?.ts]);

  // Auto-sanado del estado: sondeo ligero cada 10s mientras la vista vive.
  // Si el mount llegó con caché vieja (o la VM cambió por fuera), la
  // cabecera se corrige sola sin esperar reconexión.
  useEffect(() => {
    const iv = setInterval(() => {
      setKali(k => {
        const notReady = !k || k.status !== 'RUNTIME_READY';
        if (notReady) api('/kali/status?fresh=1').then(setKali).catch(() => {});
        else api('/kali/status').then(setKali).catch(() => {});
        return k;
      });
      // inventario perezoso: si el runtime está ready y el inventario aún no
      // llegó (falló al montar o llegó antes de que SSH respondiera), reintentar
      if (kaliRef.current?.status === 'RUNTIME_READY' && !toolsRef.current) {
        api('/kali/tools').then(r => { if (r?.ok) setTools(r); }).catch(() => {});
      }
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  const ready = kali?.status === 'RUNTIME_READY';
  // runtime de la sesión actual: la elección activa que abrió la PTY
  const connectedRuntime = choice === 'auto' ? (rts?.auto || 'local') : choice;

  // ⏻ Encender Kali: headless + sondeo fresco + reconexión al estar listo
  const bootKali = async () => {
    if (booting) return;
    setBooting(true);
    const term = termRef.current;
    try {
      term?.writeln('\x1b[36m[knkLinux] encendiendo kali-bounty-ova (headless)…\x1b[0m');
      const r = await api('/kali/start', { method: 'POST', body: '{}' });
      if (!r?.ok) {
        term?.writeln(`\x1b[31m[knkLinux] VBoxManage no pudo arrancar: ${r?.out || 'sin detalle'}\x1b[0m`);
        setBooting(false);
        return;
      }
      term?.writeln('\x1b[36m[knkLinux] VM lanzada — esperando SSH…\x1b[0m');
      const t0 = Date.now();
      let tick = 0;
      const poll = async () => {
        if (Date.now() - t0 > BOOT_TIMEOUT_MS) {
          term?.writeln(`[31m[knkLinux] timeout: la VM no respondió por SSH en ${BOOT_TIMEOUT_MS / 1000}s — revisa VirtualBox[0m`);
          setBooting(false);
          return;
        }
        const st = await api('/kali/status?fresh=1').catch(() => null);
        if (st?.status === 'RUNTIME_READY') {
          term?.writeln('[32m[knkLinux] Kali listo ✓ — reconectando la terminal en Kali real…[0m');
          setKali(st);
          setBooting(false);
          setConnNonce(n => n + 1); // nueva PTY: SSH dentro del box
          return;
        }
        tick += 1;
        if (tick % 4 === 0) {
          term?.writeln(`[36m[knkLinux] esperando SSH… (${Math.round((Date.now() - t0) / 1000)}s)[0m`);
        }
        setTimeout(poll, BOOT_POLL_MS);
      };
      poll();
    } catch (e) {
      term?.writeln(`\x1b[31m[knkLinux] error arrancando: ${e.message}\x1b[0m`);
      setBooting(false);
    }
  };

  return (
    <div>
      <h2>🖥️ Terminal {ready ? `Kali (${kali.distro})` : 'local'}</h2>
      <div className="card">
        <div style={{ marginBottom: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: connected ? 'var(--green)' : 'var(--red)' }}>●</span>{' '}
            {connected ? 'conectado' : 'desconectado'} · runtime:{' '}
            <b>{ready ? `${kali.runtime} · ${kali.distro}` : 'shell del host'}</b>
            {!ready && kali && (
              <span className="muted"> — {kali.status}{kali.reason ? `: ${kali.reason}` : ''}</span>
            )}
          </span>
          {(kali?.vboxPower?.off || (!ready && kali?.runtime === 'vbox-ssh')) && (booting ? (
            <span style={{ color: 'var(--yellow)', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
              <span style={{ width: 13, height: 13, borderRadius: '50%', border: '2px solid var(--border)',
                borderTopColor: 'var(--yellow)', display: 'inline-block', animation: 'spin .9s linear infinite' }} />
              encendiendo VM…
            </span>
          ) : (
            <button className="btn btn-sm" style={{ borderColor: 'var(--green)', color: 'var(--green)' }} onClick={bootKali}
              title={`Arranca la VM ${kali?.vboxPower?.vm || 'kali-bounty-ova'} en headless (VBoxManage) y reconecta la terminal dentro de Kali real`}>
              ⏻ Encender Kali
            </button>
          ))}
          {rts && !rts.dockerContainer && (
            <button className="btn btn-sm btn-outline" disabled={dockerBusy} onClick={dockerClick}
              title={rts.dockerCli
                ? 'Descarga la imagen Kali (solo la primera vez), crea el contenedor knk-kali y lo arranca'
                : 'Requiere Docker Desktop instalado y en marcha (docker.com)'}>
              {dockerBusy ? '🐳 preparando…' : '🐳 Kali Docker'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>terminal:</span>
          {(rts?.runtimes || []).map(rt => (
            <button key={rt.id}
              className={`btn btn-sm ${choice === rt.id ? 'rt-sel' : ''}`}
              onClick={() => { setChoice(rt.id); setConnNonce(n => n + 1); }}
              disabled={choice === rt.id}
              title={rt.available ? `Abrir ${rt.label}` : `${rt.label} — ${rt.reason || 'no disponible ahora'}`}>
              {rt.available ? '●' : '○'} {rt.label}
            </button>
          ))}
          {choice !== 'auto' && rts && !rts.runtimes.find(r => r.id === choice)?.available && (
            <span style={{ fontSize: 10.5, color: 'var(--yellow)' }}>↳ cae al shell local</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11, letterSpacing: 1 }}>pestañas:</span>
          {tabs.map((t) => (
            <button key={t} className={`btn btn-sm ${tab === t ? '' : 'btn-outline'}`} onClick={() => setTab(t)}
              title={t === 'main' ? 'PTY principal (?tab=main)' : `PTY ${t} (persistente en el backend)`}>
              {t === tab ? '● ' : '○ '}{t}
            </button>
          ))}
          <button className="btn btn-sm btn-outline" onClick={newTab} title="Nueva PTY persistente">＋</button>
        </div>

        {dockerHelp && rts && !rts.dockerCli && (
          <div style={{ marginBottom: 10, padding: 12, background: 'rgba(255,199,0,0.06)', border: '1px solid rgba(255,199,0,0.35)', borderRadius: 8, fontSize: 11 }}>
            <div style={{ fontWeight: 700, color: 'var(--yellow)', marginBottom: 6 }}>🐳 Para el Kali Docker faltan 2 installs (5 min + 1 reinicio)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div><b>1.</b> PowerShell <b>como administrador</b> → <code>wsl --install</code> → reinicia.
                <button className="btn btn-sm btn-outline" style={{ marginLeft: 8, padding: '1px 8px', fontSize: 9 }} onClick={() => copyCmd('wsl --install')}>{copiedCmd === 'wsl --install' ? '✓ copiado' : '📋 copiar'}</button>
              </div>
              <div><b>2.</b> Instala <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener" style={{ color: 'var(--primary)' }}>Docker Desktop</a> y ábrelo una vez.</div>
              <div><b>3.</b> Vuelve aquí y pulsa 🐳 Kali Docker (descarga la imagen solo la primera vez).</div>
              <div style={{ color: 'var(--muted)', fontSize: 10 }}>Atajo: solo el paso 1 con <code>wsl --install -d kali-linux</code> ya da Kali real sin Docker.
                <button className="btn btn-sm btn-outline" style={{ marginLeft: 8, padding: '1px 8px', fontSize: 9 }} onClick={() => copyCmd('wsl --install -d kali-linux')}>{copiedCmd === 'wsl --install -d kali-linux' ? '✓ copiado' : '📋 copiar'}</button>
              </div>
            </div>
          </div>
        )}
        <div ref={boxRef} style={{ height: 420, background: '#0a0d12', borderRadius: 8, padding: 6 }} />
        {tools && connectedRuntime !== 'local' && (
          <div style={{ marginTop: 10, fontSize: 11 }}>
            <span className="muted">herramientas: </span>
            <b style={{ color: 'var(--green)' }}>{tools.tools.filter(hasTool).length}/{tools.tools.length}</b>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {tools.tools.map(t => (
                <span key={t.name} className="badge" style={{
                  border: `1px solid ${hasTool(t) ? 'var(--green)' : 'var(--border)'}`,
                  color: hasTool(t) ? 'var(--green)' : 'var(--muted)',
                }}>{t.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
